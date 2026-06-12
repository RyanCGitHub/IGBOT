// Per-reel cost guard. The owner approved up to REELS_MAX_COST_USD (default
// $12) per finished reel; anything estimated above that fails the run BEFORE
// any paid generation happens, so the cap can only be exceeded by explicit
// env change (manual approval).
//
// Rates are conservative (rounded UP) per provider pricing pages, June 2026:
//   HeyGen Avatar IV  $0.05/s (developers.heygen.com/docs/pricing)
//   Kling std i2v     $0.0562/s (fal.ai)
//   gpt-image-1       ~$0.07/keyframe at 1024x1536
//   sync-lipsync      ~$0.05/s (fallback path only)
//   TTS + music       cents — folded into FIXED_OVERHEAD

import type { ReelBrief } from "@/lib/reels/types";

const RATE_HEYGEN_PER_S = 0.05;
const RATE_KLING_PER_S = 0.08; // v2.5-turbo pro ($0.07/s, rounded up)
const RATE_LIPSYNC_PER_S = 0.05;
const RATE_IMAGE = 0.07;
const FIXED_OVERHEAD = 0.25; // TTS, music, storage egress

export function maxCostUsd(): number {
  const v = Number(process.env.REELS_MAX_COST_USD);
  return Number.isFinite(v) && v > 0 ? v : 12;
}

export type CostEstimate = {
  totalUsd: number;
  breakdown: Record<string, number>;
  withinBudget: boolean;
  capUsd: number;
};

// Worst-case estimate: assumes the HeyGen path for avatar beats AND prices the
// Kling+lipsync fallback for one avatar beat (retries happen), plus one full
// regeneration of the longest beat.
export function estimateRunCost(brief: ReelBrief): CostEstimate {
  const beats = brief.beats ?? [];
  const avatarS = beats.filter(b => b.shot_type === "avatar").reduce((s, b) => s + b.duration_s, 0);
  const brollS = beats.filter(b => b.shot_type !== "avatar").reduce((s, b) => s + b.duration_s, 0);
  const maxBeatS = Math.max(0, ...beats.map(b => b.duration_s));

  const breakdown: Record<string, number> = {
    keyframes: beats.length * RATE_IMAGE,
    host_heygen: avatarS * RATE_HEYGEN_PER_S,
    broll_kling: brollS * RATE_KLING_PER_S,
    retry_headroom: maxBeatS * (RATE_KLING_PER_S + RATE_LIPSYNC_PER_S) + RATE_IMAGE,
    overhead: FIXED_OVERHEAD,
  };

  const totalUsd = Number(Object.values(breakdown).reduce((s, v) => s + v, 0).toFixed(2));
  const capUsd = maxCostUsd();
  return { totalUsd, breakdown, withinBudget: totalUsd <= capUsd, capUsd };
}
