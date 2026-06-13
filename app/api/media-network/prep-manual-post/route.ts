import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { buildNewsPackage } from "@/lib/media-network/news-package";

// Manual-post lane: build the package + a silent 9:16 motion Reel, then park it
// in the Manual Queue (status "ready", manual_only). It is NOT scheduled or
// auto-published — the owner downloads the assets, finishes the Reel in the IG
// app (adding trending audio), and posts by hand.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { news_item_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const itemId = Number(body.news_item_id);
  if (!Number.isInteger(itemId) || itemId < 1) {
    return NextResponse.json({ success: false, error: "news_item_id is required." }, { status: 400 });
  }

  // The owner clicking "Music post" on the desk (after the sensitivity warning)
  // is explicit consent, so high-sensitivity items can be prepped for manual.
  const result = await buildNewsPackage(itemId, "image_headline_post", { mode: "manual", allowHighSensitivity: true });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, package: result.package, complianceNotes: result.complianceNotes });
}
