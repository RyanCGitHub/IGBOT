import { NextResponse } from "next/server";
import { requireCronOrApiKey } from "@/lib/cron-auth";
import { runStreamWatch } from "@/lib/media-network/stream-watch";

// Stream Watch cron: polls the official Twitch Clips API for tracked streamers,
// ranks new clips by view velocity, and surfaces the risers in the Clip Desk as
// candidates for review. Never downloads media or auto-posts. ?dryRun=true
// previews without writing. Needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(request: Request): Promise<NextResponse> {
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  try {
    const summary = await runStreamWatch({ dryRun });
    return NextResponse.json({ success: true, dryRun, summary });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
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
