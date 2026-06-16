import { supabaseServer } from "@/lib/supabase-server";
import { publicUrlFor } from "@/lib/reels/storage";
import { canConvertToDraft } from "@/lib/media-network/compliance";
import { buildNewsPackage } from "@/lib/media-network/news-package";
import type { MediaBrand, NewsItem } from "@/lib/media-network/types";

// News auto-pilot: the single-gate flow. When the owner marks a news item
// "approved", this worker (run by the process-approved cron) does the rest —
// generate the package, auto-approve it, and schedule it into the next open
// posting slot. The existing process-scheduled publisher then posts it,
// re-checking spacing at publish time. Every compliance gate stays in force:
// anything that can't pass canConvertToDraft is PARKED, never published.
//
// Scope guards (intentional, owner-confirmed):
//   • Only brands with auto_publish = true and an attached account.
//   • HIGH-sensitivity items are excluded — they stay a manual publish.
//   • Compliance blocks park the package for review instead of going live.

const MAX_ITEMS_PER_RUN = 8;
const DEFAULT_SPACING_MIN = 90;

export type AutoPilotSummary = {
  brandsChecked: number;
  itemsConsidered: number;
  scheduled: number;
  parked: number;
  failed: number;
  details: string[];
};

// The next free moment for this account that still honors posting spacing:
// at least `spacingMin` after both the latest already-scheduled post AND the
// last published post. Re-queried per item, so a batch self-spaces.
async function nextOpenSlot(accountId: number, spacingMin: number): Promise<Date> {
  let earliest = Date.now();
  const spacingMs = spacingMin * 60_000;

  const { data: sched } = await supabaseServer
    .from("ig_posts")
    .select("scheduled_at")
    .eq("account_id", accountId)
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sched?.scheduled_at) {
    earliest = Math.max(earliest, new Date(sched.scheduled_at).getTime() + spacingMs);
  }

  const { data: pub } = await supabaseServer
    .from("ig_posts")
    .select("published_at")
    .eq("account_id", accountId)
    .in("status", ["published", "republished"])
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pub?.published_at) {
    earliest = Math.max(earliest, new Date(pub.published_at).getTime() + spacingMs);
  }

  return new Date(earliest);
}

// Aim for ~50/50 image posts vs Reels. Pick whichever the brand currently has
// FEWER of among its scheduled/published news content — self-balances over time.
async function pickNewsContentType(brandId: number): Promise<"breaking_news_reel" | "image_headline_post"> {
  const { data } = await supabaseServer
    .from("content_packages").select("package_type")
    .eq("media_brand_id", brandId).eq("package_family", "news_media")
    .in("status", ["scheduled", "published"]).limit(500);
  const reels = (data ?? []).filter(p => p.package_type === "breaking_news_reel").length;
  const images = (data ?? []).length - reels;
  return reels <= images ? "breaking_news_reel" : "image_headline_post";
}

function spacingFor(brand: Pick<MediaBrand, "min_minutes_between_posts">): number {
  let mins = brand.min_minutes_between_posts || DEFAULT_SPACING_MIN;
  const floor = Number(process.env.POSTS_MIN_SPACING_MINUTES);
  if (Number.isFinite(floor) && floor > mins) mins = floor;
  return mins;
}

