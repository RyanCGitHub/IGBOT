// Twitch Helix client for Stream Watch. Uses the OFFICIAL Clips API only —
// app access token (client-credentials), then read clip metadata. We never
// download clip media here; Stream Watch surfaces trending clips for review and
// the owner handles acquisition with rights (the no-auto-download boundary).
// Needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET.

export type TwitchClip = {
  id: string;
  url: string;
  broadcaster_name: string;
  creator_name: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
};

export function twitchConfigured(): boolean {
  return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

export async function getAppToken(): Promise<string | null> {
  const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: "POST" });
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch { return null; }
}

function headers(token: string): HeadersInit {
  return { "Client-Id": process.env.TWITCH_CLIENT_ID ?? "", Authorization: `Bearer ${token}` };
}

// Resolve a Twitch login (handle) to a broadcaster id.
export async function getBroadcasterId(login: string, token: string): Promise<string | null> {
  try {
    const clean = login.replace(/^@/, "").trim().toLowerCase();
    const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(clean)}`, { headers: headers(token) });
    const data = (await res.json()) as { data?: { id: string }[] };
    return data.data?.[0]?.id ?? null;
  } catch { return null; }
}

// Clips for a broadcaster created since `startedAt` (RFC3339), newest-batch.
export async function getRecentClips(broadcasterId: string, token: string, startedAt: string, first = 50): Promise<TwitchClip[]> {
  try {
    const url = `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&started_at=${encodeURIComponent(startedAt)}&first=${first}`;
    const res = await fetch(url, { headers: headers(token) });
    const data = (await res.json()) as { data?: TwitchClip[] };
    return data.data ?? [];
  } catch { return []; }
}
