import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — Instagram Graph API limit

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

  if (!["image/jpeg", "image/jpg"].includes(file.type)) {
    return NextResponse.json(
      { success: false, error: "Only JPEG images are supported by the Instagram Graph API." },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "Image must be 8 MB or smaller." },
      { status: 400 }
    );
  }

  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { data, error } = await supabaseServer.storage
    .from("instagram-media")
    .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

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

  console.log("[IG Upload] Uploaded:", urlData.publicUrl);

  return NextResponse.json({ success: true, imageUrl: urlData.publicUrl, path: data.path });
}
