import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Published posts with their latest synced metrics + viral score. Optional
// ?account_id= filter for per-page views.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const accountId = Number(new URL(request.url).searchParams.get("account_id")) || null;

  let q = supabaseServer.from("published_posts")
    .select("id, account_id, instagram_media_id, permalink, media_type, media_product_type, content_lane, caption, media_public_url, thumbnail_url, predicted_viral_score, viral_checker_status, published_at, analytics_tracking_status")
    .not("instagram_media_id", "is", null).order("published_at", { ascending: false }).limit(500);
  if (accountId) q = q.eq("account_id", accountId);
  const { data: posts } = await q;
  const ids = (posts ?? []).map(p => p.id as number);

  const latest = new Map<number, { views: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; engagement_rate: number | null }>();
  if (ids.length) {
    const { data: snaps } = await supabaseServer.from("post_metrics_snapshots")
      .select("published_post_id, views, reach, likes, comments, saves, shares, engagement_rate, captured_at")
      .in("published_post_id", ids).order("captured_at", { ascending: false }).limit(8000);
    for (const s of snaps ?? []) if (!latest.has(s.published_post_id as number)) latest.set(s.published_post_id as number, s as never);
  }

  return NextResponse.json({
    success: true,
    posts: (posts ?? []).map(p => ({ ...p, metrics: latest.get(p.id as number) ?? null })),
  });
}
