import { supabaseServer } from "@/lib/supabase-server";

// Viral score accuracy tracking. Compares the immutable PREDICTED score
// (content_reviews.viral_score, copied to published_posts at publish) against
// ACTUAL performance derived from real metric snapshots, at 24h / 72h / 7d.
// The predicted score is NEVER modified here — only evaluations are written.

export const WINDOWS = [
  { key: "24h", hours: 24 },
  { key: "72h", hours: 72 },   // primary / official accuracy
  { key: "7d", hours: 168 },
] as const;
export const VIRAL_THRESHOLD = 3.0;

// ── Actual performance score (0–100) from view multiplier + engagement quality ─
// Piecewise mapping of views relative to the account's median (the spec's bands),
// then a modest engagement-quality bonus where shares/saves > comments > likes.
export function multiplierToBase(m: number): number {
  if (m <= 0) return 0;
  if (m < 0.5) return lerp(m, 0, 0.5, 0, 30);
  if (m < 1.0) return lerp(m, 0.5, 1.0, 30, 50);
  if (m < 2.0) return lerp(m, 1.0, 2.0, 50, 70);
  if (m < 3.0) return lerp(m, 2.0, 3.0, 70, 85);
  if (m < 5.0) return lerp(m, 3.0, 5.0, 85, 95);
  return Math.min(100, 95 + Math.min((m - 5) / 5, 1) * 5);
}
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

type Metrics = { views: number; reach: number; likes: number; comments: number; shares: number; saves: number };

// Weighted engagement quality nudge (shares>saves>comments>likes), bounded so
// real view performance stays the dominant signal. Never uses hashtags.
function engagementBonus(m: Metrics): number {
  const base = Math.max(m.reach || m.views || 0, 1);
  const weighted = 4 * m.shares + 3 * m.saves + 2 * m.comments + 1 * m.likes;
  return Math.max(0, Math.min(12, Math.round((weighted / base) * 250)));
}

export function actualPerformanceScore(m: Metrics, medianViews: number): {
  score: number; multiplier: number; didGoViral: boolean; engagementRate: number;
} {
  const median = Math.max(medianViews, 1);
  const multiplier = (m.views || 0) / median;
  const score = Math.max(0, Math.min(100, Math.round(multiplierToBase(multiplier) + engagementBonus(m))));
  const total = m.likes + m.comments + m.shares + m.saves;
  const engagementRate = total / Math.max(m.reach || m.views || 0, 1);
  return { score, multiplier: Number(multiplier.toFixed(3)), didGoViral: multiplier >= VIRAL_THRESHOLD, engagementRate: Number(engagementRate.toFixed(4)) };
}

// ── Buckets + prediction-result labels (per spec) ─────────────────────────────
export function bucketFor(score: number | null): string | null {
  if (score == null) return null;
  if (score <= 39) return "weak";
  if (score <= 59) return "average";
  if (score <= 74) return "decent";
  if (score <= 84) return "strong";
  return "high_viral_potential";
}

export function predictionResult(scoreError: number, confidence: number | null): string {
  const abs = Math.abs(scoreError);
  if (abs <= 10) return "accurate_high_confidence";
  if (abs <= 20) return "accurate_medium_confidence";
  // beyond 20 → directional, with "major" past 40
  if (scoreError > 40) return "major_overestimate";
  if (scoreError > 20) return "overestimated";
  if (scoreError < -40) return "major_underestimate";
  return "underestimated"; // scoreError < -20
}

