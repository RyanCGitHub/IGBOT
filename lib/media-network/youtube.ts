// YouTube Data API v3 client for Stream Watch. Official, read-only, API-key
// auth. YouTube has no clips endpoint, but we can list a channel's recent
// videos + past live streams (the uploads playlist) with view stats — Stream
// Watch surfaces the trending ones to clip from. Quota-cheap path: channels(1)
// → playlistItems(1) → videos(1), no search.list (100). Needs YOUTUBE_API_KEY.

const BASE = "https://www.googleapis.com/youtube/v3";

export type YouTubeVideo = {
  id: string;
  url: string;
  title: string;
  channel_title: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
  duration_seconds: number;
  is_stream: boolean;
};

export function youtubeConfigured(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

function parseDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// Resolve a channel handle (@name), channel id (UC…), or username to its id +
// uploads playlist.
export async function resolveChannel(handle: string): Promise<{ channelId: string; uploads: string } | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const clean = handle.trim();
  const param = /^UC[\w-]{20,}$/.test(clean)
    ? `id=${clean}`
    : `forHandle=${encodeURIComponent(clean.startsWith("@") ? clean : "@" + clean)}`;
  try {
    let res = await fetch(`${BASE}/channels?part=contentDetails&${param}&key=${key}`);
    let data = (await res.json()) as { items?: { id: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] };
    // Fallback: legacy username.
    if (!data.items?.length && !/^UC/.test(clean)) {
      res = await fetch(`${BASE}/channels?part=contentDetails&forUsername=${encodeURIComponent(clean.replace(/^@/, ""))}&key=${key}`);
      data = (await res.json()) as typeof data;
    }
    const item = data.items?.[0];
    const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
    return item && uploads ? { channelId: item.id, uploads } : null;
  } catch { return null; }
}

export async function getRecentVideos(uploadsPlaylist: string, sinceISO: string, max = 15): Promise<YouTubeVideo[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    const plRes = await fetch(`${BASE}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylist}&maxResults=${max}&key=${key}`);
    const pl = (await plRes.json()) as { items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] };
    const ids = (pl.items ?? [])
      .filter(i => (i.contentDetails?.videoPublishedAt ?? "") >= sinceISO)
      .map(i => i.contentDetails?.videoId).filter(Boolean) as string[];
    if (ids.length === 0) return [];

    const vRes = await fetch(`${BASE}/videos?part=statistics,snippet,contentDetails,liveStreamingDetails&id=${ids.join(",")}&key=${key}`);
    const v = (await vRes.json()) as {
      items?: {
        id: string;
        snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
        statistics?: { viewCount?: string };
        contentDetails?: { duration?: string };
        liveStreamingDetails?: unknown;
      }[];
    };
    return (v.items ?? []).map(it => ({
      id: it.id,
      url: `https://www.youtube.com/watch?v=${it.id}`,
      title: it.snippet?.title ?? "Untitled",
      channel_title: it.snippet?.channelTitle ?? "",
      view_count: Number(it.statistics?.viewCount ?? 0),
      published_at: it.snippet?.publishedAt ?? "",
      thumbnail_url: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? "",
      duration_seconds: parseDuration(it.contentDetails?.duration),
      is_stream: !!it.liveStreamingDetails,
    }));
  } catch { return []; }
}
