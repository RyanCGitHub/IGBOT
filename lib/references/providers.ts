// Reference Discovery Engine — search providers.
//
// SAFETY: this is controlled, API-based discovery — never raw HTML/browser
// scraping of Google Images. Two tiers:
//   • Pexels (photos + video) — permissive Pexels License → direct-use eligible.
//   • Web image search (SerpAPI or Google CSE) — arbitrary web results whose
//     license is unknown, so every result is force-marked reference_only +
//     needs_review and is NEVER reposted directly; it only informs mood/lighting.
//
// Every provider fails soft: a missing key or an API error returns [] so the
// pipeline degrades gracefully rather than blocking a Reel.

import type { DiscoveredAsset } from "./types";

const PEXELS_PHOTO_URL = "https://api.pexels.com/v1/search";
const PEXELS_VIDEO_URL = "https://api.pexels.com/videos/search";
const SERPAPI_URL = "https://serpapi.com/search.json";
const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";

const PEXELS_LICENSE_URL = "https://www.pexels.com/license/";

// Which tiers are usable given the configured env. Surfaced to the UI/logs so the
// owner knows what to add in Vercel.
export function providerStatus(): { pexels: boolean; web: "serpapi" | "google_cse" | null } {
  const web = process.env.SERPAPI_KEY
    ? "serpapi"
    : process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX
      ? "google_cse"
      : null;
  return { pexels: !!process.env.PEXELS_API_KEY, web };
}

