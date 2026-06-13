import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Manual Queue Recovery view: items still stuck, possible Instagram matches the
// last sync found (medium confidence — need confirmation), and items the sync
// already auto-resolved.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const [{ data: stuck }, { data: lastRun }, { data: resolved }, { data: accounts }] = await Promise.all([
    supabaseServer.from("content_packages").select("id, connected_account_id, caption, title, package_family, created_at").eq("manual_only", true).eq("status", "ready").order("created_at", { ascending: false }).limit(100),
    supabaseServer.from("analytics_sync_runs").select("details, finished_at").not("details", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseServer.from("published_posts").select("id, account_id, caption, permalink, media_public_url, published_at, instagram_media_id").eq("source_type", "manual_queue").order("detected_at", { ascending: false }).limit(50),
    supabaseServer.from("connected_accounts").select("id, account_name"),
  ]);

  const acctName = new Map((accounts ?? []).map(a => [a.id, a.account_name]));
  const possible = (lastRun?.details as { possible_matches?: unknown[] } | null)?.possible_matches ?? [];

  return NextResponse.json({
    success: true,
    stuck: (stuck ?? []).map(s => ({ id: s.id, account: acctName.get(s.connected_account_id) ?? null, caption: (s.caption as string) ?? (s.title as string) ?? "", family: s.package_family, created_at: s.created_at })),
    possible_matches: possible,
    auto_resolved: (resolved ?? []).map(r => ({ id: r.id, account: acctName.get(r.account_id) ?? null, caption: (r.caption as string)?.slice(0, 80) ?? null, permalink: r.permalink, thumbnail: r.media_public_url, published_at: r.published_at })),
    last_sync_at: lastRun?.finished_at ?? null,
  });
}
