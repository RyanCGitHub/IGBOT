// Public surface of the media-generation module. Callers use getImageProvider()
// and never import a specific provider directly, so providers can be swapped here.

import { createOpenAIImageProvider } from "./openai";
import type { ImageProvider } from "./types";

export * from "./types";

// Single image provider for now. To add another (fal.ai, Replicate, Stability),
// branch on an env var here — callers don't change.
export function getImageProvider(): ImageProvider {
  return createOpenAIImageProvider();
}

// ─── Config / guardrails ────────────────────────────────────────────────────────

export const MEDIA_VIDEO_ENABLED = process.env.MEDIA_VIDEO_ENABLED === "true";

export const IMAGE_DAILY_CAP =
  Number(process.env.MEDIA_IMAGE_DAILY_CAP) > 0 ? Number(process.env.MEDIA_IMAGE_DAILY_CAP) : 20;

// ─── Video stub (Part 2.3) ──────────────────────────────────────────────────────
// Disabled until MEDIA_VIDEO_ENABLED is true AND a real provider is implemented.
// When built, video must respect Instagram Reels API requirements (MP4, container
// status polling) — not implemented here on purpose.
export async function generateVideo(): Promise<never> {
  throw new Error(
    "Video generation is not enabled. Set MEDIA_VIDEO_ENABLED=true once a video provider is implemented."
  );
}
