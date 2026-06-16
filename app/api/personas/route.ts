import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const NAME_MAX = 120;
const TEXT_MAX = 6_000;     // bio / voice / visual_style etc. can be detailed
const SHORT_MAX = 300;      // handle, persona_type, disclosure text
const MAX_PILLARS = 12;

// Normalize content_pillars into a clean string[] (or null). Returns undefined
// for "not provided" so PATCH can distinguish absent from cleared.
function cleanPillars(v: unknown): string[] | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  const arr = v
    .filter((x): x is string => typeof x === "string")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PILLARS);
  return arr.length ? arr : null;
}

function clamp(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

// ─── GET: list personas (optionally filtered by account) ────────────────────────

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const accountParam = searchParams.get("account_id");

  let query = supabaseServer
    .from("personas")
    .select("*")
    .order("created_at", { ascending: false });

  if (accountParam) {
    const accountId = Number(accountParam);
    if (!Number.isInteger(accountId) || accountId < 1) {
      return NextResponse.json({ success: false, error: "Invalid account_id." }, { status: 400 });
    }
    query = query.eq("account_id", accountId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, personas: data });
}

// ─── POST: create a persona ─────────────────────────────────────────────────────

type CreateBody = {
  account_id?: number;
  name?: string;
  handle_display?: string;
  persona_type?: string;
  bio?: string;
  voice_and_tone?: string;
  visual_style?: string;
  content_pillars?: unknown;
  audience_description?: string;
  hashtag_strategy?: string;
  ai_disclosure_enabled?: boolean;
  ai_disclosure_text?: string;
  character_bible?: Record<string, string>;
  negative_prompt?: string;
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

  const accountId = Number(body.account_id);
  if (!Number.isInteger(accountId) || accountId < 1) {
    return NextResponse.json({ success: false, error: "account_id is required." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ success: false, error: "name is required." }, { status: 400 });
  }
  if (name.length > NAME_MAX) {
    return NextResponse.json({ success: false, error: `name must be ${NAME_MAX} characters or fewer.` }, { status: 400 });
  }

  // Verify the connected account exists (FK also enforces this; clean error here).
  const { data: account, error: acctErr } = await supabaseServer
    .from("connected_accounts")
    .select("id")
    .eq("id", accountId)
    .single();
  if (acctErr || !account) {
    return NextResponse.json({ success: false, error: "Connected account not found." }, { status: 404 });
  }

  const insert: Record<string, unknown> = {
    account_id: accountId,
    name,
    handle_display: clamp(body.handle_display, SHORT_MAX),
    persona_type: clamp(body.persona_type, SHORT_MAX),
    bio: clamp(body.bio, TEXT_MAX),
    voice_and_tone: clamp(body.voice_and_tone, TEXT_MAX),
    visual_style: clamp(body.visual_style, TEXT_MAX),
    content_pillars: cleanPillars(body.content_pillars) ?? null,
    audience_description: clamp(body.audience_description, TEXT_MAX),
    hashtag_strategy: clamp(body.hashtag_strategy, TEXT_MAX),
    character_bible: body.character_bible && typeof body.character_bible === "object" ? body.character_bible : null,
    negative_prompt: clamp(body.negative_prompt, TEXT_MAX),
  };
  if (typeof body.ai_disclosure_enabled === "boolean") insert.ai_disclosure_enabled = body.ai_disclosure_enabled;
  const disclosure = clamp(body.ai_disclosure_text, SHORT_MAX);
  if (disclosure) insert.ai_disclosure_text = disclosure;

  const { data, error } = await supabaseServer
    .from("personas")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    // Unique violation on account_id → one persona per account.
    if (error.code === "23505") {
      return NextResponse.json(
        { success: false, error: "A persona already exists for this account. Edit it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, persona: data }, { status: 201 });
}
