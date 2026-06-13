import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { downloadFromBucket, uploadToBucket } from "@/lib/reels/storage";
import { processClipReel } from "@/lib/media-network/clip-studio";
import type { ContentPackage, ClipAsset, MediaBrand } from "@/lib/media-network/types";

// Clip Studio endpoint: replaces a clip package's raw upload with the
// produced version (brand canvas, title, credit, transcript captions).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { package_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const pkgId = Number(body.package_id);
  if (!Number.isInteger(pkgId) || pkgId < 1) {
    return NextResponse.json({ success: false, error: "package_id is required." }, { status: 400 });
  }

  const { data: pkg } = await supabaseServer.from("content_packages").select("*").eq("id", pkgId).single<ContentPackage>();
  if (!pkg) return NextResponse.json({ success: false, error: "Package not found." }, { status: 404 });
  if (pkg.package_family !== "streamer_clips") {
    return NextResponse.json({ success: false, error: "Studio processing applies to clip packages." }, { status: 400 });
  }
  if (pkg.processed_media_path?.includes("/studio/")) {
    return NextResponse.json({ success: false, error: "Package already studio-processed." }, { status: 400 });
  }
  if (!pkg.processed_media_path) {
    return NextResponse.json({ success: false, error: "Package has no media." }, { status: 400 });
  }

  const { data: brand } = await supabaseServer.from("media_brands").select("*").eq("id", pkg.media_brand_id).single<MediaBrand>();
  let transcript: string | null = null;
  if (pkg.source_clip_asset_id) {
    const { data: clip } = await supabaseServer.from("clip_assets").select("transcript").eq("id", pkg.source_clip_asset_id).single<Pick<ClipAsset, "transcript">>();
    transcript = clip?.transcript ?? null;
  }

  try {
    const raw = await downloadFromBucket(pkg.processed_media_path);
    const produced = await processClipReel({
      clipBuffer: raw,
      brandName: brand?.brand_name ?? "CLIPS",
      titleText: pkg.on_screen_text,
      creditText: pkg.source_credit_text,
      transcript,
    });
    const upload = await uploadToBucket(`media-network/studio/${pkg.media_brand_id}/pkg-${pkg.id}.mp4`, produced, "video/mp4");

    const { data: updated, error: updErr } = await supabaseServer
      .from("content_packages")
      .update({ processed_media_path: upload.path, updated_at: new Date().toISOString() })
      .eq("id", pkg.id)
      .select("*")
      .single();
    if (updErr || !updated) throw new Error(updErr?.message ?? "Failed to save processed path.");

    return NextResponse.json({ success: true, package: updated, mediaUrl: upload.publicUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: `Studio processing failed: ${msg}` }, { status: 500 });
  }
}
