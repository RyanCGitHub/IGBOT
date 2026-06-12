import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Clip assets CRUD. original_clip_url is a source REFERENCE for credit and
// takedown handling — the system never downloads from it; the actual media is
// uploaded_file_url (assisted upload to our bucket via signed URL, or a
// sanctioned platform API in Stream Watch later).
export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["twitch", "kick", "youtube", "other"]);
const MOMENTS = new Set(["funny", "argument", "reaction", "fail", "drama", "challenge", "highlight", "wholesome", "newsworthy"]);
const RIGHTS = new Set(["owned", "permissioned", "commentary_only", "fan_page_use", "needs_review", "blocked"]);
const RISKS = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["imported", "needs_review", "approved", "rejected", "used"]);

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const brandId = Number(searchParams.get("brand_id"));

  let query = supabaseServer.from("clip_assets").select("*").order("created_at", { ascending: false }).limit(100);
  if (Number.isInteger(brandId) && brandId > 0) query = query.eq("media_brand_id", brandId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, clips: data ?? [] });
}

type Body = Record<string, unknown>;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const brandId = Number(body.media_brand_id);
  const title = String(body.clip_title ?? "").trim();
  if (!Number.isInteger(brandId) || brandId < 1) return NextResponse.json({ success: false, error: "media_brand_id is required." }, { status: 400 });
  if (!title) return NextResponse.json({ success: false, error: "clip_title is required." }, { status: 400 });
  if (!String(body.uploaded_file_url ?? "").trim()) {
    return NextResponse.json({ success: false, error: "uploaded_file_url is required — upload the clip file first (the system never downloads from platforms)." }, { status: 400 });
  }

  const text = (field: string, max = 600) => {
    const v = String(body[field] ?? "").trim();
    return v ? v.slice(0, max) : null;
  };

  const row = {
    media_brand_id: brandId,
    source_id: body.source_id ? Number(body.source_id) : null,
    clip_title: title.slice(0, 200),
    original_clip_url: text("original_clip_url"),
    uploaded_file_url: text("uploaded_file_url", 800),
    streamer_name: text("streamer_name", 120),
    streamer_platform: PLATFORMS.has(String(body.streamer_platform)) ? body.streamer_platform : null,
    game_or_category: text("game_or_category", 120),
    clip_moment_type: MOMENTS.has(String(body.clip_moment_type)) ? body.clip_moment_type : null,
    duration_seconds: Number.isFinite(Number(body.duration_seconds)) ? Number(body.duration_seconds) : null,
    transcript: text("transcript", 8000),
    clip_summary: text("clip_summary", 1500),
    source_credit_text: text("source_credit_text", 300),
    rights_status: RIGHTS.has(String(body.rights_status)) ? body.rights_status : "needs_review",
    impersonation_risk: RISKS.has(String(body.impersonation_risk)) ? body.impersonation_risk : "low",
    status: "imported",
  };

  const { data, error } = await supabaseServer.from("clip_assets").insert(row).select("*").single();
  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Insert failed." }, { status: 500 });
  return NextResponse.json({ success: true, clip: data });
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
  if (body.rights_status !== undefined && RIGHTS.has(String(body.rights_status))) patch.rights_status = body.rights_status;
  if (body.impersonation_risk !== undefined && RISKS.has(String(body.impersonation_risk))) patch.impersonation_risk = body.impersonation_risk;
  if (body.clip_moment_type !== undefined && MOMENTS.has(String(body.clip_moment_type))) patch.clip_moment_type = body.clip_moment_type;
  if (body.status !== undefined && STATUSES.has(String(body.status))) patch.status = body.status;
  for (const f of ["clip_title", "streamer_name", "game_or_category", "transcript", "clip_summary", "source_credit_text"]) {
    if (body[f] !== undefined) patch[f] = String(body[f] ?? "").trim().slice(0, 8000) || null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("clip_assets")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Clip not found." }, { status: 404 });
  return NextResponse.json({ success: true, clip: data });
}
