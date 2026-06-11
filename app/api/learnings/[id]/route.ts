import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const FINDING_MAX = 2_000;
type Params = { id: string };

// ─── PATCH: edit a learning (archive/activate, edit finding) ────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid learning id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("finding" in body) {
    const f = typeof body.finding === "string" ? body.finding.trim() : "";
    if (!f) return NextResponse.json({ success: false, error: "finding cannot be empty." }, { status: 400 });
    if (f.length > FINDING_MAX) {
      return NextResponse.json({ success: false, error: `finding must be ${FINDING_MAX} characters or fewer.` }, { status: 400 });
    }
    patch.finding = f;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "archived") {
      return NextResponse.json({ success: false, error: "status must be 'active' or 'archived'." }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ("evidence" in body) {
    patch.evidence = body.evidence ?? null;
  }

  const { data, error } = await supabaseServer
    .from("learnings")
    .update(patch)
    .eq("id", numericId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Learning not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, learning: data });
}

// ─── DELETE: remove a learning ──────────────────────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid learning id." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("learnings")
    .delete()
    .eq("id", numericId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Learning not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
