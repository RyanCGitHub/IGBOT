import sharp from "sharp";

// Media validation — nothing publishes without a real visual. Catches missing
// media, broken/unreachable URLs, non-image files, and (for headline graphics)
// blank/near-empty photo regions.

// True if the top region (where a subject photo should be) has real visual
// content. A blank/black background has ~0 variance; a real photo has plenty.
export async function hasVisiblePhoto(jpeg: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(jpeg).metadata();
    const w = meta.width ?? 1080;
    const h = meta.height ?? 1350;
    const region = await sharp(jpeg)
      .extract({ left: 0, top: 0, width: w, height: Math.max(1, Math.round(h * 0.32)) })
      .stats();
    const maxStd = Math.max(...region.channels.map(c => c.stdev));
    return maxStd >= 12; // near-uniform → no real photo behind the text
  } catch {
    return true; // analysis failed → don't false-block
  }
}

export type MediaVerdict = { ok: true } | { ok: false; reason: string };

// The publish-time gate: a post must have valid, reachable, decodable media of
// the right kind. Reels need a video; everything else needs a real image.
export async function validatePublishMedia(opts: {
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl?: string | null;
}): Promise<MediaVerdict> {
  const isReel = opts.mediaType === "reel";

  if (isReel) {
    if (!opts.videoUrl?.trim()) return { ok: false, reason: "This Reel needs a video before it can be published." };
    return { ok: true };
  }

  if (!opts.imageUrl?.trim()) return { ok: false, reason: "This post needs an image or video before it can be published." };
  try {
    const res = await fetch(opts.imageUrl);
    if (!res.ok) return { ok: false, reason: `Image isn't reachable (HTTP ${res.status}) — it can't be published.` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) return { ok: false, reason: "Image file is empty or a placeholder — it can't be published." };
    await sharp(buf).metadata(); // throws on non-image / corrupt
  } catch (e) {
    return { ok: false, reason: `Image is broken or not a valid file — it can't be published. (${e instanceof Error ? e.message : "unknown"})` };
  }
  return { ok: true };
}
