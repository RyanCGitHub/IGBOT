import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type Params = { id: string };

// ─── DELETE: remove a saved idea ────────────────────────────────────────────────
// Deleting an idea never affects any draft post already created from it.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid idea id." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("content_ideas")
    .delete()
    .eq("id", numericId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Idea not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
