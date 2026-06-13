// Performance feedback loop (plan Phase 7): reconciles package statuses with
// the publishers and refreshes performance_tags from the EXISTING insights
// system. Called by the measure cron — no parallel analytics machinery.

import { supabaseServer } from "@/lib/supabase-server";
import type { ContentPackage } from "@/lib/media-network/types";

export async function reconcileMediaNetwork(): Promise<{ reconciled: number; tagged: number }> {
  let reconciled = 0;
  let tagged = 0;

  // ── 1. Clip packages: adopt the reel run's outcome ──────────────────────────
  const { data: runPkgs } = await supabaseServer
    .from("content_packages")
    .select("id, linked_reel_run_id, status")
    .not("linked_reel_run_id", "is", null)
    .in("status", ["scheduled"])
    .limit(50);

  for (const pkg of runPkgs ?? []) {
    const { data: run } = await supabaseServer
      .from("reel_runs")
      .select("status, ig_post_id")
      .eq("id", pkg.linked_reel_run_id as number)
      .maybeSingle();
    if (!run) continue;
    if (run.status === "published" && run.ig_post_id) {
      await supabaseServer.from("content_packages")
        .update({ linked_ig_post_id: run.ig_post_id, status: "published", updated_at: new Date().toISOString() })
        .eq("id", pkg.id);
      reconciled++;
    } else if (run.status === "failed") {
      await supabaseServer.from("content_packages")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pkg.id);
      reconciled++;
    }
  }

  // ── 2. News packages: follow the ig_post status ─────────────────────────────
  const { data: postPkgs } = await supabaseServer
    .from("content_packages")
    .select("id, linked_ig_post_id, status")
    .not("linked_ig_post_id", "is", null)
    .in("status", ["ready", "scheduled"])
    .limit(50);

  for (const pkg of postPkgs ?? []) {
    const { data: post } = await supabaseServer
      .from("ig_posts")
      .select("status")
      .eq("id", pkg.linked_ig_post_id as number)
      .maybeSingle();
    if (post?.status === "published" || post?.status === "republished") {
      await supabaseServer.from("content_packages")
        .update({ status: "published", updated_at: new Date().toISOString() })
        .eq("id", pkg.id);
      reconciled++;
    } else if (post?.status === "failed") {
      await supabaseServer.from("content_packages")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pkg.id);
      reconciled++;
    }
  }

  // ── 3. performance_tags for published packages (metrics join) ──────────────
  const { data: published } = await supabaseServer
    .from("content_packages")
    .select("*")
    .eq("status", "published")
    .not("linked_ig_post_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  for (const pkg of (published ?? []) as ContentPackage[]) {
    const { data: insights } = await supabaseServer
      .from("post_insights")
      .select("reach, likes, comments, saves, shares")
      .eq("post_id", pkg.linked_ig_post_id as number)
      .maybeSingle();
    const { data: post } = await supabaseServer
      .from("ig_posts")
      .select("published_at")
      .eq("id", pkg.linked_ig_post_id as number)
      .maybeSingle();

    // Dimensional context from the source item.
    let topic: string | null = null;
    let streamerName: string | null = null;
    let cityOrRegion: string | null = null;
    let momentType: string | null = null;
    if (pkg.source_news_item_id) {
      const { data: news } = await supabaseServer
        .from("news_items")
        .select("category, city_or_region")
        .eq("id", pkg.source_news_item_id)
        .maybeSingle();
      topic = news?.category ?? null;
      cityOrRegion = news?.city_or_region ?? null;
    }
    if (pkg.source_clip_asset_id) {
      const { data: clip } = await supabaseServer
        .from("clip_assets")
        .select("streamer_name, game_or_category, clip_moment_type")
        .eq("id", pkg.source_clip_asset_id)
        .maybeSingle();
      streamerName = clip?.streamer_name ?? null;
      topic = topic ?? clip?.game_or_category ?? null;
      momentType = clip?.clip_moment_type ?? null;
    }

    const likes = insights?.likes ?? null;
    const comments = insights?.comments ?? null;
    const saves = insights?.saves ?? null;
    const shares = insights?.shares ?? null;
    const reach = insights?.reach ?? null;
    const engagementRate =
      reach && reach > 0
        ? Number((((likes ?? 0) + (comments ?? 0) + (saves ?? 0) + (shares ?? 0)) / reach).toFixed(4))
        : null;

    const { error } = await supabaseServer.from("performance_tags").upsert(
      {
        content_package_id: pkg.id,
        media_brand_id: pkg.media_brand_id,
        topic,
        streamer_name: streamerName,
        city_or_region: cityOrRegion,
        format: pkg.package_type,
        hook_style: pkg.hook ? pkg.hook.split(/\s+/).slice(0, 3).join(" ") : null,
        moment_type: momentType,
        posted_at: post?.published_at ?? null,
        reach, likes, comments, saves, shares,
        engagement_rate: engagementRate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "content_package_id" }
    );
    if (!error) tagged++;
  }

  return { reconciled, tagged };
}
