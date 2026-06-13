import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { evaluatePublishedPosts } from "@/lib/viral/accuracy";

// Viral Score Accuracy dashboard data. The OFFICIAL accuracy is the 72h window;
// 24h/7d counts are reported alongside. All aggregation is in-process (volume is
// "posts per account").
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ev = {
  evaluation_window: string;
  content_lane: string | null;
  scoring_model_version: string | null;
  predicted_viral_score: number | null;
  actual_performance_score: number | null;
  accuracy_score: number | null;
  absolute_score_error: number | null;
  prediction_result: string | null;
  predicted_bucket: string | null;
  actual_bucket: string | null;
  performance_multiplier: number | null;
  did_go_viral: boolean | null;
  views: number | null;
  published_post_id: number | null;
  evaluated_at: string;
  published_posts: { media_public_url: string | null; permalink: string | null; published_at: string | null; caption: string | null } | null;
};

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

function laneStats(evs: Ev[]) {
  const pred = evs.map(e => e.predicted_viral_score ?? 0);
  const act = evs.map(e => e.actual_performance_score ?? 0);
  const acc = evs.map(e => e.accuracy_score ?? 0);
  const over = evs.filter(e => (e.prediction_result ?? "").includes("overestimate")).length;
  const under = evs.filter(e => (e.prediction_result ?? "").includes("underestimate")).length;
  return {
    posts: evs.length,
    avg_predicted: avg(pred), avg_actual: avg(act), avg_accuracy: avg(acc),
    overestimate_rate: evs.length ? Math.round((over / evs.length) * 100) : 0,
    underestimate_rate: evs.length ? Math.round((under / evs.length) * 100) : 0,
  };
}

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("viral_score_evaluations")
    .select("evaluation_window, content_lane, scoring_model_version, predicted_viral_score, actual_performance_score, accuracy_score, absolute_score_error, prediction_result, predicted_bucket, actual_bucket, performance_multiplier, did_go_viral, views, published_post_id, evaluated_at, published_posts(media_public_url, permalink, published_at, caption)")
    .order("evaluated_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const all = (data ?? []) as unknown as Ev[];
  const w72 = all.filter(e => e.evaluation_window === "72h");

  // Window counts.
  const windowCounts = { "24h": 0, "72h": 0, "7d": 0 } as Record<string, number>;
  for (const e of all) if (e.evaluation_window in windowCounts) windowCounts[e.evaluation_window]++;

  // Headline stats (72h = official).
  const bucketCorrect = w72.filter(e => e.predicted_bucket && e.predicted_bucket === e.actual_bucket).length;
  const over = w72.filter(e => (e.prediction_result ?? "").includes("overestimate")).length;
  const under = w72.filter(e => (e.prediction_result ?? "").includes("underestimate")).length;

  // Best/worst lane + model by avg accuracy (min 2 evals to rank).
  const byLane = new Map<string, Ev[]>();
  const byModel = new Map<string, Ev[]>();
  for (const e of w72) {
    if (e.content_lane) (byLane.get(e.content_lane) ?? byLane.set(e.content_lane, []).get(e.content_lane)!).push(e);
    if (e.scoring_model_version) (byModel.get(e.scoring_model_version) ?? byModel.set(e.scoring_model_version, []).get(e.scoring_model_version)!).push(e);
  }
  const rank = (m: Map<string, Ev[]>) => {
    const scored = [...m.entries()].filter(([, v]) => v.length >= 2)
      .map(([k, v]) => ({ key: k, acc: avg(v.map(e => e.accuracy_score ?? 0)) ?? 0, posts: v.length }))
      .sort((a, b) => b.acc - a.acc);
    return { best: scored[0] ?? null, worst: scored.length > 1 ? scored[scored.length - 1] : null };
  };
  const laneRank = rank(byLane);
  const modelRank = rank(byModel);

  const LANES = ["news_media", "streamer_clips", "avatar_reels", "general"];
  const perLane: Record<string, ReturnType<typeof laneStats>> = {};
  for (const l of LANES) {
    const evs = w72.filter(e => e.content_lane === l);
    if (evs.length) perLane[l] = laneStats(evs);
  }

  const table = w72.slice(0, 100).map(e => ({
    published_post_id: e.published_post_id,
    thumbnail: e.published_posts?.media_public_url ?? null,
    permalink: e.published_posts?.permalink ?? null,
    content_lane: e.content_lane,
    published_at: e.published_posts?.published_at ?? null,
    predicted_viral_score: e.predicted_viral_score,
    actual_72h_score: e.actual_performance_score,
    accuracy_score: e.accuracy_score,
    prediction_result: e.prediction_result,
    views: e.views,
    performance_multiplier: e.performance_multiplier,
    did_go_viral: e.did_go_viral,
  }));

  return NextResponse.json({
    success: true,
    summary: {
      avg_accuracy: avg(w72.map(e => e.accuracy_score ?? 0)),
      avg_absolute_error: avg(w72.map(e => e.absolute_score_error ?? 0)),
      evaluated_total: all.length,
      evaluated_24h: windowCounts["24h"],
      evaluated_72h: windowCounts["72h"],
      evaluated_7d: windowCounts["7d"],
      bucket_correct_pct: w72.length ? Math.round((bucketCorrect / w72.length) * 100) : null,
      overestimate_pct: w72.length ? Math.round((over / w72.length) * 100) : null,
      underestimate_pct: w72.length ? Math.round((under / w72.length) * 100) : null,
      best_lane: laneRank.best, worst_lane: laneRank.worst,
      best_model: modelRank.best, worst_model: modelRank.worst,
    },
    perLane,
    table,
  });
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  let body: { action?: string };
  try { body = (await request.json()) as typeof body; } catch { body = {}; }
  if (body.action !== "recalculate") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });

  // Recompute evaluations from existing snapshots — never touches predicted scores.
  const summary = await evaluatePublishedPosts();
  return NextResponse.json({ success: true, ...summary });
}
