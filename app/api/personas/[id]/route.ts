import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const NAME_MAX = 120;
const TEXT_MAX = 6_000;
const SHORT_MAX = 300;
const MAX_PILLARS = 12;
type Params = { id: string };

function cleanPillars(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  const arr = v
    .filter((x): x is string => typeof x === "string")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PILLARS);
  return arr.length ? arr : null;
}

// ─── GET: single persona ────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid persona id." }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("personas")
    .select("*")
    .eq("id", numericId)
    .single();

  if (error || !data) {
    return NextResponse.json({ success: false, error: "Persona not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, persona: data });
}

// ─── PATCH: update a persona ────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid persona id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.name === "string") {
    if (!body.name.trim()) {
      return NextResponse.json({ success: false, error: "name cannot be empty." }, { status: 400 });
    }
    if (body.name.trim().length > NAME_MAX) {
      return NextResponse.json({ success: false, error: `name must be ${NAME_MAX} characters or fewer.` }, { status: 400 });
    }
  }

  // account_id is intentionally NOT patchable — one persona per account.
  const textFields: Record<string, number> = {
    name: NAME_MAX,
    handle_display: SHORT_MAX,
    persona_type: SHORT_MAX,
    bio: TEXT_MAX,
    voice_and_tone: TEXT_MAX,
    visual_style: TEXT_MAX,
    audience_description: TEXT_MAX,
    hashtag_strategy: TEXT_MAX,
    ai_disclosure_text: SHORT_MAX,
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const [key, max] of Object.entries(textFields)) {
    if (key in body) {
      const v = body[key];
      patch[key] = typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    }
  }
  if ("content_pillars" in body) patch.content_pillars = cleanPillars(body.content_pillars);
  if (typeof body.ai_disclosure_enabled === "boolean") patch.ai_disclosure_enabled = body.ai_disclosure_enabled;

  // name must stay non-null if explicitly set null above
  if ("name" in body && patch.name == null) {
    return NextResponse.json({ success: false, error: "name cannot be empty." }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("personas")
    .update(patch)
    .eq("id", numericId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Persona not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, persona: data });
}

// ─── DELETE: remove a persona ───────────────────────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid persona id." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("personas")
    .delete()
    .eq("id", numericId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Persona not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
