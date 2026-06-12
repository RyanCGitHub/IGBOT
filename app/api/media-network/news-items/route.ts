import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { detectSensitivity } from "@/lib/media-network/compliance";

// News items CRUD. Manual intake auto-flags sensitivity at creation —
// crime/minors/legal/death patterns force high sensitivity (manual review
// mandatory downstream).
export const dynamic = "force-dynamic";

const CLAIM_TYPES = new Set(["confirmed", "developing", "rumor", "opinion", "user_submitted"]);
const VERIFICATIONS = new Set(["unverified", "single_source", "multi_source", "official_source", "rejected"]);
const SENSITIVITIES = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["collected", "needs_review", "approved", "rejected", "used"]);

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const brandId = Number(searchParams.get("brand_id"));
  const status = searchParams.get("status");

  let query = supabaseServer.from("news_items").select("*").order("created_at", { ascending: false }).limit(100);
  if (Number.isInteger(brandId) && brandId > 0) query = query.eq("media_brand_id", brandId);
  if (status && STATUSES.has(status)) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, items: data ?? [] });
}

type Body = Record<string, unknown>;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const brandId = Number(body.media_brand_id);
  const headline = String(body.headline ?? "").trim();
  if (!Number.isInteger(brandId) || brandId < 1) return NextResponse.json({ success: false, error: "media_brand_id is required." }, { status: 400 });
  if (!headline) return NextResponse.json({ success: false, error: "headline is required." }, { status: 400 });

  const text = (field: string, max = 600) => {
    const v = String(body[field] ?? "").trim();
    return v ? v.slice(0, max) : null;
  };

  const summary = text("short_summary", 1000);
  const sensitivity = detectSensitivity(`${headline} ${summary ?? ""} ${text("full_context", 2000) ?? ""}`);

  const row = {
    media_brand_id: brandId,
    source_id: body.source_id ? Number(body.source_id) : null,
    headline: headline.slice(0, 300),
    short_summary: summary,
    full_context: text("full_context", 4000),
    source_url: text("source_url"),
    source_name: text("source_name", 200),
    city_or_region: text("city_or_region", 120),
    category: text("category", 80),
    people_or_brands_involved: text("people_or_brands_involved", 400),
    claim_type: CLAIM_TYPES.has(String(body.claim_type)) ? body.claim_type : "developing",
    verification_status: VERIFICATIONS.has(String(body.verification_status)) ? body.verification_status : "unverified",
    sensitivity_level: sensitivity === "high" ? "high" : (SENSITIVITIES.has(String(body.sensitivity_level)) ? body.sensitivity_level : sensitivity),
    source_credit_text: text("source_credit_text", 300),
    status: sensitivity === "high" ? "needs_review" : "collected",
  };

  const { data, error } = await supabaseServer.from("news_items").insert(row).select("*").single();
  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Insert failed." }, { status: 500 });
  return NextResponse.json({ success: true, item: data, autoFlaggedHigh: sensitivity === "high" });
}

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.verification_status !== undefined && VERIFICATIONS.has(String(body.verification_status))) patch.verification_status = body.verification_status;
  if (body.sensitivity_level !== undefined && SENSITIVITIES.has(String(body.sensitivity_level))) patch.sensitivity_level = body.sensitivity_level;
  if (body.claim_type !== undefined && CLAIM_TYPES.has(String(body.claim_type))) patch.claim_type = body.claim_type;
  if (body.status !== undefined && STATUSES.has(String(body.status))) patch.status = body.status;
  for (const f of ["headline", "short_summary", "category", "city_or_region", "source_credit_text"]) {
    if (body[f] !== undefined) patch[f] = String(body[f] ?? "").trim().slice(0, 1000) || null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("news_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Item not found." }, { status: 404 });
  return NextResponse.json({ success: true, item: data });
}
