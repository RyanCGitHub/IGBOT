import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { publicUrlFor } from "@/lib/reels/storage";

// Content packages: the review hub's data layer. GET lists (with optional
// status filter); PATCH edits review-editable fields and status transitions.
export const dynamic = "force-dynamic";

// "published" lets the Manual Queue mark hand-posted items done.
const EDIT_STATUSES = new Set(["idea", "draft", "ready", "rejected", "archived", "published"]);

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const manualOnly = searchParams.get("manual_only");

  let query = supabaseServer.from("content_packages").select("*").order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  if (manualOnly === "true") query = query.eq("manual_only", true);
  else if (manualOnly === "false") query = query.eq("manual_only", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Resolve storage paths to public URLs so the Manual Queue can offer direct
  // image/video downloads (the bucket is public).
  const packages = (data ?? []).map(p => ({
    ...p,
    media_public_url: p.processed_media_path ? publicUrlFor(p.processed_media_path) : null,
    manual_video_public_url: p.manual_video_path ? publicUrlFor(p.manual_video_path) : null,
  }));
  return NextResponse.json({ success: true, packages });
}

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const f of ["hook", "caption", "hashtags", "on_screen_text", "title", "source_credit_text"]) {
    if (body[f] !== undefined) {
      const v = String(body[f] ?? "").trim();
      if (f === "source_credit_text" && !v) {
        return NextResponse.json({ success: false, error: "Source credit cannot be removed." }, { status: 400 });
      }
      patch[f] = v ? v.slice(0, 3000) : null;
    }
  }
  if (body.status !== undefined) {
    if (!EDIT_STATUSES.has(String(body.status))) return NextResponse.json({ success: false, error: "Invalid status for manual transition." }, { status: 400 });
    patch.status = body.status;
  }
  if (body.suggested_publish_time !== undefined) {
    patch.suggested_publish_time = body.suggested_publish_time ? new Date(String(body.suggested_publish_time)).toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("content_packages")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ success: false, error: error?.message ?? "Package not found." }, { status: 404 });
  return NextResponse.json({ success: true, package: data });
}
