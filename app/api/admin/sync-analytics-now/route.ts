import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { syncInstagramAnalytics, recordSyncRun } from "@/lib/analytics/sync";

// Manual "Sync Analytics Now" — same engine as the hourly cron, triggered from
// the dashboard so the owner can run it on demand. Internal-API-key protected.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();
  try {
    const summary = await syncInstagramAnalytics({ dryRun, trigger: dryRun ? "dry_run" : "admin" });
    await recordSyncRun(startedAt, summary, dryRun ? "dry_run" : "admin");
    return NextResponse.json({ success: true, dryRun, summary });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
