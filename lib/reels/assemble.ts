// Final-cut assembly with ffmpeg (ffmpeg-static binary, /tmp workspace).
//
// Input: per-beat clips already downloaded into our bucket, the brief (for
// subtitle text + timings), and optional music/voiceover buffers.
// Output: one 1080x1920 H.264/AAC MP4 that meets Instagram Reels specs
// (yuv420p, 30fps, faststart), uploaded back to the bucket.
//
// Each clip is normalized in its own ffmpeg pass (scale/crop/trim/fade), then
// concatenated, then a single final pass composites subtitles and mixes audio.
// Subtitles are pre-rendered PNGs (lib/reels/subtitles — the production ffmpeg
// build has no drawtext) composited with the core `overlay` filter.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { renderSubtitlePng } from "@/lib/reels/subtitles";
import type { ReelBeat } from "@/lib/reels/types";

const FADE_S = 0.25;
const FFMPEG_TIMEOUT_MS = 5 * 60_000; // per invocation

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
const REQUIRED_FILTERS = ["overlay", "adelay", "afade", "amix", "apad", "anull", "scale", "crop", "fps", "fade", "format"];

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

// V12: captions render as sequential 2–4 word chunks across the beat window
// (karaoke-adjacent without word-level audio timing).
function chunkSubtitle(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(" "));
  // Avoid a lonely one-word final chunk — fold it into the previous (max 4 words).
  if (chunks.length > 1 && !chunks[chunks.length - 1].includes(" ")) {
    const last = chunks.pop() as string;
    chunks[chunks.length - 1] += ` ${last}`;
  }
  return chunks;
}

// Parses "Duration: HH:MM:SS.cc" from ffmpeg -i stderr (exits non-zero by
// design when no output is given — we only want the probe line).
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
    // ── 1. Normalize every clip: 1080x1920, 30fps, trimmed + fades ─────────────
    // Avatar clips (HeyGen) run exactly as long as their spoken audio — trim to
    // the ACTUAL clip length (capped) instead of the brief's estimate, so words
    // are never cut mid-sentence. B-roll trims to the brief duration as before.
    const normalized: { file: string; duration: number }[] = [];
    for (const clip of input.clips) {
      const beat = input.beats[clip.beatIndex];
      const briefDuration = Math.min(Math.max(beat?.duration_s ?? 5, 3), 8);
      const inFile = path.join(work, `in-${clip.beatIndex}.mp4`);
      const outFile = path.join(work, `norm-${clip.beatIndex}.mp4`);
      await writeFile(inFile, clip.buffer);

      let duration = briefDuration;
      if (beat?.shot_type === "avatar") {
        const actual = await probeDuration(inFile);
        if (actual && actual > 1) {
          duration = Math.min(Math.max(actual - 0.05, 2), briefDuration + 2.5, 10);
        }
      }

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

    // ── 3. Composite subtitle PNGs + mix audio in one final pass ───────────────
    // Subtitle PNG inputs come right after the video (indexes 1..N), each
    // composited with the core overlay filter on its beat's time window.
    const args: string[] = ["-y", "-i", silentFile];
    const filterParts: string[] = [];
    let inputIdx = 1;

    // V11: caption block sits at ~58% frame height — inside Meta's unified 9:16
    // safe zone (out of the top 270px and the bottom ~670px of 1920).
    let t = 0;
    const subWindows: { idx: number; start: number; end: number }[] = [];
    for (let i = 0; i < normalized.length; i++) {
      const beat = input.beats[i];
      const start = t;
      const end = t + normalized[i].duration;
      t = end;
      if (!beat?.subtitle) continue;
      const chunks = chunkSubtitle(sanitizeSubtitle(beat.subtitle));
      if (chunks.length === 0) continue;
      const span = (end - start) / chunks.length;
      for (let c = 0; c < chunks.length; c++) {
        const { png } = await renderSubtitlePng(chunks[c]);
        const subFile = path.join(work, `sub-${i}-${c}.png`);
        await writeFile(subFile, png);
        args.push("-i", subFile);
        subWindows.push({
          idx: inputIdx++,
          start: start + c * span,
          end: start + (c + 1) * span,
        });
      }
    }

    let prevLabel = "[0:v]";
    subWindows.forEach((sub, k) => {
      const out = `[ov${k}]`;
      filterParts.push(
        `${prevLabel}[${sub.idx}:v]overlay=(W-w)/2:H*0.58:` +
        `enable='between(t,${sub.start.toFixed(2)},${(sub.end - 0.05).toFixed(2)})'${out}`
      );
      prevLabel = out;
    });
    // overlay can promote the pixel format — pin yuv420p on the way out.
    filterParts.push(`${prevLabel}format=yuv420p[v]`);

    let audioMap: string | null = null;

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
