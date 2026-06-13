// Stage handlers for the reel pipeline. The tick route leases a run and calls
// advanceRun(), which executes exactly ONE stage transition and persists it.
// Every handler is idempotent: partial progress (keyframes, clips) is saved as
// it happens, so a crashed or timed-out tick resumes where it stopped.

import { supabaseServer } from "@/lib/supabase-server";
import { anthropic } from "@/lib/claude";
import { getImageProvider, IMAGE_DAILY_CAP } from "@/lib/media-generation";
import { submitImageToVideo, checkVideoJob, submitLipsync, checkLipsyncJob } from "@/lib/media-generation/fal";
import { heygenEnabled, submitTalkingImage, checkHeygenVideo } from "@/lib/media-generation/heygen";
import { estimateRunCost } from "@/lib/reels/cost";
import { generateReelBrief } from "@/lib/reels/strategist";
import { resolveMusic, synthesizeVoiceover, voiceoverEnabled } from "@/lib/reels/audio";
import { assembleReel } from "@/lib/reels/assemble";
import { renderCover } from "@/lib/reels/cover";
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
import { checkPostingSpacing } from "@/lib/media-network/spacing";
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
  reels_presenter_enabled: boolean;
  reels_avatar_path: string | null;
  reels_avatar_prompt: string | null;
  reels_voice_instructions: string | null;
};

async function getAccount(accountId: number): Promise<AccountRow> {
  const { data, error } = await supabaseServer
    .from("connected_accounts")
    .select(
      "id, account_name, ig_user_id, access_token, niche, posting_hour_utc, " +
      "reels_presenter_enabled, reels_avatar_path, reels_avatar_prompt, reels_voice_instructions"
    )
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error(`Connected account ${accountId} not found — was it disconnected?`);
  // Cast via unknown: supabase-js can't type-parse a concatenated select string.
  return data as unknown as AccountRow;
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
  const { brief, personaId } = await generateReelBrief(account, run.directives);

  // Cost guard: nothing paid is generated for a run whose worst-case estimate
  // exceeds REELS_MAX_COST_USD (owner-approved cap, default $12).
  const cost = estimateRunCost(brief);
  brief.cost_estimate = { totalUsd: cost.totalUsd, capUsd: cost.capUsd };
  if (!cost.withinBudget) {
    throw new Error(
      `Cost guard: estimated $${cost.totalUsd} exceeds the $${cost.capUsd} per-reel cap — run blocked before any generation. Raise REELS_MAX_COST_USD only with manual approval.`
    );
  }

  await saveRun(run.id, { brief, persona_id: personaId, status: "briefed", error_message: null });
  return { from: "queued", to: "briefed", note: `${brief.title} (est $${cost.totalUsd})` };
}

// ─── Persistent avatar (presenter mode) ──────────────────────────────────────
// One avatar per account, generated once and reused as the reference image for
// every avatar keyframe — that reuse is what keeps the host's face consistent.
// The look is AI-designed from the account's persona/niche plus fixed traits.