// Median of recent post views for the account (the performance baseline).
async function accountMedianViews(accountId: number | null, excludeMediaId: string | null): Promise<number> {
  if (!accountId) return 1;
  const { data: posts } = await supabaseServer
    .from("ig_posts").select("id").eq("account_id", accountId).in("status", ["published", "republished"]).limit(300);
  const ids = (posts ?? []).map(p => p.id as number);
  if (ids.length === 0) return 1;
  const { data: ins } = await supabaseServer
    .from("post_insights").select("views, media_id").in("post_id", ids).not("views", "is", null);
  const views = (ins ?? [])
    .filter(r => !excludeMediaId || r.media_id !== excludeMediaId)
    .map(r => Number(r.views) || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (views.length === 0) return 1;
  const mid = Math.floor(views.length / 2);
  return views.length % 2 ? views[mid] : (views[mid - 1] + views[mid]) / 2;
}

type SnapshotRow = {
  hours_since_publish: number | null;
  views: number | null; reach: number | null; likes: number | null;
  comments: number | null; shares: number | null; saves: number | null;
};

// Pick the snapshot closest to a target window (only if the post is mature
// enough — a snapshot within 80% of the window must exist).
function snapshotForWindow(snaps: SnapshotRow[], targetHours: number): SnapshotRow | null {
  const mature = snaps.filter(s => (s.hours_since_publish ?? 0) >= targetHours * 0.8);
  if (mature.length === 0) return null;
  return mature.reduce((best, s) =>
    Math.abs((s.hours_since_publish ?? 0) - targetHours) < Math.abs((best.hours_since_publish ?? 0) - targetHours) ? s : best
  );
}

export type EvaluateSummary = { posts: number; evaluations: number; windows: Record<string, number>; logs: string[] };

// Build/refresh viral_score_evaluations from existing snapshots. Never touches
// predicted scores. Idempotent (upsert on published_post_id + window).
export async function evaluatePublishedPosts(opts?: { onlyPublishedPostId?: number }): Promise<EvaluateSummary> {
  const summary: EvaluateSummary = { posts: 0, evaluations: 0, windows: { "24h": 0, "72h": 0, "7d": 0 }, logs: [] };
  const log = (m: string) => { summary.logs.push(m); console.log(`[viral-accuracy] ${m}`); };

  let q = supabaseServer.from("published_posts").select("*").not("predicted_viral_score", "is", null);
  if (opts?.onlyPublishedPostId) q = q.eq("id", opts.onlyPublishedPostId);
  const { data: posts } = await q;
  summary.posts = (posts ?? []).length;

  for (const pp of posts ?? []) {
    const { data: snaps } = await supabaseServer
      .from("post_metrics_snapshots")
      .select("hours_since_publish, views, reach, likes, comments, shares, saves")
      .eq("published_post_id", pp.id)
      .order("hours_since_publish", { ascending: true });
    if (!snaps || snaps.length === 0) { log(`post ${pp.id}: no snapshots yet — skipping`); continue; }

    const median = await accountMedianViews(pp.account_id as number | null, pp.instagram_media_id as string | null);

    for (const w of WINDOWS) {
      const snap = snapshotForWindow(snaps as SnapshotRow[], w.hours);
      if (!snap) continue;

      const metrics: Metrics = {
        views: snap.views ?? 0, reach: snap.reach ?? 0, likes: snap.likes ?? 0,
        comments: snap.comments ?? 0, shares: snap.shares ?? 0, saves: snap.saves ?? 0,
      };
      const actual = actualPerformanceScore(metrics, median);
      const predicted = pp.predicted_viral_score as number;
      const scoreError = predicted - actual.score;
      const absErr = Math.abs(scoreError);
      const total = metrics.likes + metrics.comments + metrics.shares + metrics.saves;

      const row = {
        published_post_id: pp.id,
        content_review_id: pp.content_review_id,
        account_id: pp.account_id,
        instagram_media_id: pp.instagram_media_id,
        content_lane: pp.content_lane,
        media_type: pp.media_type,
        scoring_model_version: pp.scoring_model_version,
        evaluated_at: new Date().toISOString(),
        evaluation_window: w.key,
        hours_since_publish: snap.hours_since_publish,
        predicted_viral_score: predicted,
        actual_performance_score: actual.score,
        accuracy_score: 100 - absErr,
        score_error: scoreError,
        absolute_score_error: absErr,
        prediction_result: predictionResult(scoreError, pp.confidence_score as number | null),
        predicted_bucket: bucketFor(predicted),
        actual_bucket: bucketFor(actual.score),
        views: metrics.views, reach: metrics.reach, likes: metrics.likes,
        comments: metrics.comments, shares: metrics.shares, saves: metrics.saves,
        total_interactions: total,
        engagement_rate: actual.engagementRate,
        account_median_views: median,
        performance_multiplier: actual.multiplier,
        viral_threshold_multiplier: VIRAL_THRESHOLD,
        did_go_viral: actual.didGoViral,
        notes: median <= 1 ? "low baseline (insufficient account history)" : null,
      };

      const { error } = await supabaseServer.from("viral_score_evaluations").upsert(row, { onConflict: "published_post_id,evaluation_window" });
      if (error) { log(`post ${pp.id} ${w.key}: upsert failed — ${error.message}`); continue; }
      summary.evaluations++;
      summary.windows[w.key]++;
      log(`post ${pp.id} ${w.key}: predicted=${predicted} actual=${actual.score} accuracy=${100 - absErr} (${row.prediction_result}, ${actual.multiplier}x${actual.didGoViral ? ", VIRAL" : ""})`);
    }
  }

  log(`done — ${summary.posts} posts, ${summary.evaluations} evaluations (24h=${summary.windows["24h"]} 72h=${summary.windows["72h"]} 7d=${summary.windows["7d"]})`);
  return summary;
}

// ── Record a published post (copies the immutable predicted score) ────────────
export async function recordPublishedPost(ctx: {
  kind: "ig_post" | "reel";
  igPostId: number | null;
  reelRunId?: number | null;
  accountId: number | null;
  instagramMediaId: string;
  permalink?: string | null;
  publishedAt?: string | null;
}): Promise<void> {
  try {
    // Find the pre-publish review (the predicted score) for this object.
    const col = ctx.kind === "ig_post" ? "ig_post_id" : "reel_run_id";
    const linkId = ctx.kind === "ig_post" ? ctx.igPostId : ctx.reelRunId;
    let review: Record<string, unknown> | null = null;
    if (linkId) {
      const { data } = await supabaseServer
        .from("content_reviews").select("*")
        .eq(col, linkId).eq("stage", "pre_publish")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      review = data;
    }

    // media public url for the dashboard thumbnail.
    let mediaUrl: string | null = null;
    if (ctx.igPostId) {
      const { data: post } = await supabaseServer.from("ig_posts").select("image_url").eq("id", ctx.igPostId).maybeSingle();
      mediaUrl = (post?.image_url as string | null) ?? null;
    }

    const { error } = await supabaseServer.from("published_posts").upsert({
      content_review_id: review?.id ?? null,
      account_id: ctx.accountId,
      instagram_media_id: ctx.instagramMediaId,
      ig_post_id: ctx.igPostId,
      reel_run_id: ctx.reelRunId ?? null,
      media_type: (review?.content_type as string) ?? (ctx.kind === "reel" ? "reel" : "photo"),
      content_lane: (review?.lane as string) ?? null,
      caption: (review?.caption as string) ?? null,
      hashtags: (review?.hashtags as string) ?? null,
      audio_name: (review?.audio_note as string) ?? null,
      media_public_url: mediaUrl,
      permalink: ctx.permalink ?? null,
      predicted_viral_score: (review?.viral_score as number) ?? null,
      confidence_score: (review?.confidence_score as number) ?? null,
      scoring_model_version: (review?.scoring_model_version as string) ?? null,
      published_at: ctx.publishedAt ?? new Date().toISOString(),
      tracking_status: review?.viral_score != null ? "tracking" : "no_prediction",
    }, { onConflict: "instagram_media_id" });
    if (error) { console.error(`[viral-accuracy] recordPublishedPost failed: ${error.message}`); return; }
    console.log(`[viral-accuracy] published_post recorded media=${ctx.instagramMediaId} review=${review?.id ?? "none"} predicted=${review?.viral_score ?? "n/a"}`);
  } catch (e) {
    console.error("[viral-accuracy] recordPublishedPost threw:", e instanceof Error ? e.message : e);
  }
}
