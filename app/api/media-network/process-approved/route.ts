import { NextResponse } from "next/server";
import { requireCronOrApiKey, publishingPaused, pausedResponse } from "@/lib/cron-auth";
import { runNewsAutoPilot } from "@/lib/media-network/auto-pilot";

// The news auto-pilot cron. Picks up owner-approved news items for brands with
// auto_publish enabled, generates + schedules them. Publishing itself still
// runs through process-scheduled (spacing-gated). Honors the global publish
// pause so REELS_PAUSED halts the whole network, not just reels.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(): Promise<NextResponse> {
  if (publishingPaused()) return pausedResponse();
  try {
    const summary = await runNewsAutoPilot();
    console.log(
      `[process-approved] brands=${summary.brandsChecked} considered=${summary.itemsConsidered} ` +
      `scheduled=${summary.scheduled} parked=${summary.parked} failed=${summary.failed}`
    );
    return NextResponse.json({ success: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[process-approved] auto-pilot threw:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return run();
}

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return run();
}