export async function runNewsAutoPilot(): Promise<AutoPilotSummary> {
  const summary: AutoPilotSummary = {
    brandsChecked: 0, itemsConsidered: 0, scheduled: 0, parked: 0, failed: 0, details: [],
  };

  // Brands opted into auto-publish, news family, active, with an account.
  const { data: brands } = await supabaseServer
    .from("media_brands")
    .select("*")
    .eq("brand_type", "news_media")
    .eq("auto_publish", true)
    .eq("status", "active");

  const autoBrands = (brands ?? []).filter(b => b.connected_account_id != null) as MediaBrand[];
  summary.brandsChecked = autoBrands.length;
  if (autoBrands.length === 0) return summary;

  const brandById = new Map(autoBrands.map(b => [b.id, b]));

  // Approved items for those brands — oldest first, bounded batch. HIGH-
  // sensitivity items are included ONLY once the owner has explicitly approved
  // them via "Approve & Auto-Publish" (status="approved" is the consent gate;
  // the desk warns before that button is used).
  const { data: items } = await supabaseServer
    .from("news_items")
    .select("*")
    .in("media_brand_id", autoBrands.map(b => b.id))
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .limit(MAX_ITEMS_PER_RUN);

  const queue = (items ?? []) as NewsItem[];
  summary.itemsConsidered = queue.length;

  for (const item of queue) {
    const brand = brandById.get(item.media_brand_id);
    if (!brand?.connected_account_id) continue;

    const contentType = await pickNewsContentType(item.media_brand_id);
    let built;
    try {
      built = await buildNewsPackage(item.id, contentType);
    } catch (e) {
      summary.failed++;
      await markItemNeedsReview(item.id, `auto-pilot generation threw: ${e instanceof Error ? e.message : String(e)}`);
      summary.details.push(`item ${item.id}: generation threw — sent to needs_review`);
      continue;
    }

    if (!built.ok) {
      summary.failed++;
      await markItemNeedsReview(item.id, `auto-pilot could not build package: ${built.error}`);
      summary.details.push(`item ${item.id}: ${built.error} — sent to needs_review`);
      continue;
    }

    const pkg = built.package;
    const wantReel = pkg.package_type === "breaking_news_reel";

    // Generation parked it (compliance blocked) or rendered no usable media.
    if (pkg.status !== "draft" || !pkg.processed_media_path || (wantReel && !pkg.manual_video_path)) {
      summary.parked++;
      summary.details.push(`pkg ${pkg.id}: parked (${pkg.status}${pkg.processed_media_path ? "" : ", no media"}${wantReel && !pkg.manual_video_path ? ", no reel video" : ""}) — review in Packages`);
      continue;
    }

    // The publish gate — single-sourced with the manual convert-to-draft route.
    const verdict = canConvertToDraft({
      source_credit_text: pkg.source_credit_text,
      source_urls: pkg.source_urls ?? [],
      rights_status: pkg.rights_status,
      verification_status: pkg.verification_status,
      package_family: pkg.package_family,
      caption: pkg.caption,
    });
    if (!verdict.allowed) {
      summary.parked++;
      const note = `Auto-pilot held: ${verdict.blockers.join(" ")}`;
      await supabaseServer.from("content_packages")
        .update({ compliance_notes: [pkg.compliance_notes, note].filter(Boolean).join("\n"), updated_at: new Date().toISOString() })
        .eq("id", pkg.id);
      summary.details.push(`pkg ${pkg.id}: ${verdict.blockers.join(" ")} — parked`);
      continue;
    }

    // Schedule into the next open, spacing-respecting slot.
    const slot = await nextOpenSlot(brand.connected_account_id, spacingFor(brand));
    const now = new Date().toISOString();

    if (wantReel) {
      // News Reel → the proven reels pipeline (publishes via the REELS Graph API
      // endpoint, saves the IG media id, and tracks analytics).
      const { data: run, error: runErr } = await supabaseServer
        .from("reel_runs")
        .insert({
          account_id: brand.connected_account_id,
          status: "captioned",
          brief: { title: pkg.title, beats: [], cover_title: pkg.on_screen_text ?? pkg.title },
          assembled_video_path: pkg.manual_video_path,   // the 9:16 motion video
          cover_path: pkg.processed_media_path,           // the still as the cover
          caption: pkg.caption,
          hashtags: pkg.hashtags,
          scheduled_for: slot.toISOString(),
        })
        .select("id")
        .single();
      if (runErr || !run) {
        summary.failed++;
        summary.details.push(`pkg ${pkg.id}: reel_run insert failed — ${runErr?.message ?? "unknown"}`);
        continue;
      }
      await supabaseServer.from("content_packages")
        .update({ linked_reel_run_id: run.id, status: "scheduled", suggested_publish_time: slot.toISOString(), updated_at: now })
        .eq("id", pkg.id);
      summary.scheduled++;
      summary.details.push(`pkg ${pkg.id} → REEL run ${run.id} scheduled ${slot.toISOString()}`);
      continue;
    }

    // Image post → the existing image publisher.
    const fullCaption = [pkg.caption, pkg.hashtags].filter(Boolean).join("\n\n");
    const { data: post, error: postErr } = await supabaseServer
      .from("ig_posts")
      .insert({
        title: pkg.title,
        caption: fullCaption,
        media_type: "image",
        image_url: publicUrlFor(pkg.processed_media_path),
        account_id: brand.connected_account_id,
        status: "scheduled",
        scheduled_at: slot.toISOString(),
        scheduled_by: "media_network_auto",
      })
      .select("id")
      .single();

    if (postErr || !post) {
      summary.failed++;
      summary.details.push(`pkg ${pkg.id}: scheduling insert failed — ${postErr?.message ?? "unknown"}`);
      continue;
    }

    await supabaseServer.from("content_packages")
      .update({ linked_ig_post_id: post.id, status: "scheduled", suggested_publish_time: slot.toISOString(), updated_at: now })
      .eq("id", pkg.id);

    summary.scheduled++;
    summary.details.push(`pkg ${pkg.id} → ig_post ${post.id} scheduled ${slot.toISOString()}`);
  }

  return summary;
}

// A package that auto-pilot couldn't build/publish goes back to the owner
// rather than silently retrying forever each tick.
async function markItemNeedsReview(itemId: number, note: string): Promise<void> {
  await supabaseServer
    .from("news_items")
    .update({ status: "needs_review", review_note: note, updated_at: new Date().toISOString() })
    .eq("id", itemId);
}
