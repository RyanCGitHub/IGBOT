// fal.ai provider — image-to-video (queue API) and generated music (sync API).
// Dependency-free fetch, mirroring the OpenAI image provider. The key is read
// from the environment and never logged or returned.
//
// Video uses the queue API because clips take minutes: submit returns a
// request_id stored on the reel run, and a later tick polls for the result.

const FAL_QUEUE_URL = "https://queue.fal.run";
const FAL_SYNC_URL = "https://fal.run";

// v2.5 Turbo Pro: notably better motion fluidity and physics realism than the
// v2.1 standard tier (~$0.07/s vs ~$0.056/s) — verified model id on fal.
const DEFAULT_VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const DEFAULT_MUSIC_MODEL = "fal-ai/stable-audio";

function falKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set on the server.");
  return key;
}

export function getFalVideoModel(): string {
  return process.env.FAL_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
}

// Queue requests are tracked under the app id (first two path segments), not
// the full model path: queue.fal.run/fal-ai/kling-video/requests/{id}/status
function appId(model: string): string {
  return model.split("/").slice(0, 2).join("/");
}

type FalError = { detail?: unknown; error?: unknown };

function falErrorMessage(data: FalError, status: number): string {
  const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data.error ?? null);
  return detail && detail !== "null" ? detail : `fal.ai request failed (HTTP ${status}).`;
}

// ─── Image-to-video (queue) ──────────────────────────────────────────────────

export async function submitImageToVideo(params: {
  prompt: string;
  imageUrl: string;
  durationS: number;
}): Promise<{ requestId: string }> {
  const model = getFalVideoModel();
  // Kling accepts duration "5" | "10"; clamp beats to the nearest tier.
  const duration = params.durationS > 5 ? "10" : "5";

  const res = await fetch(`${FAL_QUEUE_URL}/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${falKey()}`, // server-only, never logged
    },
    body: JSON.stringify({
      prompt: params.prompt,
      image_url: params.imageUrl,
      duration,
      aspect_ratio: "9:16",
    }),
  });

  const data = (await res.json()) as { request_id?: string } & FalError;
  if (!res.ok || !data.request_id) {
    throw new Error(`Video job submit failed: ${falErrorMessage(data, res.status)}`);
  }
  return { requestId: data.request_id };
}

export type VideoJobCheck =
  | { status: "pending" }
  | { status: "done"; videoUrl: string }
  | { status: "failed"; error: string };

export async function checkVideoJob(requestId: string): Promise<VideoJobCheck> {
  const base = `${FAL_QUEUE_URL}/${appId(getFalVideoModel())}/requests/${requestId}`;
  const headers = { Authorization: `Key ${falKey()}` };

  const statusRes = await fetch(`${base}/status`, { headers });
  const statusData = (await statusRes.json()) as { status?: string } & FalError;

  if (!statusRes.ok) {
    // 4xx on status means the request id is unknown/expired → terminal failure.
    if (statusRes.status >= 400 && statusRes.status < 500) {
      return { status: "failed", error: falErrorMessage(statusData, statusRes.status) };
    }
    return { status: "pending" }; // transient provider error — try next tick
  }

  if (statusData.status === "IN_QUEUE" || statusData.status === "IN_PROGRESS") {
    return { status: "pending" };
  }
  if (statusData.status !== "COMPLETED") {
    return { status: "failed", error: `Video job ended with status ${statusData.status ?? "unknown"}` };
  }

  const resultRes = await fetch(base, { headers });
  const resultData = (await resultRes.json()) as { video?: { url?: string } } & FalError;
  const url = resultData.video?.url;
  if (!resultRes.ok || !url) {
    return { status: "failed", error: `Video job completed but returned no video: ${falErrorMessage(resultData, resultRes.status)}` };
  }
  return { status: "done", videoUrl: url };
}

