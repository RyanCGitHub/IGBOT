import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import {
  createLogger,
  createMediaContainer,
  pollContainerStatus,
  publishContainer,
  getMediaPermalink,
  type PublishLogger,
} from "@/lib/instagram";

type Params = { id: string };

// Statuses that allow publishing/republishing
const PUBLISHABLE_STATUSES = new Set([
  "draft", "ready", "failed", "deleted_on_instagram", "deleted_by_dashboard",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId < 1) {
    return NextResponse.json({ success: false, error: "Invalid post id." }, { status: 400 });
  }

  // ── Parse optional account_id override ───────────────────────────────────
  let accountIdOverride: number | undefined;
  try {
    const body = (await request.json()) as { account_id?: number };
    if (body.account_id) accountIdOverride = body.account_id;
  } catch {
    // body is optional
  }

  // ── Fetch ig_post ─────────────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .select("id, caption, image_url, account_id, status, media_id, original_media_id")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
  }

  if (!post.image_url) {
    return NextResponse.json({ success: false, error: "Post has no image — upload an image first." }, { status: 400 });
  }
  if (!post.caption?.trim()) {
    return NextResponse.json({ success: false, error: "Post has no caption." }, { status: 400 });
  }

  if (post.status === "published" || post.status === "republished") {
    return NextResponse.json({ success: false, error: "Post is already published." }, { status: 409 });
  }
  if (post.status === "publishing" || post.status === "republishing") {
    return NextResponse.json({ success: false, error: "Post is already being published." }, { status: 409 });
  }
  if (!PUBLISHABLE_STATUSES.has(post.status)) {
    return NextResponse.json(
      { success: false, error: `Cannot publish a post with status "${post.status}".` },
      { status: 400 }
    );
  }

  const isRepublish =
    post.status === "deleted_on_instagram" ||
    post.status === "deleted_by_dashboard";

  // ── Fetch connected account ───────────────────────────────────────────────
  const resolvedAccountId = accountIdOverride ?? post.account_id;
  const accountRes = resolvedAccountId
    ? await supabaseServer
        .from("connected_accounts")
        .select("id, account_name, ig_user_id, access_token")
        .eq("id", resolvedAccountId)
        .single()
    : await supabaseServer
        .from("connected_accounts")
        .select("id, account_name, ig_user_id, access_token")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

  if (accountRes.error || !accountRes.data) {
    return NextResponse.json(
      { success: false, error: "No connected Instagram account found. Connect an account first." },
      { status: 400 }
    );
  }
  const account = accountRes.data;

  // ── Mark as (re)publishing ────────────────────────────────────────────────
  const inProgressStatus = isRepublish ? "republishing" : "publishing";
  await supabaseServer
    .from("ig_posts")
    .update({ status: inProgressStatus, updated_at: new Date().toISOString() })
    .eq("id", postId);

  const log = createLogger();
  log.add({
    step: "fetch_account",
    status: "success",
    detail: `${isRepublish ? "Republishing" : "Publishing"} as @${account.account_name} (IG user ID: ${account.ig_user_id})`,
  });
  if (isRepublish) {
    log.add({
      step: "republish_context",
      status: "info",
      detail: `Republishing post that was deleted on Instagram (old media_id: ${post.media_id ?? "unknown"})`,
    });
  }

  // ── Create media container ────────────────────────────────────────────────
  const containerResult = await createMediaContainer(
    account.ig_user_id,
    account.access_token,
    post.image_url,
    post.caption,
    log
  );

  if ("error" in containerResult) {
    await failPost(postId, containerResult.error, isRepublish, log);
    return NextResponse.json({ success: false, error: containerResult.error, logs: log.all() }, { status: 502 });
  }

  // ── Poll until FINISHED ───────────────────────────────────────────────────
  const pollResult = await pollContainerStatus(
    containerResult.containerId,
    account.access_token,
    log
  );

  if ("error" in pollResult) {
    await failPost(postId, pollResult.error, isRepublish, log);
    return NextResponse.json({ success: false, error: pollResult.error, logs: log.all() }, { status: 502 });
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  const publishResult = await publishContainer(
    account.ig_user_id,
    containerResult.containerId,
    account.access_token,
    log
  );

  if ("error" in publishResult) {
    await failPost(postId, publishResult.error, isRepublish, log);
    return NextResponse.json({ success: false, error: publishResult.error, logs: log.all() }, { status: 502 });
  }

  // ── Permalink (non-fatal) ─────────────────────────────────────────────────
  const permalinkResult = await getMediaPermalink(publishResult.mediaId, account.access_token, log);
  const permalink = "error" in permalinkResult ? undefined : permalinkResult.permalink;

  // ── Persist publish_job ───────────────────────────────────────────────────
  const jobId = await persistJob({
    accountId: account.id,
    caption: post.caption,
    imageUrl: post.image_url,
    containerId: containerResult.containerId,
    mediaId: publishResult.mediaId,
    permalink,
    log,
  });

  log.add({ step: "save_job", status: "success", detail: `Publish job saved (ID: ${jobId ?? "unknown"})` });

  // ── Update ig_post ────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const successStatus = isRepublish ? "republished" : "published";

  const updatePayload: Record<string, unknown> = {
    status: successStatus,
    media_id: publishResult.mediaId,
    permalink: permalink ?? null,
    publish_job_id: jobId ?? null,
    published_at: now,
    updated_at: now,
    error_message: null,
    sync_error_message: null,
    deleted_detected_at: null,
    deleted_at: null,
  };

  if (isRepublish) {
    // Preserve the very first media_id as original_media_id
    updatePayload.original_media_id = post.original_media_id ?? post.media_id;
    // Record which deleted media_id we're republishing from
    updatePayload.republished_from_media_id = post.media_id;
    log.add({
      step: "republish_ids",
      status: "info",
      detail: `original_media_id preserved as ${updatePayload.original_media_id ?? "none"} | republished_from: ${post.media_id ?? "none"} | new: ${publishResult.mediaId}`,
    });
  }

  await supabaseServer
    .from("ig_posts")
    .update(updatePayload)
    .eq("id", postId);

  log.add({ step: "update_ig_post", status: "success", detail: `ig_post ${postId} marked ${successStatus}` });

  return NextResponse.json({
    success: true,
    mediaId: publishResult.mediaId,
    permalink,
    jobId,
    isRepublish,
    logs: log.all(),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function failPost(postId: number, errorMessage: string, wasRepublish: boolean, log: PublishLogger) {
  await supabaseServer
    .from("ig_posts")
    .update({
      status: "failed",
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  log.add({
    step: "fail_post",
    status: "error",
    detail: `ig_post ${postId} marked failed (${wasRepublish ? "re" : ""}publish attempt): ${errorMessage}`,
  });
}

type PersistParams = {
  accountId: number;
  caption: string;
  imageUrl: string;
  containerId?: string;
  mediaId: string;
  permalink?: string;
  log: PublishLogger;
};

async function persistJob(p: PersistParams): Promise<number | undefined> {
  const { data, error } = await supabaseServer
    .from("publish_jobs")
    .insert({
      account_id: p.accountId,
      caption: p.caption,
      image_url: p.imageUrl,
      container_id: p.containerId ?? null,
      media_id: p.mediaId,
      permalink: p.permalink ?? null,
      status: "published",
      log_steps: p.log.all(),
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) console.error("[IG Publish] Failed to save publish_job:", error.message);
  return data?.id;
}
