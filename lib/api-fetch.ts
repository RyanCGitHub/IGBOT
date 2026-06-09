// Drop-in replacement for fetch() that injects the internal API key header
// when NEXT_PUBLIC_APP_INTERNAL_API_KEY is configured.
// Use this in all client components instead of bare fetch().
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const key = process.env.NEXT_PUBLIC_APP_INTERNAL_API_KEY;
  return fetch(url, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      ...(key ? { "x-app-api-key": key } : {}),
    },
  });
}
