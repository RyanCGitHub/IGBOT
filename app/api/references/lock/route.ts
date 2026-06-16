import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

// Lock / unlock the current reference pack for a Reel. A locked pack is the
// owner's confirmed selection — auto-pilot won't regenerate over it.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { reel_id?: number; locked?: boolean };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const reelId = Number(body.reel_id);
  if (!Number.isFinite(reelId)) {
    return NextResponse.json({ success: false, error: "reel_id is required." }, { status: 400 });
  }
  const locked = body.locked !== false;

  const { data, error } = await supabaseServer
    .from("reel_reference_packs")
    .update({ locked, updated_at: new Date().toISOString() })
    .eq("reel_id", reelId).eq("superseded", false)
    .select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, pack: data });
}
