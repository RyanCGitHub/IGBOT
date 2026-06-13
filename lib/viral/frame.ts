// Pulls a representative frame from an uploaded reel so the scorer has a visual
// to judge. Best-effort: returns null on any failure (the scorer then judges
// visuals from context with lower confidence). Uses the same ffmpeg-static
// binary + safe flags as the reels pipeline.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { downloadFromBucket } from "@/lib/reels/storage";

export async function extractReelFrame(path: string): Promise<Buffer | null> {
  if (!ffmpegPath) return null;
  let dir: string | null = null;
  try {
    const video = await downloadFromBucket(path);
    dir = await mkdtemp(join(tmpdir(), "vc-frame-"));
    const inPath = join(dir, "in.bin");
    const outPath = join(dir, "frame.jpg");
    await writeFile(inPath, video);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        "-hide_banner", "-loglevel", "error",
        "-ss", "1", "-i", inPath, "-frames:v", "1", "-q:v", "3", outPath,
      ]);
      proc.on("error", reject);
      proc.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });

    const raw = await readFile(outPath);
    return await sharp(raw).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// A photo for analysis: downsize to keep vision tokens sane.
export async function prepImage(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}
