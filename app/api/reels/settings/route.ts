import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// GET: per-account autopilot settings. PATCH: update them.
// This is the ONE human control surface of the reels pipeline — everything
// downstream of the toggle is autonomous.
export const dynamic = "force-dynamic";

const SETTINGS_FIELDS = "id, account_name, reels_autopilot_enabled, reels_daily_cap, niche, posting_hour_utc";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("connected_accounts")
    .select(SETTINGS_FIELDS)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, accounts: data ?? [] });
}

type PatchBody = {
  account_id?: number;
  reels_autopilot_enabled?: boolean;
  reels_daily_cap?: number;
  niche?: string | null;
  posting_hour_utc?: number | null;
};

export async function PATCH(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const accountId = Number(body.account_id);
  if (!Number.isInteger(accountId) || accountId < 1) {
    return NextResponse.json({ success: false, error: "account_id is required." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.reels_autopilot_enabled === "boolean") {
    patch.reels_autopilot_enabled = body.reels_autopilot_enabled;
  }
  if (body.reels_daily_cap !== undefined) {
    const cap = Number(body.reels_daily_cap);
    // Hard ceiling well under Instagram's ~25 API posts/day limit.
    if (!Number.isInteger(cap) || cap < 1 || cap > 5) {
      return NextResponse.json({ success: false, error: "reels_daily_cap must be 1-5." }, { status: 400 });
    }
    patch.reels_daily_cap = cap;
  }
  if (body.niche !== undefined) {
    patch.niche = typeof body.niche === "string" && body.niche.trim() ? body.niche.trim().slice(0, 300) : null;
  }
  if (body.posting_hour_utc !== undefined) {
    if (body.posting_hour_utc === null) {
      patch.posting_hour_utc = null;
    } else {
      const hour = Number(body.posting_hour_utc);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ success: false, error: "posting_hour_utc must be 0-23 or null." }, { status: 400 });
      }
      patch.posting_hour_utc = hour;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("connected_accounts")
    .update(patch)
    .eq("id", accountId)
    .select(SETTINGS_FIELDS)
    .single();

  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? "Account not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, account: data });
}
