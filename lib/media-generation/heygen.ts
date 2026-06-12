// HeyGen v3 provider — animates a still image into a lip-synced talking video
// using our own audio (type:"image" + audio_url). This keeps the host's
// identity in OUR reference-derived keyframe and the voice in OUR TTS: HeyGen
// only contributes motion + lip sync, so the provider stays swappable.
//
// Dependency-free fetch, queue-style submit/poll like the fal provider. The
// API key is read from HEYGEN_API_KEY and never logged or returned.
// Endpoints verified against developers.heygen.com (v3) on 2026-06-12.

import type { VideoJobCheck } from "@/lib/media-generation/fal";
import { safeJson } from "@/lib/media-generation/http";

const HEYGEN_BASE = "https://api.heygen.com";

export function heygenEnabled(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY);
}

function heygenKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY is not set on the server.");
  return key;
}

type HeygenError = { error?: { message?: string; code?: string } | string; message?: string };

function heygenErrorMessage(data: HeygenError, status: number): string {
  const err = typeof data.error === "string" ? data.error : data.error?.message;
  return err || data.message || `HeyGen request failed (HTTP ${status}).`;
}

// ─── Submit: still image + audio → talking video ─────────────────────────────

export async function submitTalkingImage(params: {
  imageUrl: string;       // public URL of the host keyframe (identity + scene)
  audioUrl: string;       // public URL of the beat's voiceover mp3
  motionPrompt?: string;  // natural-language body motion (Avatar IV engine)
  title?: string;
}): Promise<{ videoId: string }> {
  const res = await fetch(`${HEYGEN_BASE}/v3/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": heygenKey(), // server-only, never logged
    },
    body: JSON.stringify({
      type: "image",
      image: { type: "url", url: params.imageUrl },
      audio_url: params.audioUrl,
      aspect_ratio: "9:16",
      resolution: "1080p",
      // Avatar IV engine (default) supports expressiveness on photo input.
      expressiveness: "medium",
      ...(params.motionPrompt ? { motion_prompt: params.motionPrompt } : {}),
      ...(params.title ? { title: params.title } : {}),
    }),
  });

  const data = await safeJson<{ data?: { video_id?: string }; video_id?: string } & HeygenError>(res, "HeyGen submit");
  const videoId = data.data?.video_id ?? data.video_id;
  if (!res.ok || !videoId) {
    throw new Error(`HeyGen video submit failed: ${heygenErrorMessage(data, res.status)}`);
  }
  return { videoId };
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function checkHeygenVideo(videoId: string): Promise<VideoJobCheck> {
  const res = await fetch(`${HEYGEN_BASE}/v3/videos/${videoId}`, {
    headers: { "x-api-key": heygenKey() },
  });

  const data = await safeJson<{
    data?: { status?: string; video_url?: string; error?: { message?: string } };
    status?: string;
    video_url?: string;
  } & HeygenError>(res, "HeyGen status");

  if (!res.ok) {
    // 4xx → unknown/expired id (terminal); 5xx → transient, retry next tick.
    if (res.status >= 400 && res.status < 500) {
      return { status: "failed", error: heygenErrorMessage(data, res.status) };
    }
    return { status: "pending" };
  }

  const status = data.data?.status ?? data.status;
  const videoUrl = data.data?.video_url ?? data.video_url;

  if (status === "completed") {
    if (!videoUrl) return { status: "failed", error: "HeyGen video completed but returned no video_url." };
    return { status: "done", videoUrl };
  }
  if (status === "failed") {
    return { status: "failed", error: data.data?.error?.message ?? "HeyGen video generation failed." };
  }
  // waiting | pending | processing
  return { status: "pending" };
}
