import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { publicUrlFor } from "@/lib/reels/storage";
import { canConvertToDraft } from "@/lib/media-network/compliance";
import type { ContentPackage, MediaBrand } from "@/lib/media-network/types";

// The keystone: an approved package crosses into the EXISTING publishing
// machinery. News/image packages become ig_posts (the proven image
// scheduler/publisher); clip reels become captioned reel_runs (the proven
// reels publisher). canConvertToDraft is the law — checked server-side here,
// never just in the UI.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { package_id?: number; publish_at?: string };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const pkgId = Number(body.package_id);
  if (!Number.isInteger(pkgId) || pkgId < 1) {
    return NextResponse.json({ success: false, error: "package_id is required." }, { status: 400 });
  }

  const { data: pkg } = await supabaseServer.from("content_packages").select("*").eq("id", pkgId).single<ContentPackage>();
  if (!pkg) return NextResponse.json({ success: false, error: "Package not found." }, { status: 404 });
  if (pkg.status !== "ready") {
    return NextResponse.json({ success: false, error: `Package must be approved (ready) first — current status: ${pkg.status}.` }, { status: 400 });
  }
  if (pkg.linked_ig_post_id || pkg.linked_reel_run_id) {
    return NextResponse.json({ success: false, error: "Package was already converted." }, { status: 409 });
  }

  // ── THE GATE ────────────────────────────────────────────────────────────────
  const verdict = canConvertToDraft({
    source_credit_text: pkg.source_credit_text,
    source_urls: pkg.source_urls ?? [],
    rights_status: pkg.rights_status,
    verification_status: pkg.verification_status,
    package_family: pkg.package_family,
    caption: pkg.caption,
  });
  if (!verdict.allowed) {
    return NextResponse.json({ success: false, error: `Compliance gate: ${verdict.blockers.join(" ")}` }, { status: 400 });
  }

  const { data: brand } = await supabaseServer.from("media_brands").select("*").eq("id", pkg.media_brand_id).single<MediaBrand>();
  if (!brand?.connected_account_id) {
    return NextResponse.json({ success: false, error: "Brand has no connected Instagram account — attach one in Brand Network." }, { status: 400 });
  }
  if (!pkg.processed_media_path) {
    return NextResponse.json({ success: false, error: "Package has no media (graphic or processed clip)." }, { status: 400 });
  }

  const publishAt = body.publish_at ? new Date(body.publish_at) : null;
  if (publishAt && Number.isNaN(publishAt.getTime())) {
    return NextResponse.json({ success: false, error: "Invalid publish_at." }, { status: 400 });
  }
  const fullCaption = [pkg.caption, pkg.hashtags].filter(Boolean).join("\n\n");
  const mediaUrl = publicUrlFor(pkg.processed_media_path);
  const now = new Date().toISOString();

  // ── Clip reels → the proven reels publisher ────────────────────────────────
  if (pkg.package_family === "streamer_clips") {
    const scheduledFor = publishAt ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(16, 0, 0, 0); return d; })();
    const { data: run, error: runErr } = await supabaseServer
      .from("reel_runs")
      .insert({
        account_id: brand.connected_account_id,
        status: "captioned",
        brief: { title: pkg.title, beats: [], cover_title: pkg.on_screen_text ?? pkg.title },
        assembled_video_path: pkg.processed_media_path,
        caption: pkg.caption,
        hashtags: pkg.hashtags,
        scheduled_for: scheduledFor.toISOString(),
      })
      .select("id")
      .single();
    if (runErr || !run) return NextResponse.json({ success: false, error: runErr?.message ?? "Could not queue reel run." }, { status: 500 });

    await supabaseServer.from("content_packages")
      .update({ linked_reel_run_id: run.id, status: "scheduled", suggested_publish_time: scheduledFor.toISOString(), updated_at: now })
      .eq("id", pkg.id);

    return NextResponse.json({
      success: true,
      kind: "reel_run",
      reel_run_id: run.id,
      scheduled_for: scheduledFor.toISOString(),
      warnings: verdict.warnings,
    });
  }

  // ── News/image → the existing ig_posts draft/scheduler system ─────────────
  const igStatus = publishAt ? "scheduled" : "draft";
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .insert({
      title: pkg.title,
      caption: fullCaption,
      media_type: "image",
      image_url: mediaUrl,
      account_id: brand.connected_account_id,
      status: igStatus,
      ...(publishAt ? { scheduled_at: publishAt.toISOString(), scheduled_by: "media_network" } : {}),
    })
    .select("id")
    .single();
  if (postErr || !post) return NextResponse.json({ success: false, error: postErr?.message ?? "Could not create draft." }, { status: 500 });

  await supabaseServer.from("content_packages")
    .update({
      linked_ig_post_id: post.id,
      status: publishAt ? "scheduled" : "ready",
      suggested_publish_time: publishAt?.toISOString() ?? pkg.suggested_publish_time,
      updated_at: now,
    })
    .eq("id", pkg.id);

  return NextResponse.json({
    success: true,
    kind: "ig_post",
    ig_post_id: post.id,
    status: igStatus,
    warnings: verdict.warnings,
  });
}
