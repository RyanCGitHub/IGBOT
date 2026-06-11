// Stage handlers for the reel pipeline. The tick route leases a run and calls
// advanceRun(), which executes exactly ONE stage transition and persists it.
// Every handler is idempotent: partial progress (keyframes, clips) is saved as
// it happens, so a crashed or timed-out tick resumes where it stopped.

import { supabaseServer } from "@/lib/supabase-server";
import { anthropic } from "@/lib/claude";
import { getImageProvider, IMAGE_DAILY_CAP } from "@/lib/media-generation";
import { submitImageToVideo, checkVideoJob } from "@/lib/media-generation/fal";
import { generateReelBrief } from "@/lib/reels/strategist";
import { resolveMusic, synthesizeVoiceover, voiceoverEnabled } from "@/lib/reels/audio";
import { assembleReel } from "@/lib/reels/assemble";
import { uploadToBucket, downloadFromBucket, fetchToBuffer, publicUrlFor } from "@/lib/reels/storage";
import {
  createLogger,
  createReelsContainer,
  checkContainerStatus,
  publishContainer,
  getMediaPermalink,
} from "@/lib/instagram";
import { getPersonaForAccount, personaPromptBlock, applyDisclosure } from "@/lib/persona";
import { publishingPaused } from "@/lib/cron-auth";
import { getActiveLearnings, learningsPromptBlock } from "@/lib/learning";
import type { ReelRun, ReelBrief, Keyframe, Clip, ReelRunAudio } from "@/lib/reels/types";

const CAPTION_MODEL = "claude-sonnet-4-5";
const STAGE_TIME_BUDGET_MS = 250_000;  // keyframe loop stops here; rest next tick
const CLIP_TIMEOUT_MIN = 45;           // resubmit provider jobs older than this
const PUBLISH_TIMEOUT_H = 6;           // container stuck IN_PROGRESS → fail
const MAX_ATTEMPTS = 3;

type AccountRow = {
  id: number;
  account_name: string;
  ig_user_id: string;
  access_token: string;
  niche: string | null;
  posting_hour_utc: number | null;
};

async function getAccount(accountId: number): Promise<AccountRow> {
  const { data, error } = await supabaseServer
    .from("connected_accounts")
    .select("id, account_name, ig_user_id, access_token, niche, posting_hour_utc")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error(`Connected account ${accountId} not found — was it disconnected?`);
  return data as AccountRow;
}