async function ensureAvatar(account: AccountRow): Promise<{ buffer: Buffer; mimeType: string }> {
  if (account.reels_avatar_path) {
    // Re-encode the stored PNG reference (~2-3MB) to JPEG (~300KB) — identical
    // identity anchoring, ~10x smaller multipart upload to images/edits (large
    // bodies correlate with the 502 gateway flakes we've observed).
    const png = await downloadFromBucket(account.reels_avatar_path);
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(png).jpeg({ quality: 88 }).toBuffer();
    return { buffer: jpeg, mimeType: "image/jpeg" };
  }

  // A pre-seeded reels_avatar_prompt is the design brief (set per account, e.g.
  // from the owner's identity spec). Fallback: generic brief from persona/niche.
  // Either way the host must be FICTIONAL — never a real person or celebrity.
  const persona = await getPersonaForAccount(account.id);
  const prompt = account.reels_avatar_prompt?.trim() || [
    "Design the single recurring on-camera host for this short-form nature channel.",
    "A completely fictional person — must not resemble or be based on any real person or celebrity.",
    "A friendly, warm, approachable presenter with an open smile, looking straight into the camera,",
    "chest-up portrait, soft natural outdoor lighting, photorealistic, neutral outdoor backdrop.",
    "Natural realistic proportions, not cartoonish, not overly model-like.",
    "Practical outdoor field clothing. No text, no logos, no watermark.",
    persona?.visual_style ? `Channel visual style: ${persona.visual_style}` : null,
    account.niche ? `Channel niche: ${account.niche}` : null,
  ].filter(Boolean).join("\n");

  const provider = getImageProvider();
  const result = await provider.generateImage(prompt, { size: "1024x1536" });
  const upload = await uploadToBucket(
    `reels/avatars/account-${account.id}.png`,
    Buffer.from(result.base64, "base64"),
    result.mimeType
  );

  const { error } = await supabaseServer
    .from("connected_accounts")
    .update({ reels_avatar_path: upload.path, reels_avatar_prompt: prompt })
    .eq("id", account.id);
  if (error) throw new Error(`Could not save avatar for account ${account.id}: ${error.message}`);

  console.log(`[reels/avatar] generated persistent avatar for @${account.account_name} → ${upload.path}`);
  return { buffer: Buffer.from(result.base64, "base64"), mimeType: "image/png" };
}

// ─── Stage: briefed → keyframes_ready ────────────────────────────────────────
// One gpt-image-1 portrait keyframe per beat, time-budgeted: generates as many
// as fit in this tick and stays in "briefed" until every beat has one.
// Presenter mode: avatar beats are rendered via images/edits with the account's
// avatar as the reference so the host looks identical in every shot.