export function anyProviderConfigured(): boolean {
  const s = providerStatus();
  return s.pexels || s.web !== null;
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

// ─── Pexels photos ───────────────────────────────────────────────────────────

type PexelsPhoto = {
  id: number; width: number; height: number; url: string;
  photographer: string; photographer_url: string;
  src: { original: string; large2x: string; large: string; medium: string; portrait: string; tiny: string };
};

export async function searchPexelsPhotos(query: string, perPage = 6): Promise<DiscoveredAsset[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const url = `${PEXELS_PHOTO_URL}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) { console.warn(`[references] pexels photos ${res.status} for "${query}"`); return []; }
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    return (data.photos ?? []).map((p): DiscoveredAsset => ({
      source_provider: "pexels",
      source_url: p.url,
      full_url: p.src.large2x || p.src.original,
      thumbnail_url: p.src.medium || p.src.tiny,
      asset_type: "image",
      width: p.width, height: p.height, duration_s: null,
      license_type: "Pexels License", license_url: PEXELS_LICENSE_URL,
      creator_name: p.photographer, source_domain: "pexels.com",
      direct_use_allowed: true, reference_only: false, needs_review: false,
    }));
  } catch (e) {
    console.warn(`[references] pexels photos error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ─── Pexels videos ───────────────────────────────────────────────────────────

type PexelsVideo = {
  id: number; width: number; height: number; duration: number; url: string; image: string;
  user: { name: string; url: string };
  video_files: Array<{ quality: string; width: number; height: number; link: string; file_type: string }>;
};

// Prefer a portrait-ish HD/SD mp4 that isn't enormous — Instagram Reels are 9:16.
function pickVideoFile(v: PexelsVideo): { link: string; width: number; height: number } | null {
  const mp4 = v.video_files.filter(f => f.file_type === "video/mp4" && f.link);
  if (!mp4.length) return null;
  const portrait = mp4.filter(f => f.height >= f.width);
  const pool = portrait.length ? portrait : mp4;
  // Mid-resolution: good enough as a reference/background, avoids 4K downloads.
  pool.sort((a, b) => (a.height || 0) - (b.height || 0));
  const mid = pool.find(f => (f.height || 0) >= 1080) ?? pool[pool.length - 1];
  return { link: mid.link, width: mid.width, height: mid.height };
}

export async function searchPexelsVideos(query: string, perPage = 4): Promise<DiscoveredAsset[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const url = `${PEXELS_VIDEO_URL}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) { console.warn(`[references] pexels videos ${res.status} for "${query}"`); return []; }
    const data = (await res.json()) as { videos?: PexelsVideo[] };
    return (data.videos ?? []).flatMap((v): DiscoveredAsset[] => {
      const file = pickVideoFile(v);
      if (!file) return [];
      return [{
        source_provider: "pexels_video",
        source_url: v.url,
        full_url: file.link,
        thumbnail_url: v.image,
        asset_type: "video",
        width: file.width || v.width, height: file.height || v.height, duration_s: v.duration ?? null,
        license_type: "Pexels License", license_url: PEXELS_LICENSE_URL,
        creator_name: v.user?.name ?? null, source_domain: "pexels.com",
        direct_use_allowed: true, reference_only: false, needs_review: false,
      }];
    });
  } catch (e) {
    console.warn(`[references] pexels videos error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ─── Web image search (reference-only tier) ──────────────────────────────────
// Results are arbitrary web images with UNKNOWN licenses. They are always marked
// reference_only + needs_review and never proposed for direct use.

async function searchSerpApi(query: string, num: number): Promise<DiscoveredAsset[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const url = `${SERPAPI_URL}?engine=google_images&q=${encodeURIComponent(query)}&num=${num}&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn(`[references] serpapi ${res.status} for "${query}"`); return []; }
    const data = (await res.json()) as {
      images_results?: Array<{ original?: string; thumbnail?: string; link?: string; source?: string; title?: string }>;
    };
    return (data.images_results ?? []).slice(0, num).flatMap((r): DiscoveredAsset[] => {
      if (!r.original && !r.thumbnail) return [];
      const page = r.link || r.original || r.thumbnail!;
      return [{
        source_provider: "serpapi",
        source_url: page,
        full_url: null,                       // unknown license → not for direct download
        thumbnail_url: r.thumbnail || r.original || null,
        asset_type: "image",
        width: null, height: null, duration_s: null,
        license_type: "unknown", license_url: null,
        creator_name: r.source ?? null, source_domain: domainOf(page),
        direct_use_allowed: false, reference_only: true, needs_review: true,
      }];
    });
  } catch (e) {
    console.warn(`[references] serpapi error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function searchGoogleCse(query: string, num: number): Promise<DiscoveredAsset[]> {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return [];
  try {
    const n = Math.min(10, Math.max(1, num)); // CSE max 10 per call
    const url = `${GOOGLE_CSE_URL}?key=${key}&cx=${cx}&searchType=image&safe=active&num=${n}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn(`[references] google cse ${res.status} for "${query}"`); return []; }
    const data = (await res.json()) as {
      items?: Array<{ link?: string; displayLink?: string; title?: string; image?: { thumbnailLink?: string; contextLink?: string; width?: number; height?: number } }>;
    };
    return (data.items ?? []).flatMap((r): DiscoveredAsset[] => {
      if (!r.link && !r.image?.thumbnailLink) return [];
      const page = r.image?.contextLink || r.link || "";
      return [{
        source_provider: "google_cse",
        source_url: page,
        full_url: null,
        thumbnail_url: r.image?.thumbnailLink || r.link || null,
        asset_type: "image",
        width: r.image?.width ?? null, height: r.image?.height ?? null, duration_s: null,
        license_type: "unknown", license_url: null,
        creator_name: r.displayLink ?? null, source_domain: r.displayLink ?? domainOf(page),
        direct_use_allowed: false, reference_only: true, needs_review: true,
      }];
    });
  } catch (e) {
    console.warn(`[references] google cse error:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// Whichever web provider is configured (SerpAPI preferred for richer results).
export async function searchWebImages(query: string, num = 4): Promise<DiscoveredAsset[]> {
  if (process.env.SERPAPI_KEY) return searchSerpApi(query, num);
  return searchGoogleCse(query, num);
}
