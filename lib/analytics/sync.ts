import { supabaseServer } from "@/lib/supabase-server";
import {
  createLogger, getMediaInsights, getUserMedia, getFollowerCount,
  MEDIA_DELETED_CODES, type IGMediaItem,
} from "@/lib/instagram";
import { getAnalysisImageB64, scoreContent } from "@/lib/viral/score";
import { writeScoreHistory } from "@/lib/viral/score-history";
import { evaluatePublishedPosts } from "@/lib/viral/accuracy";
import type { ContentLane } from "@/lib/viral/rubric";

// Hourly Instagram analytics sync. For every connected account it:
//  1. lists recent IG media and DETECTS posts not yet in published_posts
//     (auto-detecting hand-posted/manual-queue items),
//  2. captures a fresh metrics snapshot for every post that's DUE (per the
//     1h/3h/6h/12h/24h/48h/72h/7d-then-daily window schedule),
//  3. recovers stuck manual-queue items by matching them to live IG media,
//  4. backfills a post-publish viral score for posts that never got one,
//  5. refreshes prediction-vs-actual evaluations.
// Everything is best-effort and bounded so one bad account never jams the run.
// dryRun computes the same plan without writing anything.

const MEDIA_PER_ACCOUNT = 25;
const MAX_BACKFILLS_PER_RUN = 8;
const MAX_SYNC_ERRORS = 5; // give up tracking a post after this many consecutive sync failures
const HIGH_MATCH = 0.8;   // auto-resolve manual queue
const MEDIUM_MATCH = 0.5; // surface as "possible match"
// Tracking window schedule (hours since publish).
const WINDOW_HOURS = [1, 3, 6, 12, 24, 48, 72, 168];

