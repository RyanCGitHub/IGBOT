import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { REELS_BUCKET } from "@/lib/reels/storage";

// Signed upload URL for the Viral Checker — browser uploads the photo/reel
// straight to storage (videos exceed serverless body limits). The token only
// writes to the exact path we mint.
export const dynamic = "force-dynamic";

const EXTS = new Set(["jpg", "jpeg", "png", "webp", "mp4", "mov", "webm"]);

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { file_ext?: string };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const ext = EXTS.has(String(body.file_ext).toLowerCase()) ? String(body.file_ext).toLowerCase() : "jpg";
  const path = `viral-checker/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { data, error } = await supabaseServer.storage.from(REELS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? "Could not create upload URL." }, { status: 500 });
  }
  const { data: pub } = supabaseServer.storage.from(REELS_BUCKET).getPublicUrl(path);

  return NextResponse.json({ success: true, path, token: data.token, publicUrl: pub.publicUrl });
}
