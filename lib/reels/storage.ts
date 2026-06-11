// Storage helpers for the reel pipeline — everything lives in the existing
// public bucket so Instagram can fetch videos by URL, same as images today.

import { supabaseServer } from "@/lib/supabase-server";

export const REELS_BUCKET = "instagram-media";

export async function uploadToBucket(
  path: string,
  body: Buffer,
  contentType: string
): Promise<{ path: string; publicUrl: string }> {
  const { data, error } = await supabaseServer.storage
    .from(REELS_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error || !data) throw new Error(`Storage upload failed (${path}): ${error?.message ?? "unknown"}`);

  const { data: urlData } = supabaseServer.storage.from(REELS_BUCKET).getPublicUrl(data.path);
  return { path: data.path, publicUrl: urlData.publicUrl };
}

export function publicUrlFor(path: string): string {
  return supabaseServer.storage.from(REELS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function downloadFromBucket(path: string): Promise<Buffer> {
  const { data, error } = await supabaseServer.storage.from(REELS_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed (${path}): ${error?.message ?? "unknown"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function fetchToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url.split("?")[0]}`);
  return Buffer.from(await res.arrayBuffer());
}
