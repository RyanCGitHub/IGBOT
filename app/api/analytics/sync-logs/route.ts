import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Analytics sync health: recent sync runs (when, what happened) + any posts
// currently stuck on a Meta error. Powers the "Sync activity" panel so bad
// analytics are debuggable instead of silent.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const [{ data: runs }, { data: errorPosts }, { data: lastAcct }] = await Promise.all([
    supabaseServer.from("analytics_sync_runs")
      .select("id, started_at, finished_at, status, trigger, accounts_checked, instagram_posts_found, new_posts_created, existing_posts_rechecked, snapshots_created, manual_queue_posts_resolved, viral_checks_created, errors_count")
      .order("started_at", { ascending: false }).limit(20),
    supabaseServer.from("published_posts")
      .select("id, account_id, caption, permalink, sync_error_count, last_sync_error, last_analytics_sync_at, analytics_tracking_status")
      .or("analytics_tracking_status.eq.error,sync_error_count.gt.0")
      .order("sync_error_count", { ascending: false }).limit(50),
    supabaseServer.from("connected_accounts")
      .select("last_analytics_sync_at").not("last_analytics_sync_at", "is", null)
      .order("last_analytics_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return NextResponse.json({
    success: true,
    last_sync_at: lastAcct?.last_analytics_sync_at ?? runs?.[0]?.finished_at ?? null,
    runs: runs ?? [],
    error_posts: (errorPosts ?? []).map(p => ({
      id: p.id, caption: (p.caption as string)?.slice(0, 70) ?? null, permalink: p.permalink,
      sync_error_count: p.sync_error_count, last_sync_error: p.last_sync_error,
      last_analytics_sync_at: p.last_analytics_sync_at, status: p.analytics_tracking_status,
    })),
  });
}
