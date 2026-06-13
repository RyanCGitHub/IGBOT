import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Pre-publish viral gate: config (enable + threshold) and the held-for-review
// queue. Override flips a held item back to its publish lane with gate_override
// set, so the next cron pass republishes it (recording an "override" review).
export const dynamic = "force-dynamic";

type HeldItem = {
  kind: "ig_post" | "reel";
  id: number;
  caption: string | null;
  image_url: string | null;
  viral_score: number | null;
  verdict: string | null;
  weaknesses: string[];
};

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const [{ data: config }, { data: heldPosts }, { data: heldReels }, { data: reviews }] = await Promise.all([
    supabaseServer.from("viral_gate_config").select("enabled, min_score").eq("id", 1).maybeSingle(),
    supabaseServer.from("ig_posts").select("id, caption, image_url").eq("status", "held_review").is("archived_at", null).limit(50),
    supabaseServer.from("reel_runs").select("id, caption, ig_post_id").eq("status", "held_review").limit(50),
    supabaseServer.from("content_reviews").select("ig_post_id, reel_run_id, viral_score, verdict, weaknesses").eq("gate_decision", "held").order("created_at", { ascending: false }).limit(300),
  ]);

  // Latest held review per object.
  const postReview = new Map<number, { viral_score: number | null; verdict: string | null; weaknesses: string[] }>();
  const reelReview = new Map<number, { viral_score: number | null; verdict: string | null; weaknesses: string[] }>();
  for (const r of reviews ?? []) {
    const rec = { viral_score: r.viral_score as number | null, verdict: r.verdict as string | null, weaknesses: (r.weaknesses as string[]) ?? [] };
    if (r.ig_post_id != null && !postReview.has(r.ig_post_id as number)) postReview.set(r.ig_post_id as number, rec);
    if (r.reel_run_id != null && !reelReview.has(r.reel_run_id as number)) reelReview.set(r.reel_run_id as number, rec);
  }

  const held: HeldItem[] = [];
  for (const p of heldPosts ?? []) {
    const rev = postReview.get(p.id as number);
    held.push({ kind: "ig_post", id: p.id as number, caption: p.caption as string | null, image_url: p.image_url as string | null, viral_score: rev?.viral_score ?? null, verdict: rev?.verdict ?? null, weaknesses: rev?.weaknesses ?? [] });
  }
  for (const r of heldReels ?? []) {
    const rev = reelReview.get(r.id as number);
    held.push({ kind: "reel", id: r.id as number, caption: r.caption as string | null, image_url: null, viral_score: rev?.viral_score ?? null, verdict: rev?.verdict ?? null, weaknesses: rev?.weaknesses ?? [] });
  }
  held.sort((a, b) => (a.viral_score ?? 999) - (b.viral_score ?? 999));

  return NextResponse.json({
    success: true,
    config: { enabled: !!config?.enabled, min_score: Number(config?.min_score) || 0 },
    held,
  });
}

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { enabled?: boolean; min_score?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.min_score !== undefined) {
    const v = Number(body.min_score);
    if (!Number.isInteger(v) || v < 0 || v > 100) return NextResponse.json({ success: false, error: "min_score must be 0–100." }, { status: 400 });
    patch.min_score = v;
  }

  const { data, error } = await supabaseServer.from("viral_gate_config").update(patch).eq("id", 1).select("enabled, min_score").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, config: { enabled: !!data.enabled, min_score: Number(data.min_score) || 0 } });
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { action?: string; kind?: string; id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  if (body.action !== "override") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });
  const now = new Date().toISOString();

  if (body.kind === "ig_post") {
    // Re-queue immediately; the gate honors gate_override on the next pass.
    const { error } = await supabaseServer.from("ig_posts")
      .update({ status: "scheduled", scheduled_at: now, gate_override: true, archived_at: null, updated_at: now })
      .eq("id", id).eq("status", "held_review");
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  if (body.kind === "reel") {
    const { error } = await supabaseServer.from("reel_runs")
      .update({ status: "captioned", gate_override: true, error_message: null, updated_at: now })
      .eq("id", id).eq("status", "held_review");
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "kind must be 'ig_post' or 'reel'." }, { status: 400 });
}
