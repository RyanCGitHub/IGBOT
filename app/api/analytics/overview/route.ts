import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Real synced analytics totals — global, or filtered to one IG account/page via
// ?account_id=. Numbers come from the latest metrics snapshot of each tracked
// post (post_metrics_snapshots), so they reflect actual Instagram insights.
export const dynamic = "force-dynamic";

type Snap = { published_post_id: number; views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; engagement_rate: number | null; captured_at: string };

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const accountId = Number(new URL(request.url).searchParams.get("account_id")) || null;

  let postsQ = supabaseServer.from("published_posts").select("id, account_id, caption, media_public_url, permalink, published_at, predicted_viral_score").not("instagram_media_id", "is", null);
  if (accountId) postsQ = postsQ.eq("account_id", accountId);
  const { data: posts } = await postsQ.limit(2000);
  const postIds = (posts ?? []).map(p => p.id as number);
  if (postIds.length === 0) {
    return NextResponse.json({ success: true, totals: empty(), best_post: null, worst_post: null, newest_post: null, last_sync_at: await lastSync(accountId), posts_tracked: 0 });
  }

  // Latest snapshot per post.
  const { data: snaps } = await supabaseServer
    .from("post_metrics_snapshots").select("published_post_id, views, reach, likes, comments, shares, saves, engagement_rate, captured_at")
    .in("published_post_id", postIds).order("captured_at", { ascending: false }).limit(8000);
  const latest = new Map<number, Snap>();
  for (const s of (snaps ?? []) as Snap[]) if (!latest.has(s.published_post_id)) latest.set(s.published_post_id, s);

  const t = empty();
  const ers: number[] = [];
  let best: { id: number; views: number } | null = null;
  let worst: { id: number; views: number } | null = null;
  for (const [pid, s] of latest) {
    t.views += s.views ?? 0; t.reach += s.reach ?? 0; t.likes += s.likes ?? 0;
    t.comments += s.comments ?? 0; t.saves += s.saves ?? 0; t.shares += s.shares ?? 0;
    if (s.engagement_rate != null) ers.push(s.engagement_rate);
    const v = s.views ?? 0;
    if (!best || v > best.views) best = { id: pid, views: v };
    if (!worst || v < worst.views) worst = { id: pid, views: v };
  }
  t.total_interactions = t.likes + t.comments + t.saves + t.shares;
  t.avg_engagement_rate = ers.length ? Number((ers.reduce((a, b) => a + b, 0) / ers.length).toFixed(4)) : 0;

  const byId = new Map((posts ?? []).map(p => [p.id as number, p]));
  const post = (id: number | undefined) => {
    if (id == null) return null;
    const p = byId.get(id); const s = latest.get(id);
    return p ? { id, caption: (p.caption as string)?.slice(0, 80) ?? null, thumbnail: p.media_public_url, permalink: p.permalink, views: s?.views ?? 0 } : null;
  };
  const newest = [...(posts ?? [])].filter(p => latest.has(p.id as number)).sort((a, b) => new Date(b.published_at as string).getTime() - new Date(a.published_at as string).getTime())[0];

  return NextResponse.json({
    success: true,
    totals: t,
    posts_tracked: latest.size,
    best_post: post(best?.id),
    worst_post: post(worst?.id),
    newest_post: newest ? post(newest.id as number) : null,
    last_sync_at: await lastSync(accountId),
  });
}

function empty() {
  return { views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0, total_interactions: 0, avg_engagement_rate: 0 };
}
async function lastSync(accountId: number | null): Promise<string | null> {
  if (accountId) {
    const { data } = await supabaseServer.from("connected_accounts").select("last_analytics_sync_at").eq("id", accountId).maybeSingle();
    return (data?.last_analytics_sync_at as string) ?? null;
  }
  const { data } = await supabaseServer.from("connected_accounts").select("last_analytics_sync_at").not("last_analytics_sync_at", "is", null).order("last_analytics_sync_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.last_analytics_sync_at as string) ?? null;
}
