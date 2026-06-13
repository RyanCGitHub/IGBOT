// Clip Studio — turns a raw uploaded clip into a produced clip-page reel:
// branded 1080x1920 canvas, the clip centered, title overlay up top, credit
// burned in at the bottom, and (when a transcript exists) sequential caption
// chunks. Uses ONLY production-verified ffmpeg filters (scale/overlay/fps/
// format) — text and backgrounds are pre-rendered PNGs via sharp/opentype,
// the same machinery as the Finn pipeline.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { renderSubtitlePng, loadFont, glyphLinePath } from "@/lib/reels/subtitles";

const W = 1080;
const H = 1920;
const FFMPEG_TIMEOUT_MS = 4 * 60_000;

function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found.");
  return ffmpegPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), ["-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += String(d); });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("ffmpeg timed out")); }, FFMPEG_TIMEOUT_MS);
    proc.on("error", e => { clearTimeout(timer); reject(e); });
    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)} … ${stderr.slice(-200)}`));
    });
  });
}

function probeDuration(file: string): Promise<number | null> {
  return new Promise(resolve => {
    const proc = spawn(ffmpegBin(), ["-hide_banner", "-i", file]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += String(d); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

async function brandCanvas(brandName: string): Promise<Buffer> {
  const font = await loadFont();
  const wm = glyphLinePath(font, brandName.toUpperCase(), 1880, 30);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#101a2e"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path transform="translate(${(W - wm.width) / 2},0)" d="${wm.d}" fill="#475569"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function smallTextPng(text: string, fontSize: number, color: string): Promise<Buffer> {
  const font = await loadFont();
  const line = glyphLinePath(font, text, fontSize + 8, fontSize);
  const w = Math.ceil(line.width) + 24;
  const h = fontSize + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <path transform="translate(12,0)" d="${line.d}" fill="none" stroke="#000000" stroke-opacity="0.8" stroke-width="5" stroke-linejoin="round"/>
    <path transform="translate(12,0)" d="${line.d}" fill="${color}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function chunkTranscript(transcript: string): string[] {
  const words = transcript.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(" "));
  return chunks.slice(0, 120); // sanity cap
}

export async function processClipReel(params: {
  clipBuffer: Buffer;
  brandName: string;
  titleText: string | null;     // on_screen_text
  creditText: string;
  transcript: string | null;
}): Promise<Buffer> {
  const work = await mkdtemp(path.join(tmpdir(), "studio-"));
  try {
    const clipFile = path.join(work, "clip.mp4");
    await writeFile(clipFile, params.clipBuffer);
    const duration = (await probeDuration(clipFile)) ?? 30;

    const bgFile = path.join(work, "bg.png");
    await writeFile(bgFile, await brandCanvas(params.brandName));

    const args: string[] = ["-y", "-loop", "1", "-i", bgFile, "-i", clipFile];
    let inputIdx = 2;
    const filters: string[] = [
      // Clip scaled to full width, centered vertically on the brand canvas.
      `[1:v]scale=${W}:-2,fps=30[clip]`,
      `[0:v][clip]overlay=(W-w)/2:(H-h)/2[v0]`,
    ];
    let prev = "[v0]";

    if (params.titleText?.trim()) {
      const { png } = await renderSubtitlePng(params.titleText.trim().slice(0, 60));
      const f = path.join(work, "title.png");
      await writeFile(f, png);
      args.push("-i", f);
      filters.push(`${prev}[${inputIdx}:v]overlay=(W-w)/2:170[vt]`);
      prev = "[vt]";
      inputIdx++;
    }

    {
      const credit = await smallTextPng(params.creditText.slice(0, 70), 30, "#cbd5e1");
      const f = path.join(work, "credit.png");
      await writeFile(f, credit);
      args.push("-i", f);
      filters.push(`${prev}[${inputIdx}:v]overlay=(W-w)/2:H-150[vc]`);
      prev = "[vc]";
      inputIdx++;
    }

    if (params.transcript?.trim()) {
      // No word-level timing exists — distribute chunks evenly (approximate,
      // but the clip-page caption rhythm reads fine at 3 words/chunk).
      const chunks = chunkTranscript(params.transcript);
      const span = duration / chunks.length;
      for (let c = 0; c < chunks.length; c++) {
        const { png } = await renderSubtitlePng(chunks[c]);
        const f = path.join(work, `sub-${c}.png`);
        await writeFile(f, png);
        args.push("-i", f);
        filters.push(
          `${prev}[${inputIdx}:v]overlay=(W-w)/2:H*0.70:enable='between(t,${(c * span).toFixed(2)},${((c + 1) * span - 0.05).toFixed(2)})'[vs${c}]`
        );
        prev = `[vs${c}]`;
        inputIdx++;
      }
    }

    filters.push(`${prev}format=yuv420p[v]`);

    const outFile = path.join(work, "out.mp4");
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "1:a?",
      "-t", duration.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-movflags", "+faststart",
      outFile
    );
    await runFfmpeg(args);
    return await readFile(outFile);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
