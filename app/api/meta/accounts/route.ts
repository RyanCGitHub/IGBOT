import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// access_token is intentionally excluded from the SELECT — never sent to the browser.
// supabaseServer uses the service role key (bypasses RLS); the anon key
// cannot access this table at all.
export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("connected_accounts")
    .select("id, platform, account_name, ig_user_id, token_expires_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, accounts: data });
}
