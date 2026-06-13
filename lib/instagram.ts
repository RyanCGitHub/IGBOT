// Instagram Graph API helpers for the publishing flow.
// All functions accept a PublishLogger and append structured log entries.
// Access tokens are always redacted before logging.

export type LogEntry = {
  step: string;
  status: 'success' | 'error' | 'info';
  detail: string;
  request?: { url: string; method?: string; body?: unknown };
  response?: { status: number; body: unknown };
  timestamp: string;
};

export type PublishLogger = {
  add(entry: Omit<LogEntry, 'timestamp'>): void;
  all(): LogEntry[];
};

export function createLogger(): PublishLogger {
  const entries: LogEntry[] = [];
  return {
    add(entry) {
      const full: LogEntry = { ...entry, timestamp: new Date().toISOString() };
      console.log(`[IG] [${entry.step}] ${entry.detail}`, entry.response?.body ?? '');
      entries.push(full);
    },
    all() {
      return entries;
    },
  };
}

type IGError = { error?: { message?: string; code?: number; type?: string } };

// ─── Create media container ───────────────────────────────────────────────────

export async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
  log: PublishLogger
): Promise<{ containerId: string } | { error: string }> {
  const url = `https://graph.facebook.com/v21.0/${igUserId}/media`;

  log.add({
    step: 'create_container',
    status: 'info',
    detail: `POST /v21.0/[IG_USER_ID]/media`,
    request: {
      url: `https://graph.facebook.com/v21.0/[IG_USER_ID]/media`,
      method: 'POST',
      body: { image_url: imageUrl, caption, access_token: '[REDACTED]' },
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
  });
  const data = (await res.json()) as { id?: string } & IGError;

  log.add({
    step: 'create_container_response',
    status: res.ok && data.id ? 'success' : 'error',
    detail: res.ok && data.id
      ? `Container created — ID: ${data.id}`
      : `Failed — ${data.error?.message ?? `HTTP ${res.status}`}`,
    response: { status: res.status, body: data },
  });

  if (!res.ok || !data.id) return { error: data.error?.message ?? `HTTP ${res.status}` };
  return { containerId: data.id };
}

// ─── Create REELS media container ─────────────────────────────────────────────
// Same flow as images but media_type=REELS + video_url. Video containers take
// much longer to reach FINISHED — callers poll across scheduler ticks with
// checkContainerStatus instead of blocking in pollContainerStatus.

export async function createReelsContainer(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string,
  log: PublishLogger,
  coverUrl?: string | null
): Promise<{ containerId: string } | { error: string }> {
  const url = `https://graph.facebook.com/v21.0/${igUserId}/media`;
  const body = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: true,
    // Custom grid cover (JPEG URL). Graph API also accepts thumb_offset; we
    // always render a branded cover so cover_url wins when present.
    ...(coverUrl ? { cover_url: coverUrl } : {}),
  };

  log.add({
    step: 'create_reels_container',
    status: 'info',
    detail: `POST /v21.0/[IG_USER_ID]/media (REELS)`,
    request: {
      url: `https://graph.facebook.com/v21.0/[IG_USER_ID]/media`,
      method: 'POST',
      body: { ...body, access_token: '[REDACTED]' },
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });
  const data = (await res.json()) as { id?: string } & IGError;

  log.add({
    step: 'create_reels_container_response',
    status: res.ok && data.id ? 'success' : 'error',
    detail: res.ok && data.id
      ? `Reels container created — ID: ${data.id}`
      : `Failed — ${data.error?.message ?? `HTTP ${res.status}`}`,
    response: { status: res.status, body: data },
  });

  if (!res.ok || !data.id) return { error: data.error?.message ?? `HTTP ${res.status}` };
  return { containerId: data.id };
}

// ─── Single container status check (cross-tick polling) ──────────────────────

export async function checkContainerStatus(
  containerId: string,
  accessToken: string,
  log: PublishLogger
): Promise<{ statusCode: 'IN_PROGRESS' | 'FINISHED' } | { error: string }> {
  const url = `https://graph.facebook.com/v21.0/${containerId}?fields=status_code,status&access_token=${accessToken}`;
  const displayUrl = `https://graph.facebook.com/v21.0/${containerId}?fields=status_code,status&access_token=[REDACTED]`;

  log.add({ step: 'check_container', status: 'info', detail: 'Single container status check', request: { url: displayUrl } });

  const res = await fetch(url);
  const data = (await res.json()) as { status_code?: string; status?: string } & IGError;

  log.add({
    step: 'check_container_response',
    status: res.ok ? 'info' : 'error',
    detail: res.ok ? `status_code = ${data.status_code ?? 'unknown'}` : `Error: ${data.error?.message ?? `HTTP ${res.status}`}`,
    response: { status: res.status, body: data },
  });

  if (!res.ok) return { error: data.error?.message ?? `HTTP ${res.status}` };
  if (data.status_code === 'FINISHED') return { statusCode: 'FINISHED' };
  if (data.status_code === 'ERROR') return { error: data.status ?? 'Container processing failed' };
  if (data.status_code === 'EXPIRED') return { error: 'Container expired before publishing' };
  return { statusCode: 'IN_PROGRESS' };
}

// ─── Poll container status ────────────────────────────────────────────────────

type StatusCode = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

export async function pollContainerStatus(
  containerId: string,
  accessToken: string,
  log: PublishLogger,
  maxPolls = 15,
  intervalMs = 3_000
): Promise<{ statusCode: 'FINISHED' } | { error: string }> {
  for (let attempt = 1; attempt <= maxPolls; attempt++) {
    const url = `https://graph.facebook.com/v21.0/${containerId}?fields=status_code,status&access_token=${accessToken}`;
    const displayUrl = `https://graph.facebook.com/v21.0/${containerId}?fields=status_code,status&access_token=[REDACTED]`;

    log.add({
      step: `poll_${attempt}`,
      status: 'info',
      detail: `Poll attempt ${attempt}/${maxPolls}`,
      request: { url: displayUrl },
    });

    const res = await fetch(url);
    const data = (await res.json()) as { status_code?: StatusCode; status?: string } & IGError;

    log.add({
      step: `poll_${attempt}_response`,
      status: res.ok ? 'info' : 'error',
      detail: res.ok
        ? `status_code = ${data.status_code ?? 'unknown'}`
        : `Error: ${data.error?.message ?? `HTTP ${res.status}`}`,
      response: { status: res.status, body: data },
    });

    if (!res.ok) return { error: data.error?.message ?? `HTTP ${res.status}` };

    if (data.status_code === 'FINISHED') return { statusCode: 'FINISHED' };
    if (data.status_code === 'ERROR')   return { error: data.status ?? 'Container processing failed' };
    if (data.status_code === 'EXPIRED') return { error: 'Container expired before publishing' };

    if (attempt < maxPolls) await new Promise<void>(r => setTimeout(r, intervalMs));
  }

  return { error: `Container did not reach FINISHED after ${maxPolls} polls (${(maxPolls * intervalMs) / 1000}s)` };
}

// ─── Publish container ────────────────────────────────────────────────────────

export async function publishContainer(
  igUserId: string,
  containerId: string,
  accessToken: string,
  log: PublishLogger
): Promise<{ mediaId: string } | { error: string }> {
  const url = `https://graph.facebook.com/v21.0/${igUserId}/media_publish`;

  log.add({
    step: 'publish',
    status: 'info',
    detail: 'POST /v21.0/[IG_USER_ID]/media_publish',
    request: {
      url: 'https://graph.facebook.com/v21.0/[IG_USER_ID]/media_publish',
      method: 'POST',
      body: { creation_id: containerId, access_token: '[REDACTED]' },
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });
  const data = (await res.json()) as { id?: string } & IGError;

  log.add({
    step: 'publish_response',
    status: res.ok && data.id ? 'success' : 'error',
    detail: res.ok && data.id
      ? `Published — Media ID: ${data.id}`
      : `Failed — ${data.error?.message ?? `HTTP ${res.status}`}`,
    response: { status: res.status, body: data },
  });

  if (!res.ok || !data.id) return { error: data.error?.message ?? `HTTP ${res.status}` };
  return { mediaId: data.id };
}

// ─── Get media permalink ──────────────────────────────────────────────────────

export async function getMediaPermalink(
  mediaId: string,
  accessToken: string,
  log: PublishLogger
): Promise<{ permalink: string } | { error: string }> {
  const url = `https://graph.facebook.com/v21.0/${mediaId}?fields=permalink&access_token=${accessToken}`;
  const displayUrl = `https://graph.facebook.com/v21.0/${mediaId}?fields=permalink&access_token=[REDACTED]`;

  log.add({
    step: 'permalink',
    status: 'info',
    detail: `GET /v21.0/${mediaId}?fields=permalink`,
    request: { url: displayUrl },
  });

  const res = await fetch(url);
  const data = (await res.json()) as { permalink?: string } & IGError;

  log.add({
    step: 'permalink_response',
    status: res.ok && data.permalink ? 'success' : 'error',
    detail: res.ok && data.permalink
      ? `Permalink: ${data.permalink}`
      : `Failed — ${data.error?.message ?? `HTTP ${res.status}`}`,
    response: { status: res.status, body: data },
  });

  if (!res.ok || !data.permalink) return { error: data.error?.message ?? `HTTP ${res.status}` };
  return { permalink: data.permalink };
}

// ─── Get media insights (analytics — read-only) ───────────────────────────────

export type MediaInsights = {
  likes: number | null;
  comments: number | null;
  reach: number | null;
  impressions: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
  raw: Record<string, unknown>;
  insightsError: string | null;
};

// Conservative metric set valid for single-image FEED posts. Requesting an
// unsupported metric fails the ENTIRE insights call, so we keep this minimal and
// degrade gracefully — likes/comments always come from the media fields below.
const IMAGE_INSIGHT_METRICS = ["reach", "saved", "shares", "total_interactions"] as const;

// Reels support "views" (the v22+ unified play metric) on top of the image set.
const REELS_INSIGHT_METRICS = ["reach", "saved", "shares", "total_interactions", "views"] as const;

// Graph error codes that mean the media object no longer exists (deleted on IG).
// Same set the /[id]/sync route uses. Auth (190) and rate-limit (32, 4) codes are
// deliberately NOT here — those must never be treated as a deletion.
export const MEDIA_DELETED_CODES = new Set<number>([100, 803]);

export async function getMediaInsights(
  mediaId: string,
  accessToken: string,
  log: PublishLogger,
  mediaProductType: 'IMAGE' | 'REELS' = 'IMAGE'
): Promise<MediaInsights | { error: string; code?: number }> {
  const raw: Record<string, unknown> = {};

  // ── 1) Media fields: like_count, comments_count (reliable for owned media) ──
  const fieldsUrl = `https://graph.facebook.com/v21.0/${mediaId}?fields=like_count,comments_count&access_token=${accessToken}`;
  const fieldsDisplay = `https://graph.facebook.com/v21.0/${mediaId}?fields=like_count,comments_count&access_token=[REDACTED]`;

  log.add({
    step: 'insights_fields',
    status: 'info',
    detail: `GET /v21.0/${mediaId}?fields=like_count,comments_count`,
    request: { url: fieldsDisplay },
  });

  let likes: number | null = null;
  let comments: number | null = null;
  try {
    const res = await fetch(fieldsUrl);
    const data = (await res.json()) as { like_count?: number; comments_count?: number } & IGError;
    raw.fields = data;

    log.add({
      step: 'insights_fields_response',
      status: res.ok && !data.error ? 'success' : 'error',
      detail: res.ok && !data.error
        ? `like_count=${data.like_count ?? '?'} comments_count=${data.comments_count ?? '?'}`
        : `Failed — ${data.error?.message ?? `HTTP ${res.status}`}`,
      response: { status: res.status, body: data },
    });

    if (!res.ok || data.error) {
      // Surface the Graph code so the caller can distinguish "media deleted"
      // from auth / rate-limit / unknown errors.
      return { error: data.error?.message ?? `HTTP ${res.status}`, code: data.error?.code };
    }
    likes = typeof data.like_count === 'number' ? data.like_count : null;
    comments = typeof data.comments_count === 'number' ? data.comments_count : null;
  } catch (e) {
    return { error: `Network error fetching media fields: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ── 2) Insights metrics (degrade gracefully if unavailable) ────────────────
  const metricParam = (mediaProductType === 'REELS' ? REELS_INSIGHT_METRICS : IMAGE_INSIGHT_METRICS).join(',');
  const insightsUrl = `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${metricParam}&access_token=${accessToken}`;
  const insightsDisplay = `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${metricParam}&access_token=[REDACTED]`;

  log.add({
    step: 'insights_metrics',
    status: 'info',
    detail: `GET /v21.0/${mediaId}/insights?metric=${metricParam}`,
    request: { url: insightsDisplay },
  });

  let reach: number | null = null;
  let saves: number | null = null;
  let shares: number | null = null;
  let views: number | null = null;
  let insightsError: string | null = null;

  try {
    const res = await fetch(insightsUrl);
    const data = (await res.json()) as {
      data?: Array<{ name?: string; values?: Array<{ value?: number }> }>;
    } & IGError;
    raw.insights = data;

    if (!res.ok || data.error) {
      // Unsupported metric or other insights error — keep likes/comments, note it.
      insightsError = data.error?.message ?? `HTTP ${res.status}`;
      log.add({
        step: 'insights_metrics_response',
        status: 'error',
        detail: `Insights unavailable — ${insightsError} (likes/comments still recorded)`,
        response: { status: res.status, body: data },
      });
    } else {
      const map = new Map<string, number>();
      for (const m of data.data ?? []) {
        if (m.name && typeof m.values?.[0]?.value === 'number') map.set(m.name, m.values[0].value);
      }
      reach = map.get('reach') ?? null;
      saves = map.get('saved') ?? null;
      shares = map.get('shares') ?? null;
      views = map.get('views') ?? null;
      log.add({
        step: 'insights_metrics_response',
        status: 'success',
        detail: `reach=${reach ?? '?'} saved=${saves ?? '?'} shares=${shares ?? '?'} views=${views ?? '?'}`,
        response: { status: res.status, body: data },
      });
    }
  } catch (e) {
    insightsError = `Network error fetching insights: ${e instanceof Error ? e.message : String(e)}`;
    log.add({ step: 'insights_metrics_response', status: 'error', detail: insightsError });
  }

  // impressions is intentionally never requested (deprecated in v21). views is
  // only populated for REELS — it is not a valid single-image metric.
  return { likes, comments, reach, impressions: null, saves, shares, views, raw, insightsError };
}

// ─── List recent media for an IG user (analytics sync / auto-detection) ───────

export type IGMediaItem = {
  id: string;
  media_type: string | null;        // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type: string | null; // FEED | REELS | AD
  permalink: string | null;
  timestamp: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
};

// GET /{ig-user-id}/media — newest first. Best-effort; returns [] on error so a
// sync never crashes on one bad account.
export async function getUserMedia(
  igUserId: string,
  accessToken: string,
  limit = 25
): Promise<IGMediaItem[] | { error: string; code?: number }> {
  const fields = "id,media_type,media_product_type,permalink,timestamp,caption,media_url,thumbnail_url";
  const url = `https://graph.facebook.com/v21.0/${igUserId}/media?fields=${fields}&limit=${limit}&access_token=${accessToken}`;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as { data?: IGMediaItem[]; error?: { message?: string; code?: number } };
    if (!res.ok || data.error) return { error: data.error?.message ?? `HTTP ${res.status}`, code: data.error?.code };
    return data.data ?? [];
  } catch (e) {
    return { error: `Network error listing media: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// GET /{ig-user-id}?fields=followers_count — for views_per_follower.
export async function getFollowerCount(igUserId: string, accessToken: string): Promise<number | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${igUserId}?fields=followers_count&access_token=${accessToken}`);
    const data = (await res.json()) as { followers_count?: number };
    return typeof data.followers_count === "number" ? data.followers_count : null;
  } catch { return null; }
}
