import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// "I posted it" — the owner confirms a manual-queue package went live. Marks the
// package published and starts analytics tracking. If an instagram_media_id is
// supplied (e.g. confirming a possible match), analytics sync can pull insights;
// otherwise the next hourly sync will attach the media by caption match.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  let body: { package_id?: number; instagram_media_id?: string; permalink?: string };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const pkgId = Number(body.package_id);
  if (!Number.isInteger(pkgId) || pkgId < 1) return NextResponse.json({ success: false, error: "package_id is required." }, { status: 400 });

  const { data: pkg } = await supabaseServer.from("content_packages").select("*").eq("id", pkgId).maybeSingle();
  if (!pkg) return NextResponse.json({ success: false, error: "Package not found." }, { status: 404 });

  const now = new Date().toISOString();
  const lane = pkg.package_family === "streamer_clips" ? "streamer_clips" : "news_media";
  const mediaId = body.instagram_media_id || null;

  await supabaseServer.from("content_packages").update({ status: "published", updated_at: now }).eq("id", pkgId);

  const { data: pp, error } = await supabaseServer.from("published_posts").upsert({
    account_id: pkg.connected_account_id,
    instagram_media_id: mediaId,
    permalink: body.permalink ?? null, instagram_permalink: body.permalink ?? null,
    media_type: pkg.package_family === "streamer_clips" ? "reel" : "photo",
    media_product_type: pkg.package_family === "streamer_clips" ? "REELS" : "FEED",
    content_lane: lane,
    publish_method: "manual", source_type: "manual_queue", status: "published",
    caption: pkg.caption, hashtags: pkg.hashtags,
    media_public_url: pkg.processed_media_path ? null : null,
    viral_checker_status: "missing",
    published_at: now, detected_at: now, manually_confirmed_at: now,
    auto_detected_from_instagram: false,
    analytics_tracking_status: mediaId ? "tracking" : "tracking",
    next_analytics_sync_at: mediaId ? now : null,
    updated_at: now,
  }, { onConflict: "instagram_media_id" }).select("id").single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, published_post_id: pp?.id ?? null, tracking: !!mediaId, note: mediaId ? "Tracking analytics for this post." : "Marked posted — the next hourly sync will match it to the Instagram post by caption and start tracking." });
}
