import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

// ─── Global publishing kill switch ───────────────────────────────────────────
// REELS_PAUSED=true halts ALL automated publishing: the reels planner/tick and
// the scheduled-image-post processor. In-flight reel runs freeze at their
// current stage and resume when unpaused. Flip it in Vercel env settings —
// no deploy needed beyond the env update.

export function publishingPaused(): boolean {
  return process.env.REELS_PAUSED === "true";
}

export function pausedResponse(): NextResponse {
  return NextResponse.json({
    success: true,
    paused: true,
    message: "Publishing paused by REELS_PAUSED",
  });
}

// Auth for routes driven by both Vercel cron (Authorization: Bearer CRON_SECRET)
// and the dashboard (x-app-api-key). Mirrors the checks in process-scheduled +
// lib/auth so either caller can trigger pipeline work.
export function requireCronOrApiKey(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  // Vercel cron path: Authorization: Bearer CRON_SECRET (or x-cron-secret).
  if (cronSecret) {
    if (request.headers.get("authorization") === `Bearer ${cronSecret}`) return null;
    if (request.headers.get("x-cron-secret") === cronSecret) return null;
  }

  // Otherwise fall through to the dashboard/internal API-key check. requireApiKey
  // no-ops when no internal key is configured, so setting CRON_SECRET alone no
  // longer locks the dashboard's manual-trigger buttons out of cron routes.
  return requireApiKey(request);
}
