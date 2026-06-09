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