// ─── Lip sync (queue) ────────────────────────────────────────────────────────
// Re-times an avatar clip's mouth movement to a voiceover track. Same queue
// pattern as image-to-video: submit returns a request id stored on the run,
// later ticks poll. Default model takes {video_url, audio_url}.

const DEFAULT_LIPSYNC_MODEL = "fal-ai/sync-lipsync";

function lipsyncModel(): string {
  return process.env.FAL_LIPSYNC_MODEL || DEFAULT_LIPSYNC_MODEL;
}

export async function submitLipsync(params: {
  videoUrl: string;
  audioUrl: string;
}): Promise<{ requestId: string }> {
  const res = await fetch(`${FAL_QUEUE_URL}/${lipsyncModel()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${falKey()}`,
    },
    body: JSON.stringify({
      video_url: params.videoUrl,
      audio_url: params.audioUrl,
      // If the audio runs past the clip, cut rather than loop the footage.
      sync_mode: "cut_off",
    }),
  });

  const data = (await res.json()) as { request_id?: string } & FalError;
  if (!res.ok || !data.request_id) {
    throw new Error(`Lipsync job submit failed: ${falErrorMessage(data, res.status)}`);
  }
  return { requestId: data.request_id };
}

export async function checkLipsyncJob(requestId: string): Promise<VideoJobCheck> {
  const base = `${FAL_QUEUE_URL}/${appId(lipsyncModel())}/requests/${requestId}`;
  const headers = { Authorization: `Key ${falKey()}` };

  const statusRes = await fetch(`${base}/status`, { headers });
  const statusData = (await statusRes.json()) as { status?: string } & FalError;

  if (!statusRes.ok) {
    if (statusRes.status >= 400 && statusRes.status < 500) {
      return { status: "failed", error: falErrorMessage(statusData, statusRes.status) };
    }
    return { status: "pending" };
  }
  if (statusData.status === "IN_QUEUE" || statusData.status === "IN_PROGRESS") {
    return { status: "pending" };
  }
  if (statusData.status !== "COMPLETED") {
    return { status: "failed", error: `Lipsync job ended with status ${statusData.status ?? "unknown"}` };
  }

  const resultRes = await fetch(base, { headers });
  const resultData = (await resultRes.json()) as { video?: { url?: string } } & FalError;
  const url = resultData.video?.url;
  if (!resultRes.ok || !url) {
    return { status: "failed", error: `Lipsync completed but returned no video: ${falErrorMessage(resultData, resultRes.status)}` };
  }
  return { status: "done", videoUrl: url };
}

// ─── Generated music (sync — stable-audio renders in seconds) ────────────────
// Rights-safe soundtrack source: the model generates an original instrumental,
// so there is no licensing problem (unlike Instagram's trending audio, which
// the publishing API cannot attach anyway).

export async function generateMusic(params: {
  mood: string;
  durationS: number;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const model = process.env.FAL_MUSIC_MODEL || DEFAULT_MUSIC_MODEL;
  const seconds = Math.min(Math.max(Math.ceil(params.durationS), 5), 45);

  const res = await fetch(`${FAL_SYNC_URL}/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${falKey()}`,
    },
    body: JSON.stringify({
      prompt: `${params.mood} instrumental background music for a short-form vertical video, no vocals, clean loop`,
      seconds_total: seconds,
      steps: 50, // default 100 risks sync-endpoint timeouts in serverless
    }),
  });

  const data = (await res.json()) as { audio_file?: { url?: string } } & FalError;
  const url = data.audio_file?.url;
  if (!res.ok || !url) {
    // Body included so a silent degrade (music_source: none) is diagnosable from logs.
    throw new Error(
      `Music generation failed (HTTP ${res.status}): ${falErrorMessage(data, res.status)} | body: ${JSON.stringify(data).slice(0, 400)}`
    );
  }

  const audioRes = await fetch(url);
  if (!audioRes.ok) throw new Error(`Music download failed (HTTP ${audioRes.status}).`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  return { buffer, mimeType: audioRes.headers.get("content-type") ?? "audio/wav" };
}
