import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Raw prediction-vs-actual evaluations (the /api/viral-accuracy route aggregates
// these; this returns the rows for drill-down). Optional account/window filters.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const p = new URL(request.url).searchParams;
  let q = supabaseServer.from("viral_score_evaluations").select("*").order("evaluated_at", { ascending: false }).limit(1000);
  const accountId = Number(p.get("account_id")) || null;
  if (accountId) q = q.eq("account_id", accountId);
  if (p.get("window")) q = q.eq("evaluation_window", p.get("window")!);
  const { data, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, evaluations: data ?? [] });
}
