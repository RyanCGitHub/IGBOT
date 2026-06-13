import { NextResponse } from "next/server";
import { requireCronOrApiKey } from "@/lib/cron-auth";
import { syncInstagramAnalytics, recordSyncRun } from "@/lib/analytics/sync";

// Hourly Instagram analytics sync. Detects new IG posts, snapshots due posts,
// recovers stuck manual-queue items, backfills missing viral scores, refreshes
// accuracy evals. ?dryRun=true previews the plan without writing anything.
// Secured by CRON_SECRET (Vercel cron) or the internal API key.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request): Promise<NextResponse> {
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();
  const trigger = dryRun ? "dry_run" : "cron";
  try {
    const summary = await syncInstagramAnalytics({ dryRun, trigger });
    await recordSyncRun(startedAt, summary, trigger);
    return NextResponse.json({ success: true, dryRun, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/sync-instagram-analytics] threw:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return run(request);
}
export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return run(request);
}
