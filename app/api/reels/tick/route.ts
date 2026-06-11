import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireCronOrApiKey, publishingPaused, pausedResponse } from "@/lib/cron-auth";
import { advanceRun, failurePatch } from "@/lib/reels/stages";
import { ACTIVE_STATUSES, type ReelRun } from "@/lib/reels/types";

// The pipeline heartbeat. Vercel cron calls GET every 5 minutes; each tick
// leases up to RUNS_PER_TICK active runs and advances each by ONE stage.
// ffmpeg assembly is the long pole, hence the high maxDuration (Fluid compute).
export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

const RUNS_PER_TICK = 3;
const LOCK_STALE_MIN = 20; // a crashed tick's lease expires after this

async function runTick(): Promise<NextResponse> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_STALE_MIN * 60_000).toISOString();

  const { data: candidates, error: fetchErr } = await supabaseServer
    .from("reel_runs")
    .select("*")
    .in("status", ACTIVE_STATUSES)
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
    .order("updated_at", { ascending: true })
    .limit(RUNS_PER_TICK);

  if (fetchErr) {
    return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
  }

  const results: { id: number; from: string; to: string; note?: string; error?: string }[] = [];

  for (const run of (candidates ?? []) as ReelRun[]) {
    // Lease the run — the filter re-check makes concurrent ticks safe.
    const { data: locked } = await supabaseServer
      .from("reel_runs")
      .update({ locked_at: now.toISOString() })
      .eq("id", run.id)
      .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
      .select("id");
    if (!locked || locked.length === 0) continue; // another tick owns it

    try {
      const result = await advanceRun(run);
      results.push({ id: run.id, ...result });
      console.log(`[reels/tick] run ${run.id}: ${result.from} → ${result.to}${result.note ? ` (${result.note})` : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const patch = failurePatch(run, msg);
      await supabaseServer
        .from("reel_runs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", run.id);
      results.push({ id: run.id, from: run.status, to: (patch.status as string) ?? run.status, error: msg });
      console.error(`[reels/tick] run ${run.id} failed at ${run.status}: ${msg}`);
    } finally {
      await supabaseServer.from("reel_runs").update({ locked_at: null }).eq("id", run.id);
    }
  }

  return NextResponse.json({ success: true, serverTime: now.toISOString(), processed: results.length, results });
}

// Vercel cron invokes GET; the dashboard's "Run now" uses POST. Both do work.
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return runTick();
}

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return runTick();
}
