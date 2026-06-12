// Final-cut assembly with ffmpeg (ffmpeg-static binary, /tmp workspace).
//
// Input: per-beat clips already downloaded into our bucket, the brief (for
// subtitle text + timings), and optional music/voiceover buffers.
// Output: one 1080x1920 H.264/AAC MP4 that meets Instagram Reels specs
// (yuv420p, 30fps, faststart), uploaded back to the bucket.
//
// Each clip is normalized in its own ffmpeg pass (scale/crop/trim/fade), then
// concatenated, then a single final pass burns subtitles and mixes audio.
// Subtitles use drawtext with a bundled font (assets/fonts) because serverless
// images have no system fonts/fontconfig.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { ReelBeat } from "@/lib/reels/types";

const FADE_S = 0.25;
const FFMPEG_TIMEOUT_MS = 5 * 60_000; // per invocation

async function fontFile(): Promise<string> {
  const p = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
  await access(p); // fail loudly if file tracing dropped the font
  return p;
}

function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found (ffmpeg-static returned null).");
  return ffmpegPath;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), ["-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += String(d); });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);

    proc.on("error", e => { clearTimeout(timer); reject(e); });
    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        // Full stderr to runtime logs — the decisive line ("No such filter:
        // 'x'") is at the HEAD, which a tail-only message would drop.
        console.error(`[reels/assemble] ffmpeg exited ${code}. stderr:\n${stderr.slice(0, 4000)}`);
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)} … ${stderr.slice(-300)}`));
      }
    });
  });
}

// Logs which of the filters we rely on are missing from this binary's
// registry. Runs once per assembly — cheap, and decisive when builds differ
// per platform (the linux ffmpeg-static build has bitten us already).
const REQUIRED_FILTERS = ["drawtext", "adelay", "afade", "amix", "apad", "anull", "null", "scale", "crop", "fps", "fade", "format", "concat"];

async function logMissingFilters(): Promise<void> {
  try {
    const list = await new Promise<string>((resolve, reject) => {
      const proc = spawn(ffmpegBin(), ["-hide_banner", "-filters"]);
      let out = "";
      proc.stdout.on("data", d => { out += String(d); });
      proc.on("error", reject);
      proc.on("close", () => resolve(out));
    });
    const missing = REQUIRED_FILTERS.filter(f => !new RegExp(`\\s${f}\\s`).test(list));
    if (missing.length > 0) {
      console.error(`[reels/assemble] MISSING FILTERS in this ffmpeg build: ${missing.join(", ")}`);
    }
  } catch (e) {
    console.error("[reels/assemble] could not enumerate filters:", e instanceof Error ? e.message : e);
  }
}

// Subtitles go through textfile= (not inline text=) so the filter parser never
// sees the content — no escaping bugs, and real newlines work as line breaks.
function sanitizeSubtitle(text: string): string {
  return text.replace(/[^\w .,!?'’\-&%:;#]/g, "").trim().slice(0, 70);
}

// Wrap to two centered lines max so 60-char hooks stay readable at 1080w.
function wrapSubtitle(text: string): string {
  if (text.length <= 32) return text;
  const words = text.split(" ");
  let line1 = "";
  for (const w of words) {
    if ((line1 + " " + w).trim().length > Math.ceil(text.length / 2)) break;
    line1 = (line1 + " " + w).trim();
  }
  const line2 = text.slice(line1.length).trim();
  return line2 ? `${line1}\n${line2}` : line1;
}

export type AssembleInput = {
  clips: { beatIndex: number; buffer: Buffer }[]; // ordered by beatIndex
  beats: ReelBeat[];
  music: Buffer | null;
  // Voiceover segments placed at their beat's offset in the timeline. A single
  // full-length narration is just one entry at beatIndex 0. For lip-synced
  // avatar beats this must be the same audio the lip-sync ran against.
  voiceovers: { beatIndex: number; buffer: Buffer }[];
};

export async function assembleReel(input: AssembleInput): Promise<Buffer> {
  if (input.clips.length === 0) throw new Error("No clips to assemble.");
  await logMissingFilters();
  const work = await mkdtemp(path.join(tmpdir(), "reel-"));

  try {
    // ── 1. Normalize every clip: 1080x1920, 30fps, exact beat duration, fades ──
    const normalized: { file: string; duration: number }[] = [];
    for (const clip of input.clips) {
      const beat = input.beats[clip.beatIndex];
      const duration = Math.min(Math.max(beat?.duration_s ?? 5, 3), 6);
      const inFile = path.join(work, `in-${clip.beatIndex}.mp4`);
      const outFile = path.join(work, `norm-${clip.beatIndex}.mp4`);
      await writeFile(inFile, clip.buffer);

      const fadeOutStart = Math.max(duration - FADE_S, 0);
      await runFfmpeg([
        "-y", "-i", inFile,
        "-vf",
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,` +
        `fade=t=in:st=0:d=${FADE_S},fade=t=out:st=${fadeOutStart}:d=${FADE_S},format=yuv420p`,
        "-t", String(duration),
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        outFile,
      ]);
      normalized.push({ file: outFile, duration });
    }

    // ── 2. Concat (codec-identical inputs → stream copy) ───────────────────────
    const listFile = path.join(work, "list.txt");
    await writeFile(listFile, normalized.map(n => `file '${n.file}'`).join("\n"));
    const silentFile = path.join(work, "silent.mp4");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silentFile]);

    const totalDuration = normalized.reduce((s, n) => s + n.duration, 0);

    // ── 3. Burn subtitles + mix audio in one final pass ────────────────────────
    const font = await fontFile();
    let t = 0;
    const drawtexts: string[] = [];
    for (let i = 0; i < normalized.length; i++) {
      const beat = input.beats[i];
      const start = t;
      const end = t + normalized[i].duration;
      t = end;
      if (!beat?.subtitle) continue;
      const text = wrapSubtitle(sanitizeSubtitle(beat.subtitle));
      if (!text) continue;
      const subFile = path.join(work, `sub-${i}.txt`);
      await writeFile(subFile, text);
      drawtexts.push(
        // expansion=none: render the file verbatim (no %{...} expansion, stray % is safe)
        `drawtext=fontfile=${font}:textfile=${subFile}:expansion=none:fontsize=58:fontcolor=white:` +
        `borderw=4:bordercolor=black@0.85:line_spacing=10:` +
        `x=(w-text_w)/2:y=h*0.74:enable='between(t,${start.toFixed(2)},${(end - 0.05).toFixed(2)})'`
      );
    }
    const videoChain = drawtexts.length > 0 ? drawtexts.join(",") : "null";

    const args: string[] = ["-y", "-i", silentFile];
    const filterParts: string[] = [`[0:v]${videoChain}[v]`];
    let audioMap: string | null = null;
    let inputIdx = 1;

    let musicIdx = -1;
    if (input.music) {
      const musicFile = path.join(work, "music.audio");
      await writeFile(musicFile, input.music);
      args.push("-stream_loop", "-1", "-i", musicFile); // loop if shorter than video
      musicIdx = inputIdx++;
    }

    // Beat start offsets in the concatenated timeline (clip order = beat order).
    const offsetByBeat = new Map<number, number>();
    {
      let acc = 0;
      for (let i = 0; i < input.clips.length; i++) {
        offsetByBeat.set(input.clips[i].beatIndex, acc);
        acc += normalized[i].duration;
      }
    }

    // NOTE: the `volume` filter is deliberately never used — the ffmpeg-static
    // LINUX build ships without it (the darwin build has it, so local tests
    // pass either way). Gain staging is done via amix `weights` instead.
    const voLabels: string[] = [];
    for (let k = 0; k < input.voiceovers.length; k++) {
      const vo = input.voiceovers[k];
      const voFile = path.join(work, `vo-${vo.beatIndex}.mp3`);
      await writeFile(voFile, vo.buffer);
      args.push("-i", voFile);
      const idx = inputIdx++;
      const delayMs = Math.round((offsetByBeat.get(vo.beatIndex) ?? 0) * 1000);
      filterParts.push(`[${idx}:a]adelay=${delayMs}:all=1[vo${k}]`);
      voLabels.push(`[vo${k}]`);
    }

    const fadeOut = `afade=t=out:st=${Math.max(totalDuration - 1, 0).toFixed(2)}:d=1`;
    if (musicIdx >= 0 && voLabels.length > 0) {
      // Music ducked to 0.22 under speech via amix weights (music is the first
      // input); normalize=0 keeps voices at full level instead of 1/N.
      const weights = ["0.22", ...voLabels.map(() => "1")].join(" ");
      filterParts.push(
        `[${musicIdx}:a]${fadeOut}[m]`,
        `[m]${voLabels.join("")}amix=inputs=${voLabels.length + 1}:duration=longest:dropout_transition=0:normalize=0:weights='${weights}'[a]`
      );
      audioMap = "[a]";
    } else if (musicIdx >= 0) {
      // Solo music slightly tamed via single-input amix weight.
      filterParts.push(`[${musicIdx}:a]${fadeOut},amix=inputs=1:normalize=0:weights='0.9'[a]`);
      audioMap = "[a]";
    } else if (voLabels.length > 0) {
      filterParts.push(
        voLabels.length === 1
          ? `${voLabels[0]}apad[a]`
          : `${voLabels.join("")}amix=inputs=${voLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad[a]`
      );
      audioMap = "[a]";
    } else {
      // Instagram is happiest with an audio stream present — add silence.
      args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
      filterParts.push(`[${inputIdx}:a]anull[a]`);
      audioMap = "[a]";
      inputIdx++;
    }

    const outFile = path.join(work, "final.mp4");
    args.push(
      "-filter_complex", filterParts.join(";"),
      "-map", "[v]", "-map", audioMap,
      "-t", totalDuration.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
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
