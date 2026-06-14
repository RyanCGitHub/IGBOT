import { supabaseServer } from "@/lib/supabase-server";
import { twitchConfigured, getAppToken, getBroadcasterId, getRecentClips } from "@/lib/media-network/twitch";
import { youtubeConfigured, resolveChannel, getRecentVideos } from "@/lib/media-network/youtube";
import type { ClipRightsStatus, StreamerPlatform } from "@/lib/media-network/types";

// Stream Watch v1 (sanctioned, no new infra): polls OFFICIAL platform APIs for
// each tracked streamer (an active twitch/youtube content_source on a clips
// brand), ranks new material by VIEW VELOCITY, and drops the top risers into
// the Clip Desk as candidates for review.
//   • Twitch → official Clips API (actual clips).
//   • YouTube → Data API: a channel's recent videos + past live streams (no
//     clips endpoint exists, so we surface the source video to clip from).
// It never downloads media or auto-posts — the owner reviews + acquires the
// file with rights (Clip Desk gate). Kick has no official clip/video stats API,
// so it isn't supported here.

const LOOKBACK_HOURS = 48;
const MIN_VIEWS = 50;
const RISERS_PER_SOURCE = 5;

function rightsFor(permission: string): ClipRightsStatus | null {
  switch (permission) {
    case "owned": return "owned";
    case "permissioned": return "permissioned";
    case "public_reference_only": return "commentary_only";
    case "blocked": return null;
    default: return "needs_review";
  }
}

type Candidate = {
  id: string; url: string; title: string; view_count: number; created_at: string;
  thumbnail_url: string; duration_seconds: number; streamer_name: string;
  platform: StreamerPlatform; kind: string;
};

export type StreamWatchSummary = {
  configured: boolean; twitch: boolean; youtube: boolean;
  sources_checked: number; clips_seen: number; candidates_created: number;
  skipped_existing: number; errors: number; logs: string[];
};

export async function runStreamWatch(opts?: { dryRun?: boolean }): Promise<StreamWatchSummary> {
  const dryRun = !!opts?.dryRun;
  const twOk = twitchConfigured(), ytOk = youtubeConfigured();
  const sum: StreamWatchSummary = {
    configured: twOk || ytOk, twitch: twOk, youtube: ytOk,
    sources_checked: 0, clips_seen: 0, candidates_created: 0, skipped_existing: 0, errors: 0, logs: [],
  };
  const log = (m: string) => { sum.logs.push(m); console.log(`[stream-watch] ${m}`); };

  if (!sum.configured) { log("no provider configured (set TWITCH_* and/or YOUTUBE_API_KEY) — skipping"); return sum; }
  const twToken = twOk ? await getAppToken() : null;
  if (twOk && !twToken) log("could not get Twitch app token — Twitch sources will be skipped");

  const { data: sources } = await supabaseServer
    .from("content_sources")
    .select("id, media_brand_id, source_type, source_name, platform_handle, permission_status, media_brands!inner(brand_type)")
    .in("source_type", ["twitch", "youtube"]).eq("is_active", true);
  const watched = (sources ?? []).filter(s => (s.media_brands as { brand_type?: string } | null)?.brand_type === "streamer_clips");

  if (watched.length === 0) { log("no active Twitch/YouTube sources on a clips brand — add one in Source Manager"); return sum; }

  const sinceMs = Date.now() - LOOKBACK_HOURS * 3_600_000;
  const sinceISO = new Date(sinceMs).toISOString();

  for (const src of watched) {
    sum.sources_checked++;
    const platform = src.source_type as StreamerPlatform;
    const handle = (src.platform_handle as string) ?? (src.source_name as string);
    const rights = rightsFor(src.permission_status as string);
    if (!rights) { log(`source ${src.id} (${handle}): blocked permission — skipping`); continue; }

    try {
      let candidates: Candidate[] = [];

      if (platform === "twitch") {
        if (!twToken) continue;
        const bId = await getBroadcasterId(handle, twToken);
        if (!bId) { log(`source ${src.id}: could not resolve Twitch user "${handle}"`); sum.errors++; continue; }
        const clips = await getRecentClips(bId, twToken, sinceISO, 50);
        candidates = clips.map(c => ({ id: c.id, url: c.url, title: c.title, view_count: c.view_count, created_at: c.created_at, thumbnail_url: c.thumbnail_url, duration_seconds: Math.round(c.duration), streamer_name: c.broadcaster_name, platform: "twitch", kind: "clip" }));
      } else if (platform === "youtube") {
        if (!ytOk) { log(`source ${src.id}: YOUTUBE_API_KEY not set — skipping`); continue; }
        const ch = await resolveChannel(handle);
        if (!ch) { log(`source ${src.id}: could not resolve YouTube channel "${handle}"`); sum.errors++; continue; }
        const vids = await getRecentVideos(ch.uploads, sinceISO, 15);
        candidates = vids.map(v => ({ id: v.id, url: v.url, title: v.title, view_count: v.view_count, created_at: v.published_at, thumbnail_url: v.thumbnail_url, duration_seconds: v.duration_seconds, streamer_name: v.channel_title || handle, platform: "youtube", kind: v.is_stream ? "stream" : "video" }));
      } else continue;

      sum.clips_seen += candidates.length;

      const ranked = candidates
        .filter(c => c.view_count >= MIN_VIEWS)
        .map(c => {
          const hours = Math.max((Date.now() - new Date(c.created_at).getTime()) / 3_600_000, 0.25);
          return { c, velocity: c.view_count / hours, hours };
        })
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, RISERS_PER_SOURCE);

      if (ranked.length === 0) { log(`source ${src.id} (${handle}/${platform}): no risers ≥${MIN_VIEWS} views in ${LOOKBACK_HOURS}h`); continue; }

      const urls = ranked.map(r => r.c.url);
      const { data: existing } = await supabaseServer
        .from("clip_assets").select("original_clip_url").eq("media_brand_id", src.media_brand_id).in("original_clip_url", urls);
      const seen = new Set((existing ?? []).map(e => e.original_clip_url as string));

      for (const { c, velocity, hours } of ranked) {
        if (seen.has(c.url)) { sum.skipped_existing++; continue; }
        const summary = `🔥 Stream Watch (${platform} ${c.kind}) — ${c.view_count.toLocaleString()} views, ${Math.round(velocity)}/hr, ${hours.toFixed(1)}h old`;
        log(`candidate: ${handle} — "${c.title.slice(0, 50)}" (${summary})`);
        if (dryRun) { sum.candidates_created++; continue; }
        const { error } = await supabaseServer.from("clip_assets").insert({
          media_brand_id: src.media_brand_id,
          source_id: src.id,
          clip_title: c.title.slice(0, 200) || "Untitled",
          original_clip_url: c.url,
          uploaded_file_url: null,            // never auto-downloaded
          streamer_name: c.streamer_name,
          streamer_platform: platform,
          duration_seconds: c.duration_seconds,
          clip_summary: summary,
          source_credit_text: `${c.kind === "clip" ? "Clip" : "Source"}: ${c.streamer_name} on ${platform === "twitch" ? "Twitch" : "YouTube"}`,
          rights_status: rights,
          impersonation_risk: "medium",
          status: "imported",
        });
        if (error) { log(`insert failed for ${c.url}: ${error.message}`); sum.errors++; continue; }
        sum.candidates_created++;
      }
    } catch (e) {
      sum.errors++;
      log(`source ${src.id} threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log(`done — sources=${sum.sources_checked} seen=${sum.clips_seen} candidates=${sum.candidates_created} skipped=${sum.skipped_existing} errors=${sum.errors}`);
  return sum;
}
