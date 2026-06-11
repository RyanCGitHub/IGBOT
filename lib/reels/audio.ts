// Soundtrack + voiceover sources for assembled reels.
//
// RIGHTS NOTE (deliberate limitation): Instagram's licensed/"trending" audio
// library CANNOT be attached via the Content Publishing API, and scraping it
// would be a copyright/ToS violation. Music here comes only from:
//   1. the audio_tracks table — royalty-free files the owner uploaded, or
//   2. AI-generated original instrumentals (fal.ai stable-audio), or
//   3. nothing (silent bed under the voiceover).
// Reels published through the API always show as "Original audio".

import { supabaseServer } from "@/lib/supabase-server";
import { generateMusic } from "@/lib/media-generation/fal";
import { downloadFromBucket } from "@/lib/reels/storage";
import type { AudioTrack } from "@/lib/reels/types";

export type MusicResult =
  | { source: "library"; buffer: Buffer; trackId: number }
  | { source: "generated"; buffer: Buffer }
  | { source: "none" };

// REELS_MUSIC_MODE: "library" (library only), "generated" (generated only),
// "auto" (library first, generated fallback — default), "none".
function musicMode(): string {
  return process.env.REELS_MUSIC_MODE || "auto";
}

async function pickLibraryTrack(mood: string): Promise<AudioTrack | null> {
  // Prefer a mood match; fall back to any active track. Random-ish rotation
  // by created_at avoids using the same track on every reel.
  const { data: moodMatches } = await supabaseServer
    .from("audio_tracks")
    .select("*")
    .eq("active", true)
    .eq("mood", mood);

  const pool = (moodMatches as AudioTrack[] | null) ?? [];
  if (pool.length === 0) {
    const { data: anyActive } = await supabaseServer.from("audio_tracks").select("*").eq("active", true);
    pool.push(...((anyActive as AudioTrack[] | null) ?? []));
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function resolveMusic(mood: string, durationS: number): Promise<MusicResult> {
  const mode = musicMode();
  if (mode === "none") return { source: "none" };

  if (mode === "library" || mode === "auto") {
    const track = await pickLibraryTrack(mood);
    if (track) {
      const buffer = await downloadFromBucket(track.storage_path);
      return { source: "library", buffer, trackId: track.id };
    }
    if (mode === "library") return { source: "none" };
  }

  // generated | auto-fallback
  try {
    const { buffer } = await generateMusic({ mood, durationS });
    return { source: "generated", buffer };
  } catch (e) {
    // Music is enhancement, not a hard dependency — a silent reel still ships.
    console.warn("[reels/audio] music generation failed, continuing without music:", e instanceof Error ? e.message : e);
    return { source: "none" };
  }
}

// ─── Voiceover (OpenAI TTS — generated speech, rights-safe) ──────────────────

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

export function voiceoverEnabled(): boolean {
  return process.env.REELS_VOICEOVER_ENABLED !== "false";
}

export async function synthesizeVoiceover(script: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set on the server.");

  const res = await fetch(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`, // server-only, never logged
    },
    body: JSON.stringify({
      model: process.env.REELS_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.REELS_TTS_VOICE || "alloy",
      input: script,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      detail = data.error?.message ?? detail;
    } catch { /* non-JSON error body */ }
    throw new Error(`Voiceover synthesis failed: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
