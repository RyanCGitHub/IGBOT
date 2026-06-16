import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import type { ReferencePack } from "@/lib/references/types";

// Remove a single bad reference: delete the asset row and drop it from the pack's
// selected list (and clear hero_asset_id if it was the hero).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { asset_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const assetId = Number(body.asset_id);
  if (!Number.isFinite(assetId)) {
    return NextResponse.json({ success: false, error: "asset_id is required." }, { status: 400 });
  }

  // Find the asset's reel so we can repair the pack after deletion.
  const { data: assetRow } = await supabaseServer
    .from("reference_assets").select("reel_id").eq("id", assetId).maybeSingle();
  const reelId = (assetRow as { reel_id: number | null } | null)?.reel_id ?? null;

  const { error: delErr } = await supabaseServer.from("reference_assets").delete().eq("id", assetId);
  if (delErr) return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });

  if (reelId != null) {
    const { data: packRow } = await supabaseServer
      .from("reel_reference_packs").select("*")
      .eq("reel_id", reelId).eq("superseded", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const pack = packRow as ReferencePack | null;
    if (pack) {
      await supabaseServer.from("reel_reference_packs").update({
        selected_asset_ids: (pack.selected_asset_ids ?? []).filter(id => id !== assetId),
        hero_asset_id: pack.hero_asset_id === assetId ? null : pack.hero_asset_id,
        updated_at: new Date().toISOString(),
      }).eq("id", pack.id);
    }
  }

  return NextResponse.json({ success: true });
}
