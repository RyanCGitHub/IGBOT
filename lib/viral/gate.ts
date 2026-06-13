import { supabaseServer } from "@/lib/supabase-server";
import { getAnalysisImageB64, scoreContent } from "@/lib/viral/score";
import { writeScoreHistory } from "@/lib/viral/score-history";
import { SCORING_MODEL_VERSION } from "@/lib/viral/version";
import type { ContentType, ContentLane } from "@/lib/viral/rubric";

// Pre-publish viral gate. EVERY published post (Finn reels, news, clips) runs
// through here right before it goes out. It always scores + records; whether a
// low score *blocks* depends on the singleton config (ships disabled). Fails
// OPEN — a scoring outage never jams the autonomous pipeline.

export type GateConfig = { enabled: boolean; min_score: number };

export async function getGateConfig(): Promise<GateConfig> {
  const { data } = await supabaseServer
    .from("viral_gate_config").select("enabled, min_score").eq("id", 1).maybeSingle();
  return { enabled: !!data?.enabled, min_score: Number(data?.min_score) || 0 };
}

// Lane from the account: news/clips brands map to their lane; a brand-less
// account posting a reel is the avatar presenter (Finn), else general.
async function laneForAccount(accountId: number | null, contentType: ContentType): Promise<{ lane: ContentLane; accountName: string | null }> {
  let accountName: string | null = null;
  if (accountId) {
    const { data: acct } = await supabaseServer.from("connected_accounts").select("account_name").eq("id", accountId).maybeSingle();
    accountName = acct?.account_name ?? null;
    const { data: brand } = await supabaseServer
      .from("media_brands").select("brand_type").eq("connected_account_id", accountId).eq("status", "active").maybeSingle();
    if (brand?.brand_type === "news_media") return { lane: "news_media", accountName };
    if (brand?.brand_type === "streamer_clips") return { lane: "streamer_clips", accountName };
  }
  return { lane: contentType === "reel" ? "avatar_reels" : "general", accountName };
}

export type GateDecision = {
  allow: boolean;
  held: boolean;
  viral_score: number | null;
  verdict: string | null;
  weaknesses: string[];
  review_id: number | null;
};

export async function prePublishGate(ctx: {
  kind: "ig_post" | "reel";
  id: number;
  accountId: number | null;
  contentType: ContentType;
  caption: string;
  hashtags?: string;
  audioNote?: string;
  mediaPath?: string | null;   // bucket path (reels: assembled video; images: stored path)
  mediaUrl?: string | null;    // public URL (ig_posts.image_url)
  override?: boolean;          // owner forced this through — skip the block, still record
}): Promise<GateDecision> {
  const { lane, accountName } = await laneForAccount(ctx.accountId, ctx.contentType);

  const linkage = ctx.kind === "ig_post" ? { ig_post_id: ctx.id } : { reel_run_id: ctx.id };
  const base = {
    account_id: ctx.accountId,
    content_type: ctx.contentType,
    lane,
    media_path: ctx.mediaPath ?? null,
    media_public_url: ctx.mediaUrl ?? null,
    caption: ctx.caption || null,
    hashtags: ctx.hashtags || null,
    audio_note: ctx.audioNote || null,
    stage: "pre_publish",
    scoring_model_version: SCORING_MODEL_VERSION,
    ...linkage,
  };

  // Score (best-effort). A failure must not block publishing.
  let scored;
  try {
    const imageB64 = await getAnalysisImageB64({ contentType: ctx.contentType, mediaPath: ctx.mediaPath, mediaUrl: ctx.mediaUrl });
    scored = await scoreContent({
      contentType: ctx.contentType, lane, caption: ctx.caption || "",
      hashtags: ctx.hashtags || "", audioNote: ctx.audioNote || "", accountName, imageB64,
    });
  } catch (e) {
    await supabaseServer.from("content_reviews").insert({
      ...base, gate_decision: "error", raw: { error: e instanceof Error ? e.message : String(e) },
    });
    return { allow: true, held: false, viral_score: null, verdict: null, weaknesses: [], review_id: null };
  }

  const config = await getGateConfig();
  const blocks = config.enabled && scored.viral_score < config.min_score;
  const held = blocks && !ctx.override;
  const decision = ctx.override ? "override" : held ? "held" : config.enabled ? "passed" : "recorded";

  const { data: saved } = await supabaseServer.from("content_reviews").insert({
    ...base,
    viral_score: scored.viral_score,
    confidence_score: scored.confidence_score,
    verdict: scored.verdict,
    strengths: scored.strengths,
    weaknesses: scored.weaknesses,
    suggested_fixes: scored.suggested_fixes,
    ...scored.sub,
    gate_decision: decision,
    raw: { weights: scored.weights, model: "claude-sonnet-4-5", threshold: config.min_score, gate_enabled: config.enabled },
  }).select("id").single();

  // Append the prediction to the queryable score history.
  await writeScoreHistory({
    scored,
    scoreContext: "pre_publish_prediction",
    accountId: ctx.accountId,
    contentReviewId: saved?.id ?? null,
    contentLane: lane,
    mediaType: ctx.contentType,
  });

  return {
    allow: !held,
    held,
    viral_score: scored.viral_score,
    verdict: scored.verdict,
    weaknesses: scored.weaknesses,
    review_id: saved?.id ?? null,
  };
}
