import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { publicUrlFor } from "@/lib/reels/storage";
import type { ReelRun, ReelBrief } from "@/lib/reels/types";

// GET /api/reels/runs — pipeline state for the dashboard, newest first.
// Returns a trimmed view: full briefs/clips stay server-side.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const { data: runs, error } = await supabaseServer
    .from("reel_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const { data: accounts } = await supabaseServer
    .from("connected_accounts")
    .select("id, account_name");
  const nameById = new Map((accounts ?? []).map(a => [a.id as number, a.account_name as string]));

  const view = ((runs ?? []) as ReelRun[]).map(run => {
    const brief = run.brief as ReelBrief | null;
    return {
      id: run.id,
      account_id: run.account_id,
      account_name: nameById.get(run.account_id) ?? null,
      status: run.status,
      failed_stage: run.failed_stage,
      title: brief?.title ?? null,
      hook: brief?.hook ?? null,
      beats: brief?.beats?.length ?? 0,
      audio_mood: brief?.audio_mood ?? null,
      keyframes_done: run.keyframes?.length ?? 0,
      clips_done: (run.clips ?? []).filter(c => c.status === "done").length,
      video_url: run.assembled_video_path ? publicUrlFor(run.assembled_video_path) : null,
      caption_preview: run.caption ? run.caption.split("\n")[0].slice(0, 120) : null,
      scheduled_for: run.scheduled_for,
      permalink: run.permalink,
      error_message: run.error_message,
      attempt_count: run.attempt_count,
      published_at: run.published_at,
      created_at: run.created_at,
      updated_at: run.updated_at,
    };
  });

  return NextResponse.json({ success: true, runs: view });
}
