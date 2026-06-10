import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const NAME_MAX = 120;
const DESC_MAX = 2_000;

// ─── GET: list all campaigns ────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, campaigns: data });
}

// ─── POST: create a campaign ────────────────────────────────────────────────────

type CreateBody = {
  name?: string;
  description?: string;
  account_id?: number | null;
  content_style?: string;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ success: false, error: "name is required." }, { status: 400 });
  }
  if (name.length > NAME_MAX) {
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

  const { data, error } = await supabaseServer
    .from("campaigns")
    .insert({
      name,
      description: body.description?.trim() || null,
      account_id: body.account_id ?? null,
      content_style: body.content_style?.trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, campaign: data }, { status: 201 });
}
