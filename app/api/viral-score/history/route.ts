import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Every viral score ever given, filterable. Powers the Viral Score History page.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const p = new URL(request.url).searchParams;

  let q = supabaseServer.from("viral_score_history").select("*").order("scored_at", { ascending: false }).limit(1000);
  const accountId = Number(p.get("account_id")) || null;
  if (accountId) q = q.eq("account_id", accountId);
  if (p.get("score_context")) q = q.eq("score_context", p.get("score_context")!);
  if (p.get("media_type")) q = q.eq("media_type", p.get("media_type")!);
  if (p.get("content_lane")) q = q.eq("content_lane", p.get("content_lane")!);
  if (p.get("scoring_model_version")) q = q.eq("scoring_model_version", p.get("scoring_model_version")!);
  if (p.get("date_from")) q = q.gte("scored_at", p.get("date_from")!);
  if (p.get("date_to")) q = q.lte("scored_at", p.get("date_to")!);
  if (p.get("score_min")) q = q.gte("viral_score", Number(p.get("score_min")));
  if (p.get("score_max")) q = q.lte("viral_score", Number(p.get("score_max")));

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Attach post context (thumbnail/permalink/status) + accuracy if evaluated.
  const ppIds = [...new Set((rows ?? []).map(r => r.published_post_id).filter(Boolean))] as number[];
  const acctIds = [...new Set((rows ?? []).map(r => r.account_id).filter(Boolean))] as number[];
  const [{ data: posts }, { data: accounts }, { data: evals }] = await Promise.all([
    ppIds.length ? supabaseServer.from("published_posts").select("id, media_public_url, permalink, status").in("id", ppIds) : Promise.resolve({ data: [] }),
    acctIds.length ? supabaseServer.from("connected_accounts").select("id, account_name").in("id", acctIds) : Promise.resolve({ data: [] }),
    ppIds.length ? supabaseServer.from("viral_score_evaluations").select("published_post_id, accuracy_score, prediction_result").eq("evaluation_window", "72h").in("published_post_id", ppIds) : Promise.resolve({ data: [] }),
  ]);
  const postById = new Map((posts ?? []).map(p => [p.id, p]));
  const acctById = new Map((accounts ?? []).map(a => [a.id, a.account_name]));
  const evalById = new Map((evals ?? []).map(e => [e.published_post_id, e]));

  return NextResponse.json({
    success: true,
    rows: (rows ?? []).map(r => ({
      ...r,
      account_name: r.account_id ? acctById.get(r.account_id) ?? null : null,
      thumbnail: r.published_post_id ? postById.get(r.published_post_id)?.media_public_url ?? null : null,
      permalink: r.published_post_id ? postById.get(r.published_post_id)?.permalink ?? null : null,
      post_status: r.published_post_id ? postById.get(r.published_post_id)?.status ?? null : null,
      accuracy_score: r.published_post_id ? evalById.get(r.published_post_id)?.accuracy_score ?? null : null,
      prediction_result: r.published_post_id ? evalById.get(r.published_post_id)?.prediction_result ?? null : null,
    })),
  });
}
