// Shared defensive JSON parsing for provider responses. Gateways in front of
// every provider (Cloudflare et al.) can return HTML error pages; res.json()
// then throws a bare "Unexpected token '<'" that names no provider and no
// status. This reads text first and converts non-JSON into a labeled,
// retryable error carrying the HTTP status and the head of the body.

export async function safeJson<T>(res: Response, providerLabel: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const head = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`${providerLabel} returned non-JSON (HTTP ${res.status}): ${head}`);
  }
}