async function saveRun(id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseServer
    .from("reel_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to save run ${id}: ${error.message}`);
}

export type AdvanceResult = { from: string; to: string; note?: string };

// ─── Stage: queued → briefed ─────────────────────────────────────────────────

async function stageBrief(run: ReelRun): Promise<AdvanceResult> {
  const account = await getAccount(run.account_id);
  const { brief, personaId } = await generateReelBrief(account);
  await saveRun(run.id, { brief, persona_id: personaId, status: "briefed", error_message: null });
  return { from: "queued", to: "briefed", note: brief.title };
}

// ─── Stage: briefed → keyframes_ready ────────────────────────────────────────
// One gpt-image-1 portrait keyframe per beat, time-budgeted: generates as many
// as fit in this tick and stays in "briefed" until every beat has one.

async function stageKeyframes(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const provider = getImageProvider();
  const started = Date.now();
  const keyframes: Keyframe[] = [...(run.keyframes ?? [])];
  const have = new Set(keyframes.map(k => k.beat_index));

  // Respect the shared per-account image cap; pipeline waits rather than fails.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer
    .from("generated_media")
    .select("id", { count: "exact", head: true })
    .eq("account_id", run.account_id)
    .eq("media_type", "image")
    .eq("status", "generated")
    .gte("created_at", since);
  let capRemaining = IMAGE_DAILY_CAP - (count ?? 0);

  for (let i = 0; i < brief.beats.length; i++) {
    if (have.has(i)) continue;
    if (Date.now() - started > STAGE_TIME_BUDGET_MS) {
      return { from: "briefed", to: "briefed", note: `keyframes ${keyframes.length}/${brief.beats.length} (time budget)` };
    }
    if (capRemaining <= 0) {
      return { from: "briefed", to: "briefed", note: `keyframes ${keyframes.length}/${brief.beats.length} (daily image cap — waiting)` };
    }

    const beat = brief.beats[i];
    const prompt = [brief.visual_style, beat.image_prompt, "Vertical 9:16 composition. No text or lettering in the image."]
      .filter(Boolean).join("\n\n");
    const result = await provider.generateImage(prompt, { size: "1024x1536" });
    capRemaining--;

    const upload = await uploadToBucket(
      `reels/${run.id}/keyframe-${i}.png`,
      Buffer.from(result.base64, "base64"),
      result.mimeType
    );
    keyframes.push({ beat_index: i, storage_path: upload.path, url: upload.publicUrl });
    keyframes.sort((a, b) => a.beat_index - b.beat_index);
    await saveRun(run.id, { keyframes }); // persist partial progress immediately

    await supabaseServer.from("generated_media").insert({
      account_id: run.account_id,
      persona_id: run.persona_id,
      prompt_used: prompt,
      provider: provider.name,
      storage_path: upload.path,
      media_type: "image",
      status: "generated",
      provider_meta: { ...result.providerMeta, reel_run_id: run.id, beat_index: i },
    });
  }

  await saveRun(run.id, { status: "keyframes_ready", error_message: null });
  return { from: "briefed", to: "keyframes_ready", note: `${keyframes.length} keyframes` };
}

// ─── Stage: keyframes_ready → clips_generating ───────────────────────────────

async function stageSubmitClips(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const keyframes = run.keyframes as Keyframe[];
  const clips: Clip[] = [];

  for (const kf of keyframes) {
    const beat = brief.beats[kf.beat_index];
    const { requestId } = await submitImageToVideo({
      prompt: `${beat.motion_prompt}. Style: ${brief.visual_style}`,
      imageUrl: kf.url,
      durationS: beat.duration_s,
    });
    clips.push({
      beat_index: kf.beat_index,
      request_id: requestId,
      submitted_at: new Date().toISOString(),
      status: "submitted",
    });
  }

  await saveRun(run.id, { clips, status: "clips_generating", error_message: null });
  return { from: "keyframes_ready", to: "clips_generating", note: `${clips.length} video jobs submitted` };
}

// ─── Stage: clips_generating → clips_ready ───────────────────────────────────
// Polls provider jobs; downloads finished clips into our bucket. Failed or
// stale jobs are resubmitted, costing one attempt — three strikes fails the run.

async function stageCollectClips(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const keyframes = run.keyframes as Keyframe[];
  const clips: Clip[] = [...(run.clips ?? [])];
  const failures: string[] = [];

  for (const clip of clips) {
    if (clip.status === "done") continue;

    const check = await checkVideoJob(clip.request_id);
    if (check.status === "done") {
      const buffer = await fetchToBuffer(check.videoUrl);
      const upload = await uploadToBucket(`reels/${run.id}/clip-${clip.beat_index}.mp4`, buffer, "video/mp4");
      clip.status = "done";
      clip.provider_url = check.videoUrl;
      clip.storage_path = upload.path;
      clip.url = upload.publicUrl;
      await saveRun(run.id, { clips });
    } else if (check.status === "failed") {
      clip.status = "failed";
      clip.error = check.error;
      failures.push(`beat ${clip.beat_index}: ${check.error}`);
    } else {
      const ageMin = (Date.now() - new Date(clip.submitted_at).getTime()) / 60_000;
      if (ageMin > CLIP_TIMEOUT_MIN) {
        clip.status = "failed";
        clip.error = `provider job stale after ${Math.round(ageMin)} min`;
        failures.push(`beat ${clip.beat_index}: stale job`);
      }
    }
  }

  if (failures.length > 0) {
    // Resubmit failed beats now so the retry is already in flight, then throw
    // so the tick's attempt accounting applies (MAX_ATTEMPTS strikes → failed).
    for (const clip of clips) {
      if (clip.status !== "failed") continue;
      const kf = keyframes.find(k => k.beat_index === clip.beat_index);
      const beat = brief.beats[clip.beat_index];
      if (!kf || !beat) continue;
      const { requestId } = await submitImageToVideo({
        prompt: `${beat.motion_prompt}. Style: ${brief.visual_style}`,
        imageUrl: kf.url,
        durationS: beat.duration_s,
      });
      clip.request_id = requestId;
      clip.submitted_at = new Date().toISOString();
      clip.status = "submitted";
      clip.error = undefined;
    }
    await saveRun(run.id, { clips });
    throw new Error(`Clip generation failed (resubmitted): ${failures.join("; ")}`);
  }

  if (clips.every(c => c.status === "done")) {
    await saveRun(run.id, { clips, status: "clips_ready", error_message: null });
    return { from: "clips_generating", to: "clips_ready", note: `${clips.length} clips stored` };
  }

  const done = clips.filter(c => c.status === "done").length;
  return { from: "clips_generating", to: "clips_generating", note: `clips ${done}/${clips.length} ready` };
}

// ─── Stage: clips_ready → assembled ──────────────────────────────────────────

async function stageAssemble(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const clipRows = (run.clips as Clip[]).filter(c => c.status === "done" && c.storage_path);
  clipRows.sort((a, b) => a.beat_index - b.beat_index);

  const clips = [];
  for (const c of clipRows) {
    clips.push({ beatIndex: c.beat_index, buffer: await downloadFromBucket(c.storage_path as string) });
  }

  const totalS = brief.beats.reduce((s, b) => s + b.duration_s, 0);
  const music = await resolveMusic(brief.audio_mood, totalS);

  let voiceover: Buffer | null = null;
  if (brief.voiceover_script && voiceoverEnabled()) {
    voiceover = await synthesizeVoiceover(brief.voiceover_script);
  }

  const finalVideo = await assembleReel({
    clips,
    beats: brief.beats,
    music: music.source === "none" ? null : music.buffer,
    voiceover,
  });

  const upload = await uploadToBucket(`reels/${run.id}/final.mp4`, finalVideo, "video/mp4");
  const audio: ReelRunAudio = {
    music_source: music.source,
    ...(music.source === "library" ? { music_track_id: music.trackId } : {}),
    voiceover: voiceover != null,
  };

  await saveRun(run.id, {
    assembled_video_path: upload.path,
    audio,
    status: "assembled",
    error_message: null,
  });
  return { from: "clips_ready", to: "assembled", note: `final.mp4 (${(finalVideo.length / 1e6).toFixed(1)} MB, music: ${audio.music_source}, voiceover: ${audio.voiceover})` };
}

// ─── Stage: assembled → captioned ────────────────────────────────────────────

function nextPostingSlot(postingHourUtc: number | null): string {
  if (process.env.REELS_PUBLISH_IMMEDIATELY === "true") return new Date().toISOString();
  const hour = postingHourUtc ?? Number(process.env.REELS_DEFAULT_POST_HOUR_UTC ?? 17);
  const slot = new Date();
  slot.setUTCHours(hour, 0, 0, 0);
  if (slot.getTime() <= Date.now()) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot.toISOString();
}

async function stageCaption(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const account = await getAccount(run.account_id);
  const persona = await getPersonaForAccount(run.account_id);
  const learnings = await getActiveLearnings(run.account_id);

  const context = [
    `Instagram account: @${account.account_name}`,
    persona ? personaPromptBlock(persona) : null,
    learningsPromptBlock(learnings) || null,
    `The Reel being captioned:`,
    `- Hook: ${brief.hook}`,
    `- On-screen beats: ${brief.beats.map(b => b.subtitle).join(" / ")}`,
    `- Caption angle: ${brief.caption_angle}`,
    `- Call to action: ${brief.cta}`,
    `- Suggested hashtags: ${brief.hashtags}`,
  ].filter(Boolean).join("\n\n");

  const message = await anthropic.messages.create({
    model: CAPTION_MODEL,
    max_tokens: 1_000,
    messages: [{
      role: "user",
      content: `Write the Instagram caption for this Reel.

${context}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "caption": "the full caption: hook line first, 2-4 short lines, the CTA last. No hashtags here.",
  "hashtags": "#tag1 #tag2 ... (8-15 hashtags tuned to this account and reel)"
}

Rules:
- Respond with ONLY the JSON object
- First line must work as a standalone hook (it shows before "... more")
- Match the account voice exactly; no generic AI filler phrases`,
    }],
  });

  const text = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map(b => b.text).join("").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let parsed: { caption?: string; hashtags?: string };
  try {
    parsed = JSON.parse(text) as { caption?: string; hashtags?: string };
  } catch {
    throw new Error("Caption generator returned invalid JSON.");
  }
  const caption = applyDisclosure(String(parsed.caption ?? "").trim(), persona);
  const hashtags = String(parsed.hashtags ?? brief.hashtags).trim();
  if (!caption) throw new Error("Caption generator returned an empty caption.");

  await saveRun(run.id, {
    caption,
    hashtags,
    scheduled_for: nextPostingSlot(account.posting_hour_utc),
    status: "captioned",
    error_message: null,
  });
  return { from: "assembled", to: "captioned" };
}

// ─── Stage: captioned → publishing (waits for the scheduled slot) ────────────

async function stageStartPublish(run: ReelRun): Promise<AdvanceResult> {
  // Defense-in-depth: the tick route already gates on REELS_PAUSED, but no
  // Instagram container may ever be created while the kill switch is on.
  if (publishingPaused()) {
    return { from: "captioned", to: "captioned", note: "publishing paused by REELS_PAUSED" };
  }
  if (run.scheduled_for && new Date(run.scheduled_for).getTime() > Date.now()) {
    return { from: "captioned", to: "captioned", note: `waiting for slot ${run.scheduled_for}` };
  }

  const brief = run.brief as ReelBrief | null;
  const account = await getAccount(run.account_id);
  const videoUrl = assembledVideoUrl(run);
  const fullCaption = [run.caption, run.hashtags].filter(Boolean).join("\n\n");
  const keyframes = run.keyframes as Keyframe[];

  // Create the ig_posts row first so the dashboard sees the reel immediately.
  let igPostId = run.ig_post_id;
  if (!igPostId) {
    const { data: postRow, error: postErr } = await supabaseServer
      .from("ig_posts")
      .insert({
        title: brief?.title ?? "Autopilot reel",
        caption: fullCaption,
        media_type: "reel",
        image_url: keyframes?.[0]?.url ?? null, // cover thumbnail for the library UI
        video_url: videoUrl,
        video_storage_path: run.assembled_video_path,
        account_id: run.account_id,
        status: "publishing",
      })
      .select("id")
      .single();
    if (postErr || !postRow) throw new Error(`Could not create ig_post: ${postErr?.message ?? "unknown"}`);
    igPostId = postRow.id as number;
    await saveRun(run.id, { ig_post_id: igPostId });
  }

  const log = createLogger();
  const container = await createReelsContainer(account.ig_user_id, account.access_token, videoUrl, fullCaption, log);
  if ("error" in container) {
    await supabaseServer.from("ig_posts").update({ status: "failed", error_message: container.error, updated_at: new Date().toISOString() }).eq("id", igPostId);
    throw new Error(`Reels container creation failed: ${container.error}`);
  }

  await saveRun(run.id, { container_id: container.containerId, status: "publishing", error_message: null });
  return { from: "captioned", to: "publishing", note: `container ${container.containerId}` };
}

function assembledVideoUrl(run: ReelRun): string {
  if (!run.assembled_video_path) throw new Error("Run has no assembled video.");
  return publicUrlFor(run.assembled_video_path);
}

// ─── Stage: publishing → published ───────────────────────────────────────────

async function stageFinishPublish(run: ReelRun): Promise<AdvanceResult> {
  // Freeze before media_publish too — an already-created container just waits
  // (containers stay valid for a while; a long pause may expire it, which the
  // attempt machinery then surfaces as a failed run rather than a silent post).
  if (publishingPaused()) {
    return { from: "publishing", to: "publishing", note: "publishing paused by REELS_PAUSED" };
  }
  const account = await getAccount(run.account_id);
  const log = createLogger();
  const brief = run.brief as ReelBrief;

  const status = await checkContainerStatus(run.container_id as string, account.access_token, log);
  if ("error" in status) throw new Error(`Container processing failed: ${status.error}`);

  if (status.statusCode === "IN_PROGRESS") {
    const startedMs = run.scheduled_for ? new Date(run.scheduled_for).getTime() : new Date(run.created_at).getTime();
    if (Date.now() - startedMs > PUBLISH_TIMEOUT_H * 3_600_000) {
      throw new Error(`Container still processing after ${PUBLISH_TIMEOUT_H}h — giving up.`);
    }
    return { from: "publishing", to: "publishing", note: "container still processing" };
  }

  const published = await publishContainer(account.ig_user_id, run.container_id as string, account.access_token, log);
  if ("error" in published) throw new Error(`media_publish failed: ${published.error}`);

  const permalinkResult = await getMediaPermalink(published.mediaId, account.access_token, log);
  const permalink = "error" in permalinkResult ? null : permalinkResult.permalink;
  const now = new Date().toISOString();
  const fullCaption = [run.caption, run.hashtags].filter(Boolean).join("\n\n");
  const videoUrl = assembledVideoUrl(run);

  // publish_jobs history row (image_url column doubles as the media URL here)
  const { data: job } = await supabaseServer
    .from("publish_jobs")
    .insert({
      account_id: run.account_id,
      caption: fullCaption,
      image_url: videoUrl,
      container_id: run.container_id,
      media_id: published.mediaId,
      permalink,
      status: "published",
      log_steps: log.all(),
      published_at: now,
    })
    .select("id")
    .single();

  if (run.ig_post_id) {
    await supabaseServer.from("ig_posts").update({
      status: "published",
      media_id: published.mediaId,
      permalink,
      publish_job_id: job?.id ?? null,
      published_at: now,
      published_by_scheduler: true,
      error_message: null,
      updated_at: now,
    }).eq("id", run.ig_post_id);

    // The pipeline knows its own attributes — feed the learning engine directly.
    await supabaseServer.from("post_attributes").upsert({
      post_id: run.ig_post_id,
      content_pillar: brief?.content_pillar ?? null,
      caption_style: "reel-hook",
      media_source: "ai_generated",
      hashtag_set: (run.hashtags ?? "").split(/\s+/).filter(t => t.startsWith("#")),
      updated_at: now,
    }, { onConflict: "post_id" });
  }

  await saveRun(run.id, {
    status: "published",
    media_id: published.mediaId,
    permalink,
    published_at: now,
    error_message: null,
  });
  return { from: "publishing", to: "published", note: permalink ?? published.mediaId };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function advanceRun(run: ReelRun): Promise<AdvanceResult> {
  switch (run.status) {
    case "queued": return stageBrief(run);
    case "briefed": return stageKeyframes(run);
    case "keyframes_ready": return stageSubmitClips(run);
    case "clips_generating": return stageCollectClips(run);
    case "clips_ready": return stageAssemble(run);
    case "assembled": return stageCaption(run);
    case "captioned": return stageStartPublish(run);
    case "publishing": return stageFinishPublish(run);
    default:
      return { from: run.status, to: run.status, note: "nothing to do" };
  }
}

// Attempt accounting shared by the tick route: returns the patch to apply when
// a stage throws. Three strikes parks the run as failed with its stage recorded.
export function failurePatch(run: ReelRun, message: string): Record<string, unknown> {
  const attempts = (run.attempt_count ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return { attempt_count: attempts, status: "failed", failed_stage: run.status, error_message: message };
  }
  return { attempt_count: attempts, error_message: message };
}
