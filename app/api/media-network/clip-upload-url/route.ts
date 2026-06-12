import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { REELS_BUCKET } from "@/lib/reels/storage";

// Issues a signed upload URL so the browser uploads clip video DIRECTLY to
// Supabase storage — video files exceed serverless request-body limits, so
// the server never proxies the bytes. The signed token expires quickly and
// only writes to the exact path we mint here.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { media_brand_id?: number; file_ext?: string };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const brandId = Number(body.media_brand_id);
  if (!Number.isInteger(brandId) || brandId < 1) {
    return NextResponse.json({ success: false, error: "media_brand_id is required." }, { status: 400 });
  }

  const ext = ["mp4", "mov", "webm"].includes(String(body.file_ext)) ? String(body.file_ext) : "mp4";
  const path = `media-network/clips/${brandId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { data, error } = await supabaseServer.storage.from(REELS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? "Could not create upload URL." }, { status: 500 });
  }

  const { data: pub } = supabaseServer.storage.from(REELS_BUCKET).getPublicUrl(path);

  return NextResponse.json({
    success: true,
    path,
    token: data.token,
    publicUrl: pub.publicUrl,
  });
}
