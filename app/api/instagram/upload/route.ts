import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { normalizeForInstagram } from "@/lib/image-normalize";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png"];

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Failed to parse form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided." }, { status: 400 });
  }

  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { success: false, error: `Unsupported file type: ${file.type}. Upload a JPEG or PNG.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: "Image must be 8 MB or smaller." }, { status: 400 });
  }

  let normalized: Awaited<ReturnType<typeof normalizeForInstagram>>;
  try {
    const inputBuffer: Buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));
    normalized = await normalizeForInstagram(inputBuffer, file.type);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[IG Upload] Normalization error:", msg);
    return NextResponse.json({ success: false, error: `Image processing failed: ${msg}` }, { status: 500 });
  }

  const { buffer, meta } = normalized;
  const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { data, error } = await supabaseServer.storage
    .from("instagram-media")
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

  if (error) {
    console.error("[IG Upload] Storage error:", error.message);
    return NextResponse.json(
      { success: false, error: `Storage upload failed: ${error.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = supabaseServer.storage
    .from("instagram-media")
    .getPublicUrl(data.path);

  console.log(
    `[IG Upload] ${meta.originalWidth}×${meta.originalHeight} (${meta.originalAspectRatio}) →`,
    `${meta.finalWidth}×${meta.finalHeight} (${meta.finalAspectRatio})`,
    `| shape: ${meta.targetShape}`,
    `| cropped: ${meta.wasCropped} | padded: ${meta.wasPadded} | converted: ${meta.wasConverted}`
  );

  return NextResponse.json({
    success: true,
    imageUrl: urlData.publicUrl,
    path: data.path,
    normalization: meta,
  });
}
