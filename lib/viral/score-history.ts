import { supabaseServer } from "@/lib/supabase-server";
import type { ScoreResult } from "@/lib/viral/score";
import { SCORING_MODEL_VERSION } from "@/lib/viral/version";

// Append-only log of EVERY viral score ever produced, tagged with its context
// so pre-post predictions, manual checks, post-publish backfills, and 24h
// reviews stay distinguishable. Powers the Viral Score History page.

export type ScoreContext = "pre_publish_prediction" | "manual_check" | "post_publish_backfill" | "24h_review";

export async function writeScoreHistory(ctx: {
  scored: ScoreResult;
  scoreContext: ScoreContext;
  accountId?: number | null;
  publishedPostId?: number | null;
  contentReviewId?: number | null;
  instagramMediaId?: string | null;
  contentLane?: string | null;
  mediaType?: string | null;
  hoursSincePublish?: number | null;
}): Promise<void> {
  try {
    const s = ctx.scored.sub;
    await supabaseServer.from("viral_score_history").insert({
      published_post_id: ctx.publishedPostId ?? null,
      content_review_id: ctx.contentReviewId ?? null,
      account_id: ctx.accountId ?? null,
      instagram_media_id: ctx.instagramMediaId ?? null,
      content_lane: ctx.contentLane ?? null,
      media_type: ctx.mediaType ?? null,
      score_context: ctx.scoreContext,
      score_timing: ctx.scoreContext === "pre_publish_prediction" ? "before_publish" : "after_publish",
      hours_since_publish: ctx.hoursSincePublish ?? null,
      viral_score: ctx.scored.viral_score,
      confidence_score: ctx.scored.confidence_score,
      hook_score: s.hook_score,
      retention_score: s.retention_score,
      shareability_score: s.shareability_score,
      topic_strength_score: s.topic_strength_score,
      visual_clarity_score: s.visual_clarity_score,
      caption_score: s.caption_score,
      audio_hashtag_fit_score: s.audio_hashtag_fit_score,
      scoring_model_version: SCORING_MODEL_VERSION,
      strengths: ctx.scored.strengths,
      weaknesses: ctx.scored.weaknesses,
      suggested_fixes: ctx.scored.suggested_fixes,
      raw_score_json: { weights: ctx.scored.weights },
    });
  } catch (e) {
    console.error("[viral-history] writeScoreHistory failed:", e instanceof Error ? e.message : e);
  }
}
