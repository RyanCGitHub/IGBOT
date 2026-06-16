import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { discoverReferencePack } from "@/lib/references/pack";

// Discover (or regenerate) the reference pack for a Reel. Used by the "Auto-find
// references" and "Regenerate references" buttons. Supersedes any prior pack.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { reel_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const reelId = Number(body.reel_id);
  if (!Number.isFinite(reelId)) {
    return NextResponse.json({ success: false, error: "reel_id is required." }, { status: 400 });
  }

  try {
    const { pack, assets } = await discoverReferencePack(reelId);
    return NextResponse.json({ success: true, pack, assets });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
