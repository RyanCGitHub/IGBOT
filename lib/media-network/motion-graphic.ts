// Silent 9:16 motion Reel for the manual-post lane. The owner uploads this in
// the Instagram app and adds a trending song there (the API can't attach IG's
// licensed audio). Built to dodge the ffmpeg-static Linux-filter trap: sharp
// renders the zoom frames (rock-solid), and ffmpeg ONLY encodes the image
// sequence with libx264 + format=yuv420p — both proven in the reels pipeline.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

const W = 1080;
const H = 1920;
const FPS = 24;
const SECONDS = 4;
const ZOOM_END = 1.06; // gentle push-in over the clip

function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found (ffmpeg-static returned null).");
  return ffmpegPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), ["-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 1500)}`)));
  });
}

// still: a 1080x1920 PNG/JPEG (a 9:16 headline graphic). Returns an mp4 buffer.
export async function renderMotionReel(still: Buffer): Promise<Buffer> {
  const totalFrames = FPS * SECONDS;
  const dir = await mkdtemp(join(tmpdir(), "mn-motion-"));
  try {
    // Pre-render every frame as a center zoom-in crop of the still.
    for (let i = 0; i < totalFrames; i++) {
      const t = totalFrames === 1 ? 0 : i / (totalFrames - 1);
      const zoom = 1 + (ZOOM_END - 1) * t;
      const zw = Math.round(W * zoom);
      const zh = Math.round(H * zoom);
      const left = Math.round((zw - W) / 2);
      const top = Math.round((zh - H) / 2);
      const frame = await sharp(still)
        .resize(zw, zh, { fit: "fill" })
        .extract({ left, top, width: W, height: H })
        .png()
        .toBuffer();
      await writeFile(join(dir, `f_${String(i).padStart(4, "0")}.png`), frame);
    }

    const outPath = join(dir, "out.mp4");
    await runFfmpeg([
      "-framerate", String(FPS),
      "-i", join(dir, "f_%04d.png"),
      "-vf", "format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-r", String(FPS),
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
