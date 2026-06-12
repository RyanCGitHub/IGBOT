// Content strategist — turns an account's niche, persona, learnings, and past
// performance into a structured Reel brief. Pure generation: no side effects
// beyond the Claude call; the tick route persists the result on the run.

import { anthropic } from "@/lib/claude";
import { supabaseServer } from "@/lib/supabase-server";
import { getPersonaForAccount, personaPromptBlock } from "@/lib/persona";
import { getActiveLearnings, learningsPromptBlock } from "@/lib/learning";
import { engagementScore } from "@/lib/engagement";
import { AUDIO_MOODS, type ReelBrief, type ReelBeat } from "@/lib/reels/types";

const MODEL = "claude-sonnet-4-5";
const MIN_BEATS = 3;
const MAX_BEATS = 5;
const RECENT_POSTS = 10;

type AccountRow = {
  id: number;
  account_name: string;
  niche: string | null;
  reels_presenter_enabled?: boolean;
};

// Recent published posts with engagement scores so the strategist can lean
// into what worked. Empty string when there is no history yet (cold start).
async function recentPerformanceBlock(accountId: number): Promise<string> {
  const { data: posts } = await supabaseServer
    .from("ig_posts")
    .select("id, title, caption, media_type, published_at")
    .eq("account_id", accountId)
    .in("status", ["published", "republished"])
    .order("published_at", { ascending: false })
    .limit(RECENT_POSTS);

  if (!posts || posts.length === 0) return "";

  const ids = posts.map(p => p.id as number);
  const { data: insights } = await supabaseServer
    .from("post_insights")
    .select("post_id, likes, comments, saves, shares, reach")
    .in("post_id", ids);
  const byPost = new Map((insights ?? []).map(i => [i.post_id as number, i]));

  const lines = posts.map(p => {
    const ins = byPost.get(p.id as number);
    const score = ins
      ? engagementScore({
          likes: ins.likes, comments: ins.comments, saves: ins.saves,
          shares: ins.shares, reach: ins.reach,
        })
      : null;
    const firstLine = String(p.caption ?? "").split("\n")[0].slice(0, 120);
    return `- [${p.media_type}] "${p.title || firstLine}" — ${
      score ? `engagement score ${score.score.toFixed(3)}${score.reachNormalized ? " (reach-normalized)" : ""}` : "no insights yet"
    }`;
  });

  return ["Recent published posts and how they performed:", ...lines].join("\n");
}

function buildPrompt(parts: {
  accountName: string;
  niche: string | null;
  presenter: boolean;
  personaBlock: string;
  learningsBlock: string;
  performanceBlock: string;
  recentHooks: string[];
}): string {
  const context = [
    `Instagram account: @${parts.accountName}`,
    parts.niche ? `Account niche: ${parts.niche}` : null,
    parts.personaBlock || null,
    parts.learningsBlock || null,
    parts.performanceBlock || null,
    parts.recentHooks.length
      ? `Hooks already used recently (do NOT repeat these angles):\n${parts.recentHooks.map(h => `- ${h}`).join("\n")}`
      : null,
  ].filter(Boolean).join("\n\n");

  if (parts.presenter) {
    return `You are a short-form video strategist planning ONE Instagram Reel for this account. Format: a friendly on-camera AVATAR HOST walks viewers through ONE real, documented natural event. Production is fully automatic: each beat becomes one AI keyframe animated into a ~5 second vertical clip; "avatar" beats show the host speaking (the mouth is lip-synced to the voiceover line), "broll" beats show the event/location itself with narration; subtitles are burned on screen and music sits under everything.

${context}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "title": "internal working title",
  "hook": "the scroll-stopping idea of the reel in one sentence",
  "content_pillar": "short label for this account's content pillar",
  "event_location": "the real place and year of the event, e.g. 'Lake Nyos, Cameroon, 1986'",
  "wardrobe": "what the host wears, matched to this location/climate, one sentence",
  "beats": [
    {
      "shot_type": "avatar or broll",
      "voiceover_line": "what the host says during this beat, max 12 words, spoken language",
      "subtitle": "on-screen text, max 60 characters (may compress the voiceover line)",
      "image_prompt": "detailed visual description of the keyframe. Vertical 9:16.",
      "motion_prompt": "how the shot moves (camera + subject), one sentence",
      "duration_s": 5
    }
  ],
  "visual_style": "one consistent cinematic style direction applied to every keyframe",
  "audio_mood": "one of: ${AUDIO_MOODS.join(" | ")}",
  "voiceover_script": null,
  "caption_angle": "2-3 sentences describing the caption direction and tone",
  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5",
  "cta": "a specific call to action for the caption"
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- The event must be REAL and documented (no inventions). Name the real place; get the geography, climate, vegetation, and phenomenon visually right
- ${MIN_BEATS} to ${MAX_BEATS} beats, each duration_s between 3 and 6
- Beat 1 MUST be shot_type "avatar" (the host delivers the hook to camera) and the LAST beat must be "avatar" (host wraps up / CTA). Middle beats should be mostly "broll" of the event
- Every beat needs a voiceover_line; together they form one continuous mini-story
- voiceover_line must be max 12 words — it has to fit in ~5 seconds of speech
- avatar image_prompt: describe the SCENE around the host (location, weather, lighting, camera distance: chest-up, facing camera, mid-speech). Do NOT describe the host's face or identity — the host's appearance comes from a fixed reference image. DO include the wardrobe
- broll image_prompt: the event/location itself, visually accurate to the real place. No people unless historically appropriate
- No text or lettering in any image
- Favor angles the performance data says worked; avoid what underperformed`;
  }

  return `You are a short-form video strategist planning ONE Instagram Reel for this account. The Reel will be produced fully automatically: each beat becomes one AI-generated keyframe image that is animated into a ~5 second vertical clip, the beats are cut together, the subtitle of each beat is burned on screen, and an instrumental soundtrack (plus optional voiceover) is mixed underneath.

${context}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "title": "internal working title",
  "hook": "the scroll-stopping idea of the reel in one sentence",
  "content_pillar": "which content pillar of this account the reel belongs to (short label)",
  "beats": [
    {
      "subtitle": "on-screen text for this beat, max 60 characters, plain language",
      "image_prompt": "detailed visual description of the keyframe for this beat (subject, composition, lighting). Vertical 9:16 framing.",
      "motion_prompt": "how the shot moves (camera + subject), one sentence",
      "duration_s": 5
    }
  ],
  "visual_style": "one consistent style direction applied to every keyframe",
  "audio_mood": "one of: ${AUDIO_MOODS.join(" | ")}",
  "voiceover_script": "a spoken script of 30-60 words matching the beats, or null if this reel works better with text + music only",
  "caption_angle": "2-3 sentences describing the caption direction and tone",
  "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5",
  "cta": "a specific call to action for the caption"
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- ${MIN_BEATS} to ${MAX_BEATS} beats, each duration_s between 3 and 6
- Beat 1 IS the hook — its subtitle must make someone stop scrolling
- The beats must read as one continuous mini-story, not disconnected slides
- image_prompt must describe a SINGLE still frame (no text in the image — text is added separately)
- Stay strictly in this account's niche and persona voice
- Favor angles the performance data says worked; avoid what underperformed`;
}

