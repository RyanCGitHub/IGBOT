import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const NAME_MAX = 120;
const DESC_MAX = 2_000;
type Params = { id: string };

// ─── PATCH: edit a campaign ─────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid campaign id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.name === "string" && body.name.trim().length === 0) {
    return NextResponse.json({ success: false, error: "name cannot be empty." }, { status: 400 });
  }
  if (typeof body.name === "string" && body.name.trim().length > NAME_MAX) {
    return NextResponse.json(
      { success: false, error: `name must be ${NAME_MAX} characters or fewer.` },
      { status: 400 }
    );
  }
  if (typeof body.description === "string" && body.description.trim().length > DESC_MAX) {
    return NextResponse.json(
      { success: false, error: `description must be ${DESC_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  // Only allow safe fields to be patched
  const allowed = ["name", "description", "account_id", "content_style"];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  if (typeof patch.name === "string") patch.name = patch.name.trim();
  if (typeof patch.description === "string") patch.description = patch.description.trim() || null;
  if (typeof patch.content_style === "string") patch.content_style = patch.content_style.trim() || null;

  const { data, error } = await supabaseServer
    .from("campaigns")
    .update(patch)
    .eq("id", numericId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, campaign: data });
}

// ─── DELETE: remove a campaign ──────────────────────────────────────────────────
// Posts keep working — ig_posts.campaign_id is ON DELETE SET NULL, so any posts
// assigned to this campaign simply become unassigned.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid campaign id." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("campaigns")
    .delete()
    .eq("id", numericId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
