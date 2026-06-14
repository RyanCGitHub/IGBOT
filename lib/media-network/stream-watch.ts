import { supabaseServer } from "@/lib/supabase-server";
import { twitchConfigured, getAppToken, getBroadcasterId, getRecentClips } from "@/lib/media-network/twitch";
import type { ClipRightsStatus } from "@/lib/media-network/types";

// Stream Watch v1 (sanctioned, no new infra): polls the official Twitch Clips
// API for each tracked streamer (an active `twitch` content_source on a clips
// brand), ranks new clips by VIEW VELOCITY, and drops the top risers into the
// Clip Desk as candidates for review. It never downloads clip media or auto-
// posts — the owner reviews + acquires the file with rights (Clip Desk gate).

const LOOKBACK_HOURS = 48;
const MIN_VIEWS = 50;
const RISERS_PER_SOURCE = 5;

// Source permission → clip rights posture (clipRightsVerdict gates publishing).
function rightsFor(permission: string): ClipRightsStatus | null {
  switch (permission) {
    case "owned": return "owned";
    case "permissioned": return "permissioned";
    case "public_reference_only": return "commentary_only";
    case "blocked": return null; // never ingest
    default: return "needs_review"; // user_submitted / unknown
  }
}

export type StreamWatchSummary = {
  configured: boolean;
  sources_checked: number;
  clips_seen: number;
  candidates_created: number;
  skipped_existing: number;
  errors: number;
  logs: string[];
};

export async function runStreamWatch(opts?: { dryRun?: boolean }): Promise<StreamWatchSummary> {
  const dryRun = !!opts?.dryRun;
  const sum: StreamWatchSummary = { configured: twitchConfigured(), sources_checked: 0, clips_seen: 0, candidates_created: 0, skipped_existing: 0, errors: 0, logs: [] };
  const log = (m: string) => { sum.logs.push(m); console.log(`[stream-watch] ${m}`); };

  if (!sum.configured) { log("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set — skipping"); return sum; }
  const token = await getAppToken();
  if (!token) { log("could not get Twitch app token"); sum.errors++; return sum; }

  // Active twitch sources on streamer_clips brands.
  const { data: sources } = await supabaseServer
    .from("content_sources")
    .select("id, media_brand_id, source_name, platform_handle, permission_status, media_brands!inner(brand_type)")
    .eq("source_type", "twitch").eq("is_active", true);
  const twitchSources = (sources ?? []).filter(s => (s.media_brands as { brand_type?: string } | null)?.brand_type === "streamer_clips");

  if (twitchSources.length === 0) { log("no active Twitch sources on a clips brand — add one in Source Manager"); return sum; }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

  for (const src of twitchSources) {
    sum.sources_checked++;
    const handle = (src.platform_handle as string) ?? (src.source_name as string);
    const rights = rightsFor(src.permission_status as string);
    if (!rights) { log(`source ${src.id} (${handle}): blocked permission — skipping`); continue; }

    try {
      const broadcasterId = await getBroadcasterId(handle, token);
      if (!broadcasterId) { log(`source ${src.id}: could not resolve Twitch user "${handle}"`); sum.errors++; continue; }

      const clips = await getRecentClips(broadcasterId, token, since, 50);
      sum.clips_seen += clips.length;

      // Rank by view velocity (views per hour since creation).
      const ranked = clips
        .filter(c => c.view_count >= MIN_VIEWS)
        .map(c => {
          const hours = Math.max((Date.now() - new Date(c.created_at).getTime()) / 3_600_000, 0.25);
          return { c, velocity: c.view_count / hours, hours };
        })
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, RISERS_PER_SOURCE);

      if (ranked.length === 0) { log(`source ${src.id} (${handle}): no risers ≥${MIN_VIEWS} views in ${LOOKBACK_HOURS}h`); continue; }

      // Dedup against already-ingested clips for this brand.
      const urls = ranked.map(r => r.c.url);
      const { data: existing } = await supabaseServer
        .from("clip_assets").select("original_clip_url").eq("media_brand_id", src.media_brand_id).in("original_clip_url", urls);
      const seen = new Set((existing ?? []).map(e => e.original_clip_url as string));

      for (const { c, velocity, hours } of ranked) {
        if (seen.has(c.url)) { sum.skipped_existing++; continue; }
        const summary = `🔥 Stream Watch — ${c.view_count.toLocaleString()} views, ${Math.round(velocity)}/hr, ${hours.toFixed(1)}h old`;
        log(`candidate: ${handle} — "${c.title.slice(0, 50)}" (${summary})`);
        if (dryRun) { sum.candidates_created++; continue; }
        const { error } = await supabaseServer.from("clip_assets").insert({
          media_brand_id: src.media_brand_id,
          source_id: src.id,
          clip_title: c.title.slice(0, 200) || "Untitled clip",
          original_clip_url: c.url,
          uploaded_file_url: null,          // never auto-downloaded
          streamer_name: c.broadcaster_name,
          streamer_platform: "twitch",
          duration_seconds: Math.round(c.duration),
          clip_summary: summary,
          source_credit_text: `Clip: ${c.broadcaster_name} on Twitch`,
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

  log(`done — sources=${sum.sources_checked} clips=${sum.clips_seen} candidates=${sum.candidates_created} skipped=${sum.skipped_existing} errors=${sum.errors}`);
  return sum;
}
