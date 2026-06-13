import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { publicUrlFor } from "@/lib/reels/storage";
import { getAnalysisImageB64, scoreContent } from "@/lib/viral/score";
import type { ContentType, ContentLane } from "@/lib/viral/rubric";

// Viral Potential Checker — manual scoring endpoint. The scoring core lives in
// lib/viral/score.ts (shared with the pre-publish gate); this route handles the
// upload-driven request and persists the review.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  let accountName: string | null = null;
  if (body.account_id) {
    const { data: acct } = await supabaseServer
      .from("connected_accounts").select("account_name").eq("id", body.account_id).maybeSingle();
    accountName = acct?.account_name ?? null;
  }

  const imageB64 = await getAnalysisImageB64({ contentType, mediaPath });

  let scored;
  try {
    scored = await scoreContent({ contentType, lane, caption, hashtags, audioNote, accountName, imageB64 });
  } catch (e) {
    return NextResponse.json({ success: false, error: `Scoring failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const { data: saved } = await supabaseServer.from("content_reviews").insert({
    account_id: body.account_id ?? null,
    content_type: contentType,
    lane,
    media_path: mediaPath,
    media_public_url: mediaPath ? publicUrlFor(mediaPath) : null,
    caption: caption || null,
    hashtags: hashtags || null,
    audio_note: audioNote || null,
    viral_score: scored.viral_score,
    confidence_score: scored.confidence_score,
    verdict: scored.verdict,
    strengths: scored.strengths,
    weaknesses: scored.weaknesses,
    suggested_fixes: scored.suggested_fixes,
    ...scored.sub,
    stage: "manual_check",
    gate_decision: "recorded",
    raw: { weights: scored.weights, model: "claude-sonnet-4-5" },
  }).select("id").single();

  return NextResponse.json({
    success: true,
    review_id: saved?.id ?? null,
    viral_score: scored.viral_score,
    confidence_score: scored.confidence_score,
    verdict: scored.verdict,
    strengths: scored.strengths,
    weaknesses: scored.weaknesses,
    suggested_fixes: scored.suggested_fixes,
    ...scored.sub,
    weights: scored.weights,
  });
}
