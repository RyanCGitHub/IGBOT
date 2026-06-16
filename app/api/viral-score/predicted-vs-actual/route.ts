import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// The consolidated predicted-vs-actual table: every published post that got a
// predicted viral score, joined to its latest real metrics + 72h accuracy
// evaluation. One row = account, media, caption, predicted score, actual
// views/reach/engagement, accuracy result, posted date.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const accountId = Number(new URL(request.url).searchParams.get("account_id")) || null;

  let q = supabaseServer.from("published_posts")
    .select("id, account_id, caption, media_public_url, thumbnail_url, permalink, predicted_viral_score, viral_checker_status, content_lane, media_type, published_at")
    .not("predicted_viral_score", "is", null)
    .order("published_at", { ascending: false }).limit(500);
  if (accountId) q = q.eq("account_id", accountId);
  const { data: posts, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const ids = (posts ?? []).map(p => p.id as number);
  const acctIds = [...new Set((posts ?? []).map(p => p.account_id).filter(Boolean))] as number[];

  const [{ data: snaps }, { data: evals }, { data: accounts }] = await Promise.all([
    ids.length ? supabaseServer.from("post_metrics_snapshots")
      .select("published_post_id, views, reach, likes, comments, shares, saves, engagement_rate, captured_at")
      .in("published_post_id", ids).order("captured_at", { ascending: false }).limit(8000) : Promise.resolve({ data: [] }),
    ids.length ? supabaseServer.from("viral_score_evaluations")
      .select("published_post_id, evaluation_window, actual_performance_score, accuracy_score, score_error, prediction_result, did_go_viral, performance_multiplier")
      .in("published_post_id", ids) : Promise.resolve({ data: [] }),
    acctIds.length ? supabaseServer.from("connected_accounts").select("id, account_name").in("id", acctIds) : Promise.resolve({ data: [] }),
  ]);

  const latestSnap = new Map<number, Record<string, number | null>>();
  for (const s of snaps ?? []) if (!latestSnap.has(s.published_post_id as number)) latestSnap.set(s.published_post_id as number, s as never);
  // Prefer the 72h (official) eval, else any.
  const evalByPost = new Map<number, Record<string, unknown>>();
  for (const e of evals ?? []) {
    const pid = e.published_post_id as number;
    if (!evalByPost.has(pid) || e.evaluation_window === "72h") evalByPost.set(pid, e);
  }
  const acctName = new Map((accounts ?? []).map(a => [a.id, a.account_name]));

  const rows = (posts ?? []).map(p => {
    const s = latestSnap.get(p.id as number);
    const ev = evalByPost.get(p.id as number);
    return {
      published_post_id: p.id,
      account: p.account_id ? acctName.get(p.account_id) ?? `Account ${p.account_id}` : null,
      thumbnail: p.thumbnail_url ?? p.media_public_url,
      permalink: p.permalink,
      caption: (p.caption as string)?.slice(0, 120) ?? null,
      content_lane: p.content_lane,
      media_type: p.media_type,
      viral_checker_status: p.viral_checker_status,
      predicted_viral_score: p.predicted_viral_score,
      actual_views: s?.views ?? null,
      actual_reach: s?.reach ?? null,
      actual_engagement_rate: s?.engagement_rate ?? null,
      actual_performance_score: (ev?.actual_performance_score as number) ?? null,
      accuracy_score: (ev?.accuracy_score as number) ?? null,
      prediction_result: (ev?.prediction_result as string) ?? null,
      performance_multiplier: (ev?.performance_multiplier as number) ?? null,
      did_go_viral: (ev?.did_go_viral as boolean) ?? null,
      published_at: p.published_at,
    };
  });

  return NextResponse.json({ success: true, rows });
}
