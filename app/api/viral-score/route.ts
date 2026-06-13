import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { downloadFromBucket, publicUrlFor } from "@/lib/reels/storage";
import { extractReelFrame, prepImage } from "@/lib/viral/frame";
import {
  SUBSCORES, weightsFor, combineScore, verdictFor, laneGuidance,
  type ContentType, type ContentLane, type SubScores,
} from "@/lib/viral/rubric";

// Viral Potential Checker V1. Claude (vision) scores the seven dimensions
// 0–100 against a lane-aware rubric; the final viral_score is a deterministic
// weighted combine (lib/viral/rubric). No model training, no scraping.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-5";
const TYPES = new Set(["reel", "photo"]);
const LANES = new Set(["news_media", "streamer_clips", "avatar_reels", "general"]);

type Body = {
  content_type?: string;
  lane?: string;
  account_id?: number | null;
  media_path?: string | null;
  caption?: string;
  hashtags?: string;
  audio_note?: string;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const contentType = String(body.content_type) as ContentType;
  const lane = String(body.lane) as ContentLane;
  if (!TYPES.has(contentType)) return NextResponse.json({ success: false, error: "content_type must be 'reel' or 'photo'." }, { status: 400 });
  if (!LANES.has(lane)) return NextResponse.json({ success: false, error: "Invalid lane." }, { status: 400 });

  const caption = String(body.caption ?? "").trim().slice(0, 4000);
  const hashtags = String(body.hashtags ?? "").trim().slice(0, 1000);
  const audioNote = String(body.audio_note ?? "").trim().slice(0, 500);
  const mediaPath = body.media_path ? String(body.media_path) : null;

  // ── Get a visual to analyze (best-effort) ───────────────────────────────────
  let imageB64: string | null = null;
  if (mediaPath) {
    try {
      if (contentType === "reel") {
        const frame = await extractReelFrame(mediaPath);
        if (frame) imageB64 = frame.toString("base64");
      } else {
        const raw = await downloadFromBucket(mediaPath);
        const prepped = await prepImage(raw);
        if (prepped) imageB64 = prepped.toString("base64");
      }
    } catch { /* visual is optional — scorer notes lower confidence */ }
  }

  // ── Build the analysis prompt ───────────────────────────────────────────────
  let accountNote = "";
  if (body.account_id) {
    const { data: acct } = await supabaseServer
      .from("connected_accounts").select("account_name").eq("id", body.account_id).maybeSingle();
    if (acct?.account_name) accountNote = `Target account: @${acct.account_name}.`;
  }

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
  "confidence_score": int,            // 0–100, how confident you are given what was provided
  "strengths": [string, ...],         // up to 5, short
  "weaknesses": [string, ...],        // up to 5, short
  "suggested_fixes": [string, ...]    // up to 5, concrete and specific
}`;

  const content: Anthropic.MessageParam["content"] = imageB64
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
        { type: "text", text: instruction },
      ]
    : instruction;

  let parsed: Partial<SubScores> & {
    confidence_score?: number; strengths?: string[]; weaknesses?: string[]; suggested_fixes?: string[];
  };
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content }],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(text);
  } catch (e) {
    return NextResponse.json({ success: false, error: `Scoring failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  // ── Deterministic combine ───────────────────────────────────────────────────
  const sub = {} as SubScores;
  for (const k of SUBSCORES) sub[k] = Math.max(0, Math.min(100, Math.round(Number(parsed[k]) || 0)));
  const weights = weightsFor(lane, contentType);
  const viralScore = combineScore(sub, weights);
  const verdict = verdictFor(viralScore);
  let confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence_score) || 0)));
  if (!imageB64) confidence = Math.min(confidence, 60); // no visual → cap confidence

  const clip = (a: unknown): string[] =>
    Array.isArray(a) ? a.map(s => String(s).slice(0, 240)).slice(0, 5) : [];
  const strengths = clip(parsed.strengths);
  const weaknesses = clip(parsed.weaknesses);
  const suggestedFixes = clip(parsed.suggested_fixes);

  // ── Persist (feeds future rubric tuning) ────────────────────────────────────
  const row = {
    account_id: body.account_id ?? null,
    content_type: contentType,
    lane,
    media_path: mediaPath,
    media_public_url: mediaPath ? publicUrlFor(mediaPath) : null,
    caption: caption || null,
    hashtags: hashtags || null,
    audio_note: audioNote || null,
    viral_score: viralScore,
    confidence_score: confidence,
    verdict,
    strengths, weaknesses, suggested_fixes: suggestedFixes,
    ...sub,
    raw: { weights, model: MODEL },
  };
  const { data: saved } = await supabaseServer.from("content_reviews").insert(row).select("id").single();

  return NextResponse.json({
    success: true,
    review_id: saved?.id ?? null,
    viral_score: viralScore,
    confidence_score: confidence,
    verdict,
    strengths, weaknesses, suggested_fixes: suggestedFixes,
    ...sub,
    weights,
  });
}
