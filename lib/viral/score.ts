import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude";
import { downloadFromBucket, fetchToBuffer } from "@/lib/reels/storage";
import { extractReelFrame, prepImage } from "@/lib/viral/frame";
import {
  SUBSCORES, weightsFor, combineScore, verdictFor, laneGuidance,
  type ContentType, type ContentLane, type SubScores,
} from "@/lib/viral/rubric";

// Shared scoring core for the Viral Checker. Claude (vision) judges the 7
// dimensions; the final score is a deterministic, lane-aware weighted combine.
// Used by BOTH the manual /api/viral-score route and the pre-publish gate so
// the rubric never drifts between them.

const MODEL = "claude-sonnet-4-5";

export type ScoreResult = {
  viral_score: number;
  confidence_score: number;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  suggested_fixes: string[];
  sub: SubScores;
  weights: Record<SubScoreKeyAlias, number>;
  had_visual: boolean;
};
type SubScoreKeyAlias = (typeof SUBSCORES)[number];

// Resolve whatever media we have (bucket path or public URL) to a downsized
// JPEG base64 for vision. Best-effort: null means "judge visuals from context".
export async function getAnalysisImageB64(opts: {
  contentType: ContentType;
  mediaPath?: string | null;   // bucket path
  mediaUrl?: string | null;    // public URL (e.g. ig_posts.image_url)
}): Promise<string | null> {
  try {
    if (opts.contentType === "reel" && opts.mediaPath) {
      const frame = await extractReelFrame(opts.mediaPath);
      return frame ? frame.toString("base64") : null;
    }
    let raw: Buffer | null = null;
    if (opts.mediaPath) raw = await downloadFromBucket(opts.mediaPath);
    else if (opts.mediaUrl) raw = await fetchToBuffer(opts.mediaUrl);
    if (!raw) return null;
    const prepped = await prepImage(raw);
    return prepped ? prepped.toString("base64") : null;
  } catch {
    return null;
  }
}

export async function scoreContent(input: {
  contentType: ContentType;
  lane: ContentLane;
  caption: string;
  hashtags: string;
  audioNote: string;
  accountName?: string | null;
  imageB64: string | null;
}): Promise<ScoreResult> {
  const { contentType, lane, caption, hashtags, audioNote, imageB64 } = input;
  const accountNote = input.accountName ? `Target account: @${input.accountName}.` : "";

  const instruction = `You are a strict Instagram growth analyst. Score this ${contentType} for viral potential.

${laneGuidance(lane, contentType)}
${accountNote}

Caption: ${caption || "(none provided)"}
Hashtags: ${hashtags || "(none provided)"}
${contentType === "reel" ? `Audio/music: ${audioNote || "(none described)"}` : ""}
${imageB64 ? (contentType === "reel" ? "An image of the reel's opening frame is attached." : "The post image is attached.") : "NO visual was provided — judge visual_clarity conservatively and lower your confidence."}

Score these SEVEN dimensions, each an integer 0–100. Be strict and calibrated — most real content is 40–65; reserve 80+ for genuinely standout work:
- hook_score: ${contentType === "reel" ? "does the first 1–2s stop the scroll?" : "instant readability / scroll-stop of the image + first caption line"}
- retention_score: ${contentType === "reel" ? "does it hold attention to a payoff?" : "does the post reward a second look / carousel swipe?"}
- shareability_score: would people send/save this?
- topic_strength_score: is the subject inherently interesting/timely for this lane?
- visual_clarity_score: composition, legibility, production quality
- caption_score: hook, clarity, CTA quality (no engagement-bait)
- audio_hashtag_fit_score: ${contentType === "reel" ? "audio choice +" : ""} hashtag relevance and reach fit

Return ONLY a JSON object (no markdown, no code fences) with EXACTLY these keys:
{
  "hook_score": int, "retention_score": int, "shareability_score": int,
  "topic_strength_score": int, "visual_clarity_score": int, "caption_score": int,
  "audio_hashtag_fit_score": int,
  "confidence_score": int,
  "strengths": [string, ...],
  "weaknesses": [string, ...],
  "suggested_fixes": [string, ...]
}`;

  const content: Anthropic.MessageParam["content"] = imageB64
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
        { type: "text", text: instruction },
      ]
    : instruction;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content }],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text).join("").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as Partial<SubScores> & {
    confidence_score?: number; strengths?: string[]; weaknesses?: string[]; suggested_fixes?: string[];
  };

  const sub = {} as SubScores;
  for (const k of SUBSCORES) sub[k] = Math.max(0, Math.min(100, Math.round(Number(parsed[k]) || 0)));
  const weights = weightsFor(lane, contentType);
  const viralScore = combineScore(sub, weights);
  let confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence_score) || 0)));
  if (!imageB64) confidence = Math.min(confidence, 60);

  const clip = (a: unknown): string[] =>
    Array.isArray(a) ? a.map(s => String(s).slice(0, 240)).slice(0, 5) : [];

  return {
    viral_score: viralScore,
    confidence_score: confidence,
    verdict: verdictFor(viralScore),
    strengths: clip(parsed.strengths),
    weaknesses: clip(parsed.weaknesses),
    suggested_fixes: clip(parsed.suggested_fixes),
    sub,
    weights,
    had_visual: !!imageB64,
  };
}
