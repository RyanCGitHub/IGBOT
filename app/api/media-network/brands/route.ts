import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Media brands CRUD. GET returns brands newest-first; POST creates; PATCH
// updates by id. Validation mirrors the DB check constraints so errors are
// readable instead of constraint violations.
export const dynamic = "force-dynamic";

const BRAND_TYPES = new Set(["news_media", "streamer_clips"]);
const FORMATS = new Set(["reels", "carousel", "image", "mixed"]);
const RISKS = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["active", "paused", "archived"]);

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("media_brands")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, brands: data ?? [] });
}

type BrandBody = Record<string, unknown>;

function sanitize(body: BrandBody, isCreate: boolean): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  if (body.brand_name !== undefined) {
    const v = String(body.brand_name).trim();
    if (!v) return { error: "brand_name is required." };
    patch.brand_name = v.slice(0, 120);
  } else if (isCreate) {
    return { error: "brand_name is required." };
  }

  if (body.brand_type !== undefined) {
    if (!BRAND_TYPES.has(String(body.brand_type))) return { error: "brand_type must be news_media or streamer_clips." };
    patch.brand_type = body.brand_type;
  } else if (isCreate) {
    return { error: "brand_type is required." };
  }

  for (const f of ["instagram_handle", "niche", "sub_niche", "city_or_region", "target_audience", "brand_voice", "caption_style", "hook_style"]) {
    if (body[f] !== undefined) {
      const v = String(body[f] ?? "").trim();
      patch[f] = v ? v.slice(0, 300) : null;
    }
  }

  if (body.connected_account_id !== undefined) {
    patch.connected_account_id = body.connected_account_id === null ? null : Number(body.connected_account_id);
  }
  if (body.content_format_preference !== undefined) {
    if (!FORMATS.has(String(body.content_format_preference))) return { error: "Invalid content_format_preference." };
    patch.content_format_preference = body.content_format_preference;
  }
  if (body.posting_frequency_goal !== undefined) {
    const v = Number(body.posting_frequency_goal);
    if (!Number.isInteger(v) || v < 1 || v > 25) return { error: "posting_frequency_goal must be 1-25." };
    patch.posting_frequency_goal = v;
  }
  if (body.min_minutes_between_posts !== undefined) {
    const v = Number(body.min_minutes_between_posts);
    if (!Number.isInteger(v) || v < 0 || v > 1440) return { error: "min_minutes_between_posts must be 0-1440." };
    patch.min_minutes_between_posts = v;
  }
  if (body.risk_level !== undefined) {
    if (!RISKS.has(String(body.risk_level))) return { error: "Invalid risk_level." };
    patch.risk_level = body.risk_level;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(String(body.status))) return { error: "Invalid status." };
    patch.status = body.status;
  }

  return { patch };
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: BrandBody;
  try { body = (await request.json()) as BrandBody; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const result = sanitize(body, true);
  if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("media_brands")
    .insert(result.patch)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Insert failed." }, { status: 500 });
  return NextResponse.json({ success: true, brand: data });
}

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: BrandBody;
  try { body = (await request.json()) as BrandBody; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });

  const result = sanitize(body, false);
  if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  if (Object.keys(result.patch).length === 0) return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("media_brands")
    .update({ ...result.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Brand not found." }, { status: 404 });
  return NextResponse.json({ success: true, brand: data });
}
