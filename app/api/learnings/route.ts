import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const FINDING_MAX = 2_000;

// ─── GET: list learnings (optional account_id / status filter) ──────────────────

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const accountParam = searchParams.get("account_id");
  const statusParam = searchParams.get("status");

  let query = supabaseServer.from("learnings").select("*").order("created_at", { ascending: false });

  if (accountParam) {
    const accountId = Number(accountParam);
    if (!Number.isInteger(accountId) || accountId < 1) {
      return NextResponse.json({ success: false, error: "Invalid account_id." }, { status: 400 });
    }
    query = query.eq("account_id", accountId);
  }
  if (statusParam === "active" || statusParam === "archived") {
    query = query.eq("status", statusParam);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, learnings: data });
}

// ─── POST: create a learning ────────────────────────────────────────────────────

type CreateBody = {
  account_id?: number;
  persona_id?: number | null;
  finding?: string;
  evidence?: Record<string, unknown>;
  status?: string;
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
  const finding = body.finding?.trim();
  if (!finding) {
    return NextResponse.json({ success: false, error: "finding is required." }, { status: 400 });
  }
  if (finding.length > FINDING_MAX) {
    return NextResponse.json({ success: false, error: `finding must be ${FINDING_MAX} characters or fewer.` }, { status: 400 });
  }

  const status = body.status === "archived" ? "archived" : "active";

  const { data, error } = await supabaseServer
    .from("learnings")
    .insert({
      account_id: accountId,
      persona_id: body.persona_id ?? null,
      finding,
      evidence: body.evidence ?? null,
      status,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, learning: data }, { status: 201 });
}