function clampBrief(raw: Record<string, unknown>, presenter: boolean): ReelBrief {
  const beatsIn = Array.isArray(raw.beats) ? (raw.beats as Record<string, unknown>[]) : [];
  if (beatsIn.length < MIN_BEATS) {
    throw new Error(`Brief has ${beatsIn.length} beats — need at least ${MIN_BEATS}.`);
  }

  const beats: ReelBeat[] = beatsIn.slice(0, MAX_BEATS).map((b, i) => {
    const subtitle = String(b.subtitle ?? "").trim().slice(0, 80);
    const image_prompt = String(b.image_prompt ?? "").trim();
    if (!subtitle || !image_prompt) throw new Error(`Beat ${i + 1} is missing subtitle or image_prompt.`);
    const d = Number(b.duration_s);
    const beat: ReelBeat = {
      subtitle,
      image_prompt,
      motion_prompt: String(b.motion_prompt ?? "slow cinematic push-in").trim(),
      duration_s: Number.isFinite(d) ? Math.min(Math.max(d, 3), 6) : 5,
    };
    if (presenter) {
      beat.shot_type = b.shot_type === "avatar" ? "avatar" : "broll";
      const line = String(b.voiceover_line ?? "").trim();
      if (!line) throw new Error(`Beat ${i + 1} is missing voiceover_line (required in presenter mode).`);
      // ~12 words max so the line fits the clip; hard-trim runaway lines.
      beat.voiceover_line = line.split(/\s+/).slice(0, 16).join(" ");
    }
    return beat;
  });

  if (presenter) {
    // The format requires the host on camera at the open and close.
    if (beats[0].shot_type !== "avatar") beats[0].shot_type = "avatar";
    if (beats[beats.length - 1].shot_type !== "avatar") beats[beats.length - 1].shot_type = "avatar";
  }

  const mood = String(raw.audio_mood ?? "").toLowerCase().trim();
  const voiceover = !presenter && typeof raw.voiceover_script === "string" && raw.voiceover_script.trim()
    ? raw.voiceover_script.trim()
    : null;

  return {
    title: String(raw.title ?? "Untitled reel").trim(),
    hook: String(raw.hook ?? "").trim(),
    content_pillar: String(raw.content_pillar ?? "general").trim(),
    event_location: presenter ? String(raw.event_location ?? "").trim() || null : null,
    wardrobe: presenter ? String(raw.wardrobe ?? "").trim() || null : null,
    beats,
    visual_style: String(raw.visual_style ?? "").trim(),
    audio_mood: (AUDIO_MOODS as readonly string[]).includes(mood) ? mood : "chill",
    voiceover_script: voiceover,
    caption_angle: String(raw.caption_angle ?? "").trim(),
    hashtags: String(raw.hashtags ?? "").trim(),
    cta: String(raw.cta ?? "").trim(),
  };
}

export async function generateReelBrief(account: AccountRow): Promise<{ brief: ReelBrief; personaId: number | null }> {
  const persona = await getPersonaForAccount(account.id);
  const learnings = await getActiveLearnings(account.id);

  // Hooks from recent runs so consecutive reels don't repeat themselves.
  const { data: recentRuns } = await supabaseServer
    .from("reel_runs")
    .select("brief")
    .eq("account_id", account.id)
    .not("brief", "is", null)
    .order("created_at", { ascending: false })
    .limit(8);
  const recentHooks = (recentRuns ?? [])
    .map(r => (r.brief as ReelBrief | null)?.hook)
    .filter((h): h is string => Boolean(h));

  const presenter = account.reels_presenter_enabled === true;
  const prompt = buildPrompt({
    accountName: account.account_name,
    niche: account.niche,
    presenter,
    personaBlock: persona ? personaPromptBlock(persona) : "",
    learningsBlock: learningsPromptBlock(learnings),
    performanceBlock: await recentPerformanceBlock(account.id),
    recentHooks,
  });

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2_000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Strategist returned invalid JSON.");
  }

  return { brief: clampBrief(parsed, presenter), personaId: persona?.id ?? null };
}