export type SyncSummary = {
  status: "success" | "dry_run" | "error";
  accounts_checked: number;
  instagram_posts_found: number;
  new_posts_created: number;
  existing_posts_rechecked: number;
  snapshots_created: number;
  manual_queue_posts_resolved: number;
  viral_checks_created: number;
  errors_count: number;
  possible_matches: { manual_package_id: number; instagram_media_id: string; similarity: number; caption: string }[];
  logs: string[];
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/#[\w]+/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function similarity(a: string, b: string): number {
  const A = new Set(normalize(a).split(" ").filter(Boolean));
  const B = new Set(normalize(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter); // Jaccard
}
function nextSyncAt(publishedMs: number, nowMs: number): string | null {
  const age = (nowMs - publishedMs) / 3_600_000;
  for (const h of WINDOW_HOURS) if (age < h) return new Date(publishedMs + h * 3_600_000).toISOString();
  if (age < 720) { // daily after 7d, until 30d
    const days = Math.floor(age / 24);
    return new Date(publishedMs + (days + 1) * 24 * 3_600_000).toISOString();
  }
  return null; // tracking complete
}
const igLaneFallback = (mpt: string | null): ContentLane => (mpt === "REELS" ? "avatar_reels" : "general");

export async function syncInstagramAnalytics(opts?: { dryRun?: boolean; trigger?: string }): Promise<SyncSummary> {
  const dryRun = !!opts?.dryRun;
  const sum: SyncSummary = {
    status: dryRun ? "dry_run" : "success",
    accounts_checked: 0, instagram_posts_found: 0, new_posts_created: 0, existing_posts_rechecked: 0,
    snapshots_created: 0, manual_queue_posts_resolved: 0, viral_checks_created: 0, errors_count: 0,
    possible_matches: [], logs: [],
  };
  const log = (m: string) => { sum.logs.push(m); console.log(`[analytics-sync] ${m}`); };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  log(`started (dryRun=${dryRun}, trigger=${opts?.trigger ?? "?"})`);

  const { data: accounts } = await supabaseServer
    .from("connected_accounts").select("id, account_name, ig_user_id, access_token");
  if (!accounts || accounts.length === 0) { log("no connected accounts"); return sum; }

  for (const acct of accounts) {
    const accountId = acct.id as number;
    const token = acct.access_token as string;
    const igUserId = acct.ig_user_id as string;
    sum.accounts_checked++;
    try {
      const followers = await getFollowerCount(igUserId, token);
      const media = await getUserMedia(igUserId, token, MEDIA_PER_ACCOUNT);
      if ("error" in media) { log(`account ${accountId}: media list failed — ${media.error}`); sum.errors_count++; continue; }
      sum.instagram_posts_found += media.length;
      log(`account ${accountId} (@${acct.account_name}): ${media.length} IG media, followers=${followers ?? "?"}`);

      // Which of these media are already tracked?
      const mediaIds = media.map(m => m.id);
      const { data: existing } = mediaIds.length
        ? await supabaseServer.from("published_posts").select("id, instagram_media_id").in("instagram_media_id", mediaIds)
        : { data: [] as { id: number; instagram_media_id: string }[] };
      const trackedIds = new Set((existing ?? []).map(e => e.instagram_media_id as string));

      // Open manual-queue items for this account (for recovery matching).
      const { data: manualQ } = await supabaseServer
        .from("content_packages").select("id, caption, package_family, on_screen_text, title")
        .eq("connected_account_id", accountId).eq("manual_only", true).eq("status", "ready");

      // ── Detect NEW posts on Instagram ──────────────────────────────────────
      for (const item of media as IGMediaItem[]) {
        if (trackedIds.has(item.id)) continue;

        // Try to recover a stuck manual-queue item first.
        let matchedPkg: { id: number; sim: number; family: string } | null = null;
        for (const pkg of manualQ ?? []) {
          const sim = similarity(item.caption ?? "", (pkg.caption as string) ?? (pkg.title as string) ?? "");
          if (sim > (matchedPkg?.sim ?? 0)) matchedPkg = { id: pkg.id as number, sim, family: pkg.package_family as string };
        }

        if (matchedPkg && matchedPkg.sim >= MEDIUM_MATCH && matchedPkg.sim < HIGH_MATCH) {
          sum.possible_matches.push({ manual_package_id: matchedPkg.id, instagram_media_id: item.id, similarity: Number(matchedPkg.sim.toFixed(2)), caption: (item.caption ?? "").slice(0, 80) });
          log(`possible manual match: pkg ${matchedPkg.id} ↔ media ${item.id} (sim ${matchedPkg.sim.toFixed(2)})`);
          continue; // medium confidence → needs human confirm, don't create yet
        }

        const lane: ContentLane = matchedPkg && matchedPkg.sim >= HIGH_MATCH
          ? (matchedPkg.family === "streamer_clips" ? "streamer_clips" : "news_media")
          : igLaneFallback(item.media_product_type);
        const resolvedManual = !!(matchedPkg && matchedPkg.sim >= HIGH_MATCH);

        sum.new_posts_created++;
        if (resolvedManual) sum.manual_queue_posts_resolved++;
        log(`NEW post ${item.id} (${item.media_product_type ?? item.media_type})${resolvedManual ? ` — auto-resolved manual pkg ${matchedPkg!.id}` : ""}`);

        if (dryRun) continue;

        const publishedAt = item.timestamp ?? now;
        const { data: pp } = await supabaseServer.from("published_posts").upsert({
          account_id: accountId,
          instagram_media_id: item.id,
          permalink: item.permalink, instagram_permalink: item.permalink,
          media_type: item.media_product_type === "REELS" ? "reel" : "photo",
          media_product_type: item.media_product_type,
          content_lane: lane,
          publish_method: "manual",
          source_type: resolvedManual ? "manual_queue" : "instagram_detected",
          status: "published",
          caption: item.caption,
          media_public_url: item.media_url ?? item.thumbnail_url,
          thumbnail_url: item.thumbnail_url ?? item.media_url,
          viral_checker_status: "missing",
          published_at: publishedAt, detected_at: now,
          auto_detected_from_instagram: true,
          analytics_tracking_status: "tracking",
          next_analytics_sync_at: now,
          updated_at: now,
        }, { onConflict: "instagram_media_id" }).select("id").single();

        if (resolvedManual && matchedPkg) {
          await supabaseServer.from("content_packages")
            .update({ status: "published", linked_ig_post_id: null, updated_at: now })
            .eq("id", matchedPkg.id);
        }
        if (pp) trackedIds.add(item.id);
      }

      if (!dryRun) {
        await supabaseServer.from("connected_accounts")
          .update({ last_media_sync_at: now, followers_count: followers ?? null }).eq("id", accountId);
      }

      // ── Recheck DUE posts (snapshot) ───────────────────────────────────────
      const { data: duePosts } = await supabaseServer
        .from("published_posts").select("id, instagram_media_id, media_type, media_product_type, published_at, next_analytics_sync_at, account_id, sync_error_count")
        .eq("account_id", accountId).eq("analytics_tracking_status", "tracking")
        .or(`next_analytics_sync_at.is.null,next_analytics_sync_at.lte.${now}`)
        .limit(100);

      for (const pp of duePosts ?? []) {
        sum.existing_posts_rechecked++;
        if (dryRun) continue;
        const mlog = createLogger();
        // Reels report "views"; images don't. Fall back to media_type so legacy
        // rows without media_product_type still pull reel metrics.
        const productType = (pp.media_product_type === "REELS" || pp.media_type === "reel") ? "REELS" : "IMAGE";
        const ins = await getMediaInsights(pp.instagram_media_id as string, token, mlog, productType);
        if ("error" in ins) {
          if (ins.code != null && MEDIA_DELETED_CODES.has(ins.code)) {
            // Post gone from Instagram — stop tracking, keep its last snapshot.
            await supabaseServer.from("published_posts").update({ analytics_tracking_status: "complete", status: "deleted_on_instagram", updated_at: now }).eq("id", pp.id);
            log(`post ${pp.id}: deleted on Instagram — tracking stopped`);
          } else {
            // Transient/Meta error — count it, retry next hour, give up after MAX.
            const errCount = ((pp.sync_error_count as number) ?? 0) + 1;
            const giveUp = errCount >= MAX_SYNC_ERRORS;
            await supabaseServer.from("published_posts").update({
              sync_error_count: errCount,
              last_sync_error: ins.error,
              last_analytics_sync_at: now,
              analytics_tracking_status: giveUp ? "error" : "tracking",
              next_analytics_sync_at: giveUp ? null : new Date(nowMs + 3_600_000).toISOString(),
              updated_at: now,
            }).eq("id", pp.id);
            sum.errors_count++;
            log(`post ${pp.id}: sync error (${errCount}/${MAX_SYNC_ERRORS})${giveUp ? " — giving up, marked 'error'" : " — will retry"}: ${ins.error}`);
          }
          continue;
        }
        const publishedMs = pp.published_at ? new Date(pp.published_at as string).getTime() : nowMs;
        const hours = (nowMs - publishedMs) / 3_600_000;
        const likes = ins.likes ?? 0, comments = ins.comments ?? 0, shares = ins.shares ?? 0, saves = ins.saves ?? 0;
        const total = likes + comments + shares + saves;
        await supabaseServer.from("post_metrics_snapshots").insert({
          ig_post_id: null, published_post_id: pp.id, instagram_media_id: pp.instagram_media_id, account_id: accountId,
          captured_at: now, hours_since_publish: Number(hours.toFixed(2)),
          views: ins.views ?? null, reach: ins.reach ?? null, likes, comments, shares, saves,
          total_interactions: total,
          engagement_rate: ins.reach ? Number((total / ins.reach).toFixed(4)) : null,
          views_per_follower: followers && ins.views ? Number((ins.views / followers).toFixed(4)) : null,
          followers_at_capture: followers ?? null,
          raw_insights_json: ins.raw ?? null,
        });
        sum.snapshots_created++;
        await supabaseServer.from("published_posts")
          .update({ last_analytics_sync_at: now, next_analytics_sync_at: nextSyncAt(publishedMs, nowMs), analytics_tracking_status: nextSyncAt(publishedMs, nowMs) ? "tracking" : "complete", sync_error_count: 0, last_sync_error: null, updated_at: now })
          .eq("id", pp.id);
        log(`snapshot post=${pp.id} hours=${hours.toFixed(1)} views=${ins.views ?? "?"} reach=${ins.reach ?? "?"}`);
      }
    } catch (e) {
      sum.errors_count++;
      log(`account ${accountId} threw: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!dryRun) await supabaseServer.from("connected_accounts").update({ last_analytics_sync_at: now }).eq("id", accountId);
  }

  // ── Viral backfill: score posts that never went through the checker ─────────
  const { data: needScore } = await supabaseServer
    .from("published_posts").select("id, account_id, instagram_media_id, media_type, content_lane, caption, hashtags, audio_name, media_public_url, thumbnail_url, published_at")
    .in("viral_checker_status", ["missing"]).limit(MAX_BACKFILLS_PER_RUN);

  for (const pp of needScore ?? []) {
    if (dryRun) { sum.viral_checks_created++; log(`would backfill viral score for post ${pp.id}`); continue; }
    try {
      const contentType = pp.media_type === "reel" ? "reel" : "photo";
      const imageB64 = await getAnalysisImageB64({ contentType, mediaUrl: (pp.thumbnail_url as string) ?? (pp.media_public_url as string) });
      const scored = await scoreContent({
        contentType, lane: (pp.content_lane as ContentLane) ?? "general",
        caption: (pp.caption as string) ?? "", hashtags: (pp.hashtags as string) ?? "", audioNote: (pp.audio_name as string) ?? "",
        accountName: null, imageB64,
      });
      await writeScoreHistory({
        scored, scoreContext: "post_publish_backfill",
        accountId: pp.account_id as number, publishedPostId: pp.id as number, instagramMediaId: pp.instagram_media_id as string,
        contentLane: pp.content_lane as string, mediaType: pp.media_type as string,
        hoursSincePublish: pp.published_at ? (nowMs - new Date(pp.published_at as string).getTime()) / 3_600_000 : null,
      });
      // Set the predicted score on the post so accuracy evals can run (flagged as backfill).
      await supabaseServer.from("published_posts").update({
        predicted_viral_score: scored.viral_score, confidence_score: scored.confidence_score,
        scoring_model_version: "v1.0-rubric", viral_checker_status: "backfilled",
        tracking_status: "tracking", updated_at: now,
      }).eq("id", pp.id);
      sum.viral_checks_created++;
      log(`backfilled viral score post=${pp.id} score=${scored.viral_score}`);
    } catch (e) {
      sum.errors_count++;
      log(`backfill post ${pp.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Refresh prediction-vs-actual evaluations from the new snapshots ─────────
  if (!dryRun) {
    try { const ev = await evaluatePublishedPosts(); log(`evaluations refreshed: ${ev.evaluations}`); }
    catch (e) { log(`evaluation refresh failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  log(`done — accounts=${sum.accounts_checked} found=${sum.instagram_posts_found} new=${sum.new_posts_created} rechecked=${sum.existing_posts_rechecked} snapshots=${sum.snapshots_created} manualResolved=${sum.manual_queue_posts_resolved} backfills=${sum.viral_checks_created} errors=${sum.errors_count}`);
  return sum;
}

// Persist a run row (skipped for dry runs).
export async function recordSyncRun(startedAt: string, sum: SyncSummary, trigger: string): Promise<void> {
  if (sum.status === "dry_run") return;
  try {
    await supabaseServer.from("analytics_sync_runs").insert({
      started_at: startedAt, finished_at: new Date().toISOString(),
      status: sum.errors_count > 0 ? "success" : "success", trigger,
      accounts_checked: sum.accounts_checked, instagram_posts_found: sum.instagram_posts_found,
      new_posts_created: sum.new_posts_created, existing_posts_rechecked: sum.existing_posts_rechecked,
      snapshots_created: sum.snapshots_created, manual_queue_posts_resolved: sum.manual_queue_posts_resolved,
      viral_checks_created: sum.viral_checks_created, errors_count: sum.errors_count,
      details: { possible_matches: sum.possible_matches },
    });
  } catch (e) {
    console.error("[analytics-sync] recordSyncRun failed:", e instanceof Error ? e.message : e);
  }
}
