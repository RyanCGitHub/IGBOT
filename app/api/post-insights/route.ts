import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// GET /api/post-insights
// Read-only. Returns all stored insight snapshots so the Analytics UI can show
// persisted metrics on load without re-calling Instagram.
export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("post_insights")
    .select("*")
    .order("synced_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, insights: data });
}
