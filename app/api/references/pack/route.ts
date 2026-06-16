import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { providerStatus } from "@/lib/references/providers";
import type { ReferencePack, ReferenceAsset } from "@/lib/references/types";

// Current reference pack + its assets for a Reel (the latest non-superseded pack).
// Also reports which providers are configured so the UI can prompt for keys.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const reelId = Number(new URL(request.url).searchParams.get("reel_id"));
  if (!Number.isFinite(reelId)) {
    return NextResponse.json({ success: false, error: "reel_id is required." }, { status: 400 });
  }

  const { data: packRow } = await supabaseServer
    .from("reel_reference_packs").select("*")
    .eq("reel_id", reelId).eq("superseded", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const pack = (packRow as ReferencePack | null) ?? null;

  let assets: ReferenceAsset[] = [];
  if (pack) {
    const { data } = await supabaseServer
      .from("reference_assets").select("*")
      .eq("reel_id", reelId)
      .order("relevance_score", { ascending: false });
    assets = (data as ReferenceAsset[]) ?? [];
  }

  return NextResponse.json({ success: true, pack, assets, providers: providerStatus() });
}
