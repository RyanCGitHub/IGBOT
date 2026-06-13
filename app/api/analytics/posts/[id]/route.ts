import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Per-post analytics detail: the post, every metrics snapshot over time, its
// score history, and prediction-vs-actual evaluations.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "Invalid id." }, { status: 400 });

  const [{ data: post }, { data: snapshots }, { data: history }, { data: evaluations }] = await Promise.all([
    supabaseServer.from("published_posts").select("*").eq("id", id).maybeSingle(),
    supabaseServer.from("post_metrics_snapshots").select("captured_at, hours_since_publish, views, reach, likes, comments, shares, saves, total_interactions, engagement_rate").eq("published_post_id", id).order("hours_since_publish", { ascending: true }),
    supabaseServer.from("viral_score_history").select("*").eq("published_post_id", id).order("scored_at", { ascending: false }),
    supabaseServer.from("viral_score_evaluations").select("*").eq("published_post_id", id).order("evaluation_window", { ascending: true }),
  ]);
  if (!post) return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });

  return NextResponse.json({ success: true, post, snapshots: snapshots ?? [], score_history: history ?? [], evaluations: evaluations ?? [] });
}