async function stageKeyframes(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const account = await getAccount(run.account_id);
  const presenter = account.reels_presenter_enabled;
  const avatar = presenter ? await ensureAvatar(account) : null;
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
    const isAvatarBeat = presenter && beat.shot_type === "avatar";

    let result;
    let promptUsed: string;
    if (isAvatarBeat && avatar && provider.editImage) {
      // Reference-based render: same host, new scene + location-matched wardrobe.
      promptUsed = [
        "Place this exact person (same face, same identity, same hairstyle, same facial hair) into the following scene as a selfie-vlogging host: arm's-length selfie POV, chest-up, slight wide-angle feel, direct eye contact with the camera, mid-speech, friendly animated expression, clearly in motion through the location.",
        "This is a fictional recurring host — do not make them resemble any real person or celebrity.",
        brief.wardrobe ? `They are wearing: ${brief.wardrobe}` : null,
        brief.event_location ? `Location: ${brief.event_location} — the setting must look like the real place.` : null,
        beat.image_prompt,
        brief.visual_style,
        "Natural premium lighting, realistic cinematic quality. Vertical 9:16 composition. No text or lettering in the image.",
      ].filter(Boolean).join("\n\n");
      result = await provider.editImage(promptUsed, avatar, { size: "1024x1536" });
    } else {
      promptUsed = [
        brief.visual_style,
        brief.event_location ? `Real location: ${brief.event_location} — geography, vegetation, and weather must match the real place.` : null,
        beat.image_prompt,
        "Vertical 9:16 composition. No text or lettering in the image.",
      ].filter(Boolean).join("\n\n");
      result = await provider.generateImage(promptUsed, { size: "1024x1536" });
    }
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
      prompt_used: promptUsed,
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
// Voiceover-first: every speaking beat gets its TTS mp3 up front, because the
// HeyGen path consumes audio at submit time (the clip IS the lip-synced
// performance). Routing: avatar beats → HeyGen talking-image (primary), with a
// graceful per-beat fallback to Kling i2v (+ later lipsync) when HeyGen is
// unconfigured or errors; broll beats → Kling i2v.

async function submitBeatClip(
  run: ReelRun,
  brief: ReelBrief,
  kf: Keyframe,
  voAudioPath: string | undefined
): Promise<Clip> {
  const beat = brief.beats[kf.beat_index];
  const isAvatarBeat = beat.shot_type === "avatar";
  const base = {
    beat_index: kf.beat_index,
    submitted_at: new Date().toISOString(),
    status: "submitted" as const,
    ...(voAudioPath ? { vo_audio_path: voAudioPath } : {}),
  };

  if (isAvatarBeat && voAudioPath && heygenEnabled()) {
    try {
      const { videoId } = await submitTalkingImage({
        imageUrl: kf.url,
        audioUrl: publicUrlFor(voAudioPath),
        motionPrompt: beat.motion_prompt,
        title: `run-${run.id}-beat-${kf.beat_index}`,
      });
      return { ...base, provider: "heygen", request_id: videoId };
    } catch (e) {
      // Graceful fallback: this beat takes the Kling + lipsync path instead.
      console.error(
        `[reels/stages] HeyGen submit failed for run ${run.id} beat ${kf.beat_index} — falling back to Kling:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  const { requestId } = await submitImageToVideo({
    prompt: `${beat.motion_prompt}. Style: ${brief.visual_style}`,
    imageUrl: kf.url,
    durationS: beat.duration_s,
  });
  return { ...base, provider: "kling", request_id: requestId };
}

async function stageSubmitClips(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const account = await getAccount(run.account_id);
  const keyframes = run.keyframes as Keyframe[];
  const clips: Clip[] = [];

  // 1) Voiceovers for every speaking beat (idempotent — keyed paths).
  const voByBeat = new Map<number, string>();
  if (account.reels_presenter_enabled) {
    for (const kf of keyframes) {
      const beat = brief.beats[kf.beat_index];
      if (!beat?.voiceover_line) continue;
      const audio = await synthesizeVoiceover(beat.voiceover_line, account.reels_voice_instructions);
      const upload = await uploadToBucket(`reels/${run.id}/vo-${kf.beat_index}.mp3`, audio, "audio/mpeg");
      voByBeat.set(kf.beat_index, upload.path);
    }
  }

  // 2) Clip jobs, provider-routed.
  for (const kf of keyframes) {
    clips.push(await submitBeatClip(run, brief, kf, voByBeat.get(kf.beat_index)));
  }

  const heygenCount = clips.filter(c => c.provider === "heygen").length;
  await saveRun(run.id, { clips, status: "clips_generating", error_message: null });
  return {
    from: "keyframes_ready",
    to: "clips_generating",
    note: `${clips.length} clip jobs (${heygenCount} heygen, ${clips.length - heygenCount} kling)`,
  };
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

    const check = clip.provider === "heygen"
      ? await checkHeygenVideo(clip.request_id)
      : await checkVideoJob(clip.request_id);

    if (check.status === "done") {
      const buffer = await fetchToBuffer(check.videoUrl);
      const upload = await uploadToBucket(`reels/${run.id}/clip-${clip.beat_index}.mp4`, buffer, "video/mp4");
      clip.status = "done";
      clip.provider_url = check.videoUrl;
      clip.storage_path = upload.path;
      clip.url = upload.publicUrl;
      // A HeyGen talking-image clip is already mouth-matched to its audio.
      if (clip.provider === "heygen") clip.lipsynced = true;
      await saveRun(run.id, { clips });
    } else if (check.status === "failed") {
      clip.status = "failed";
      clip.error = check.error;
      failures.push(`beat ${clip.beat_index} (${clip.provider ?? "kling"}): ${check.error}`);
    } else {
      const ageMin = (Date.now() - new Date(clip.submitted_at).getTime()) / 60_000;
      if (ageMin > CLIP_TIMEOUT_MIN) {
        clip.status = "failed";
        clip.error = `provider job stale after ${Math.round(ageMin)} min`;
        failures.push(`beat ${clip.beat_index} (${clip.provider ?? "kling"}): stale job`);
      }
    }
  }

  if (failures.length > 0) {
    // Resubmit failed beats now so the retry is already in flight, then throw
    // so the tick's attempt accounting applies (MAX_ATTEMPTS strikes → failed).
    // A failed HeyGen clip falls back to Kling i2v — the lipsync stage will
    // mouth-match it afterwards.
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
      clip.provider = "kling";
      clip.request_id = requestId;
      clip.submitted_at = new Date().toISOString();
      clip.status = "submitted";
      clip.lipsynced = false;
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

// ─── Stage: clips_ready → lipsyncing (presenter) or assembled ────────────────
// Presenter mode: synthesize each beat's voiceover line (account voice
// instructions carry the accent), then send every avatar clip + its line to the
// lip-sync model so mouth movement matches the words. B-roll lines are kept as
// narration and mixed in at assembly. Non-presenter runs fall through to
// assembly directly.

async function stageLipsyncOrAssemble(run: ReelRun): Promise<AdvanceResult> {
  const account = await getAccount(run.account_id);
  const brief = run.brief as ReelBrief;
  const clips: Clip[] = [...(run.clips ?? [])];

  const avatarPending = account.reels_presenter_enabled
    ? clips.filter(c => brief.beats[c.beat_index]?.shot_type === "avatar" && !c.lipsynced)
    : [];

  if (avatarPending.length === 0) {
    return stageAssemble(run);
  }

  // 1) Voiceover mp3 for every beat that speaks (avatar AND broll) — generated
  //    once, reused by lipsync now and by the audio mix at assembly.
  for (const clip of clips) {
    const beat = brief.beats[clip.beat_index];
    if (!beat?.voiceover_line || clip.vo_audio_path) continue;
    const audio = await synthesizeVoiceover(beat.voiceover_line, account.reels_voice_instructions);
    const upload = await uploadToBucket(`reels/${run.id}/vo-${clip.beat_index}.mp3`, audio, "audio/mpeg");
    clip.vo_audio_path = upload.path;
    await saveRun(run.id, { clips });
  }

  // 2) Lip-sync jobs for the avatar clips.
  for (const clip of avatarPending) {
    if (clip.lipsync_request_id || !clip.url || !clip.vo_audio_path) continue;
    const { requestId } = await submitLipsync({
      videoUrl: clip.url,
      audioUrl: publicUrlFor(clip.vo_audio_path),
    });
    clip.lipsync_request_id = requestId;
    clip.lipsync_submitted_at = new Date().toISOString();
  }

  await saveRun(run.id, { clips, status: "lipsyncing", error_message: null });
  return { from: "clips_ready", to: "lipsyncing", note: `${avatarPending.length} avatar clip(s) submitted for lip sync` };
}

// ─── Stage: lipsyncing → clips_ready ─────────────────────────────────────────
// Polls lip-sync jobs; replaces each avatar clip in storage with the
// mouth-matched version. Failures/stale jobs are resubmitted, costing one
// attempt. When every avatar clip is lipsynced the run returns to clips_ready,
// where the pending check now passes and assembly runs next tick.

async function stageLipsyncPoll(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const clips: Clip[] = [...(run.clips ?? [])];
  const failures: string[] = [];

  const avatarClips = clips.filter(c => brief.beats[c.beat_index]?.shot_type === "avatar");

  for (const clip of avatarClips) {
    if (clip.lipsynced || !clip.lipsync_request_id) continue;

    const check = await checkLipsyncJob(clip.lipsync_request_id);
    if (check.status === "done") {
      const buffer = await fetchToBuffer(check.videoUrl);
      const upload = await uploadToBucket(`reels/${run.id}/clip-${clip.beat_index}.mp4`, buffer, "video/mp4");
      clip.storage_path = upload.path;
      clip.url = upload.publicUrl;
      clip.lipsynced = true;
      await saveRun(run.id, { clips });
    } else if (check.status === "failed") {
      failures.push(`beat ${clip.beat_index}: ${check.error}`);
      clip.lipsync_request_id = undefined;
    } else {
      const ageMin = clip.lipsync_submitted_at
        ? (Date.now() - new Date(clip.lipsync_submitted_at).getTime()) / 60_000
        : 0;
      if (ageMin > CLIP_TIMEOUT_MIN) {
        failures.push(`beat ${clip.beat_index}: lipsync job stale after ${Math.round(ageMin)} min`);
        clip.lipsync_request_id = undefined;
      }
    }
  }

  if (failures.length > 0) {
    // Resubmit cleared jobs now; throw so attempt accounting applies.
    for (const clip of avatarClips) {
      if (clip.lipsynced || clip.lipsync_request_id || !clip.url || !clip.vo_audio_path) continue;
      const { requestId } = await submitLipsync({
        videoUrl: clip.url,
        audioUrl: publicUrlFor(clip.vo_audio_path),
      });
      clip.lipsync_request_id = requestId;
      clip.lipsync_submitted_at = new Date().toISOString();
    }
    await saveRun(run.id, { clips });
    throw new Error(`Lip sync failed (resubmitted): ${failures.join("; ")}`);
  }

  if (avatarClips.every(c => c.lipsynced)) {
    await saveRun(run.id, { clips, status: "clips_ready", error_message: null });
    return { from: "lipsyncing", to: "clips_ready", note: `${avatarClips.length} avatar clip(s) mouth-matched` };
  }

  const done = avatarClips.filter(c => c.lipsynced).length;
  return { from: "lipsyncing", to: "lipsyncing", note: `lipsync ${done}/${avatarClips.length} done` };
}

// ─── Stage: clips_ready → assembled ──────────────────────────────────────────

async function stageAssemble(run: ReelRun): Promise<AdvanceResult> {
  const brief = run.brief as ReelBrief;
  const account = await getAccount(run.account_id);
  const clipRows = (run.clips as Clip[]).filter(c => c.status === "done" && c.storage_path);
  clipRows.sort((a, b) => a.beat_index - b.beat_index);

  const clips = [];
  for (const c of clipRows) {
    clips.push({ beatIndex: c.beat_index, buffer: await downloadFromBucket(c.storage_path as string) });
  }

  const totalS = brief.beats.reduce((s, b) => s + b.duration_s, 0);
  const music = await resolveMusic(brief.audio_mood, totalS);

  // Per-beat voiceovers, placed at each beat's offset in the timeline. Avatar
  // beats use the SAME mp3 the lip-sync ran against, so mouths stay matched.
  const voiceovers: { beatIndex: number; buffer: Buffer }[] = [];
  if (account.reels_presenter_enabled) {
    for (const c of clipRows) {
      if (c.vo_audio_path) {
        voiceovers.push({ beatIndex: c.beat_index, buffer: await downloadFromBucket(c.vo_audio_path) });
      }
    }
  } else if (brief.voiceover_script && voiceoverEnabled()) {
    voiceovers.push({ beatIndex: 0, buffer: await synthesizeVoiceover(brief.voiceover_script, account.reels_voice_instructions) });
  }

  const finalVideo = await assembleReel({
    clips,
    beats: brief.beats,
    music: music.source === "none" ? null : music.buffer,
    voiceovers,
  });

  const upload = await uploadToBucket(`reels/${run.id}/final.mp4`, finalVideo, "video/mp4");
  const audio: ReelRunAudio = {
    music_source: music.source,
    ...(music.source === "library" ? { music_track_id: music.trackId } : {}),
    voiceover: voiceovers.length > 0,
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
    brief.event_location ? `- Real event/location: ${brief.event_location} (facts in the caption must match it)` : null,
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
      content: `Write the Instagram caption for this Reel, following an evidence-based viral ruleset.

${context}
${brief.debatable_detail ? `- Debatable detail to spark comments: ${brief.debatable_detail}` : ""}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "caption": "the full caption. No hashtags here.",
  "hashtags": "#tag1 #tag2 #tag3 (3-5 hashtags total: 1 broad topic, 2-3 niche/event-specific)"
}

Caption rules (follow exactly):
- Respond with ONLY the JSON object
- Total caption length 100-150 words
- LINE 1: a keyword-bearing re-hook — write it as the exact search phrase + stakes a target viewer would respond to (it is the only line shown before "... more"). Never start with an emoji
- BODY: 2-4 short lines adding ONE true fact that is NOT in the video (reward for expanding the caption)
- Include the debatable question to invite comments — phrased genuinely, answerable in a few words
- FINAL LINE: one save- or share-oriented CTA (e.g. "Save this for your next trivia night" / "Send this to the friend who'd survive it"). NEVER "like if", "comment YES", or any mechanical engagement bait
- Match the account voice exactly; no generic AI filler phrases
- 3-5 hashtags only — never more`,
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

  // V15: render the grid cover from the hook keyframe (host face shot) + the
  // brief's cover title. Non-fatal — a reel without a custom cover still ships.
  let coverPath: string | null = run.cover_path ?? null;
  if (!coverPath) {
    try {
      const keyframes = (run.keyframes ?? []) as Keyframe[];
      const hookKf = keyframes.find(k => k.beat_index === 0) ?? keyframes[0];
      if (hookKf) {
        const kfBuffer = await downloadFromBucket(hookKf.storage_path);
        const title = brief.cover_title || brief.title;
        const cover = await renderCover(kfBuffer, title);
        const upload = await uploadToBucket(`reels/${run.id}/cover.jpg`, cover, "image/jpeg");
        coverPath = upload.path;
      }
    } catch (e) {
      console.error(`[reels/stages] cover render failed for run ${run.id} (continuing without):`, e instanceof Error ? e.message : e);
    }
  }

  await saveRun(run.id, {
    caption,
    hashtags,
    cover_path: coverPath,
    scheduled_for: nextPostingSlot(account.posting_hour_utc),
    status: "captioned",
    error_message: null,
  });
  return { from: "assembled", to: "captioned", note: coverPath ? "cover rendered" : "no cover" };
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

  // Per-brand anti-burst spacing (media-network brands; accounts without a
  // brand are unconstrained). A held run just waits for the next tick.
  const spacing = await checkPostingSpacing(run.account_id);
  if (!spacing.allowed) {
    return { from: "captioned", to: "captioned", note: `spacing hold — ${spacing.waitMinutes}m until this account may post again` };
  }

  const brief = run.brief as ReelBrief | null;
  const account = await getAccount(run.account_id);
  const videoUrl = assembledVideoUrl(run);
  const fullCaption = [run.caption, run.hashtags].filter(Boolean).join("\n\n");
  const keyframes = run.keyframes as Keyframe[];
  const coverUrl = run.cover_path ? publicUrlFor(run.cover_path) : null;

  // Create the ig_posts row first so the dashboard sees the reel immediately.
  let igPostId = run.ig_post_id;
  if (!igPostId) {
    const { data: postRow, error: postErr } = await supabaseServer
      .from("ig_posts")
      .insert({
        title: brief?.title ?? "Autopilot reel",
        caption: fullCaption,
        media_type: "reel",
        image_url: coverUrl ?? keyframes?.[0]?.url ?? null, // cover thumbnail for the library UI
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
  const container = await createReelsContainer(account.ig_user_id, account.access_token, videoUrl, fullCaption, log, coverUrl);
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
    case "clips_ready": return stageLipsyncOrAssemble(run);
    case "lipsyncing": return stageLipsyncPoll(run);
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
