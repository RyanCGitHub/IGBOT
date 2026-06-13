import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Connected IG accounts/pages with their synced totals — powers the page
// selector and the per-page analytics.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data: accounts } = await supabaseServer
    .from("connected_accounts").select("id, account_name, page_name, profile_picture_url, account_status, followers_count, last_analytics_sync_at, last_media_sync_at");
  const { data: posts } = await supabaseServer.from("published_posts").select("id, account_id").not("instagram_media_id", "is", null);
  const postIds = (posts ?? []).map(p => p.id as number);
  const acctByPost = new Map((posts ?? []).map(p => [p.id as number, p.account_id as number]));

  const totals = new Map<number, { posts: number; views: number; reach: number; likes: number; comments: number; saves: number; shares: number }>();
  if (postIds.length) {
    const { data: snaps } = await supabaseServer
      .from("post_metrics_snapshots").select("published_post_id, views, reach, likes, comments, shares, saves, captured_at")
      .in("published_post_id", postIds).order("captured_at", { ascending: false }).limit(8000);
    const seen = new Set<number>();
    for (const s of snaps ?? []) {
      const pid = s.published_post_id as number;
      if (seen.has(pid)) continue; seen.add(pid);
      const acc = acctByPost.get(pid); if (acc == null) continue;
      const t = totals.get(acc) ?? { posts: 0, views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
      t.posts++; t.views += (s.views as number) ?? 0; t.reach += (s.reach as number) ?? 0;
      t.likes += (s.likes as number) ?? 0; t.comments += (s.comments as number) ?? 0;
      t.saves += (s.saves as number) ?? 0; t.shares += (s.shares as number) ?? 0;
      totals.set(acc, t);
    }
  }

  return NextResponse.json({
    success: true,
    accounts: (accounts ?? []).map(a => ({
      id: a.id, account_name: a.account_name, page_name: a.page_name, profile_picture_url: a.profile_picture_url,
      account_status: a.account_status ?? "active", followers_count: a.followers_count,
      last_analytics_sync_at: a.last_analytics_sync_at, last_media_sync_at: a.last_media_sync_at,
      totals: totals.get(a.id as number) ?? { posts: 0, views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 },
    })),
  });
}
