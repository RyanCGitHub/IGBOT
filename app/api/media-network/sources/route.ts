import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Content sources CRUD. Source permission status drives the compliance
// engine — values mirror DB check constraints.
export const dynamic = "force-dynamic";

const SOURCE_TYPES = new Set(["instagram", "twitch", "kick", "youtube", "tiktok", "x", "website", "rss", "manual", "user_submission", "other"]);
const PERMISSIONS = new Set(["owned", "permissioned", "public_reference_only", "user_submitted", "unknown", "blocked"]);

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const brandId = Number(searchParams.get("brand_id"));

  let query = supabaseServer.from("content_sources").select("*").order("created_at", { ascending: false });
  if (Number.isInteger(brandId) && brandId > 0) query = query.eq("media_brand_id", brandId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, sources: data ?? [] });
}

type SourceBody = Record<string, unknown>;

function sanitize(body: SourceBody, isCreate: boolean): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  if (body.media_brand_id !== undefined) {
    const v = Number(body.media_brand_id);
    if (!Number.isInteger(v) || v < 1) return { error: "media_brand_id is required." };
    patch.media_brand_id = v;
  } else if (isCreate) {
    return { error: "media_brand_id is required." };
  }

  if (body.source_type !== undefined) {
    if (!SOURCE_TYPES.has(String(body.source_type))) return { error: "Invalid source_type." };
    patch.source_type = body.source_type;
  } else if (isCreate) {
    return { error: "source_type is required." };
  }

  if (body.source_name !== undefined) {
    const v = String(body.source_name).trim();
    if (!v) return { error: "source_name is required." };
    patch.source_name = v.slice(0, 200);
  } else if (isCreate) {
    return { error: "source_name is required." };
  }

  if (body.permission_status !== undefined) {
    if (!PERMISSIONS.has(String(body.permission_status))) return { error: "Invalid permission_status." };
    patch.permission_status = body.permission_status;
  }

  for (const f of ["source_url", "creator_or_publisher_name", "platform_handle", "permission_evidence", "allowed_usage_notes", "takedown_contact"]) {
    if (body[f] !== undefined) {
      const v = String(body[f] ?? "").trim();
      patch[f] = v ? v.slice(0, 600) : null;
    }
  }

  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  return { patch };
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: SourceBody;
  try { body = (await request.json()) as SourceBody; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const result = sanitize(body, true);
  if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("content_sources")
    .insert(result.patch)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Insert failed." }, { status: 500 });
  return NextResponse.json({ success: true, source: data });
}

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: SourceBody;
  try { body = (await request.json()) as SourceBody; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });

  const result = sanitize(body, false);
  if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  if (Object.keys(result.patch).length === 0) return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("content_sources")
    .update({ ...result.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Source not found." }, { status: 404 });
  return NextResponse.json({ success: true, source: data });
}
