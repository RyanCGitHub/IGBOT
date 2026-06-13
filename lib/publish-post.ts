// Shared publish logic used by both the manual publish route and the scheduler.
// Returns a typed result instead of an HTTP response so callers decide how to surface it.

import { supabaseServer } from "@/lib/supabase-server";
import { prePublishGate } from "@/lib/viral/gate";
import {
  createLogger,
  createMediaContainer,
  pollContainerStatus,
  publishContainer,
  getMediaPermalink,
  type LogEntry,
  type PublishLogger,
} from "@/lib/instagram";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PublishResult =
  | {
      success: true;
      mediaId: string;
      permalink: string | undefined;
      jobId: number | undefined;
      isRepublish: boolean;
      logs: LogEntry[];
    }
  | {
      success: false;
      error: string;
      // Hint for the HTTP layer — not used by the scheduler
      httpStatus: 400 | 401 | 404 | 409 | 502;
      logs: LogEntry[];
    }
  | {
      // Held by the pre-publish viral gate — not a failure, not a success.
      success: false;
      held: true;
      error: string;
      viralScore: number | null;
      logs: LogEntry[];
    };

export type PublishOptions = {
  accountIdOverride?: number;
  isScheduled?: boolean;
};

// ─── Publishable statuses ─────────────────────────────────────────────────────

const PUBLISHABLE_STATUSES = new Set([
  "draft", "ready", "failed",
  "scheduled",
  "deleted_on_instagram", "deleted_by_dashboard",
]);

// ─── Main function ────────────────────────────────────────────────────────────

export async function publishIgPost(
  postId: number,
  options: PublishOptions = {}
): Promise<PublishResult> {
  const { accountIdOverride, isScheduled = false } = options;

  // ── Fetch post ──────────────────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .select("id, caption, image_url, account_id, status, media_id, original_media_id, media_type, gate_override")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return err("Post not found.", 404);
  }
  if (post.media_type === "reel") {
    // Reels are produced and published by the reels pipeline (reel_runs +
    // /api/reels/tick) — this image container flow would corrupt them.
    return err("This is a Reel — it is published by the Reels pipeline, not the image publisher.", 400);
  }
  if (!post.image_url) {
    return err("Post has no image — upload an image first.", 400);
  }
  if (!post.caption?.trim()) {
    return err("Post has no caption.", 400);
  }
  if (post.status === "published" || post.status === "republished") {
    return err("Post is already published.", 409);
  }
  if (post.status === "publishing" || post.status === "republishing") {
    return err("Post is already being published.", 409);
  }
  if (!PUBLISHABLE_STATUSES.has(post.status)) {
    return err(`Cannot publish a post with status "${post.status}".`, 400);
  }

  const isRepublish =
    post.status === "deleted_on_instagram" ||
    post.status === "deleted_by_dashboard";

  // ── Resolve the account ─────────────────────────────────────────────────────
  // Priority: explicit override → the post's assigned account.
  // We never silently pick a "default" account when multiple accounts exist.
  const resolvedAccountId = accountIdOverride ?? post.account_id;

  let account: { id: number; account_name: string; ig_user_id: string; access_token: string };

  if (resolvedAccountId) {
    // A specific account is assigned (or was passed as an override) — use exactly that one.
    const accountRes = await supabaseServer
      .from("connected_accounts")
      .select("id, account_name, ig_user_id, access_token")
      .eq("id", resolvedAccountId)
      .single();

    if (accountRes.error || !accountRes.data) {
      return err(
        "The Instagram account assigned to this post is no longer connected. Reconnect it or assign a different account.",
        400
      );
    }
    account = accountRes.data;
  } else {
    // No account assigned — only fall back when exactly ONE account is connected.
    const allRes = await supabaseServer
      .from("connected_accounts")
      .select("id, account_name, ig_user_id, access_token")
      .order("created_at", { ascending: false });

    if (allRes.error) {
      return err("Could not look up connected Instagram accounts.", 502);
    }

    const all = allRes.data ?? [];
    if (all.length === 0) {
      return err("No Instagram account connected.", 400);
    }
    if (all.length > 1) {
      // Multiple accounts exist — refuse to guess which one to post to.
      return err("No Instagram account assigned to this post.", 400);
    }
    account = all[0]; // exactly one connected account → safe backward-compatible fallback
  }

  // ── Pre-publish viral gate ──────────────────────────────────────────────────
  // Always scores + records; holds only if the gate is enabled and the score is
  // below the threshold (and the owner hasn't overridden). Fails OPEN.
  {
    const override = !!post.gate_override;
    try {
      const gate = await prePublishGate({
        kind: "ig_post",
        id: postId,
        accountId: account.id,
        contentType: "photo",
        caption: post.caption ?? "",
        mediaUrl: post.image_url,
        override,
      });
      if (override) {
        await supabaseServer.from("ig_posts").update({ gate_override: false, updated_at: new Date().toISOString() }).eq("id", postId);
      }
      if (!gate.allow) {
        await supabaseServer.from("ig_posts")
          .update({ status: "held_review", updated_at: new Date().toISOString() })
          .eq("id", postId);
        console.log(`[publish] post ${postId} HELD by viral gate (score ${gate.viral_score})`);
        return { success: false, held: true, error: `Held by viral gate — score ${gate.viral_score}.`, viralScore: gate.viral_score, logs: [] };
      }
    } catch (e) {
      // The gate must never block a publish on its own error.
      console.error(`[publish] viral gate errored for post ${postId} — publishing anyway:`, e instanceof Error ? e.message : e);
    }
  }

  // Safe log — account name + ig_user_id only, never the token.
  console.log(
    `[publish] post ${postId} → publishing as @${account.account_name} (ig_user_id ${account.ig_user_id})`
  );

  // Prefix failure messages with the account so logs/UI make the target obvious.
  const withAccount = (msg: string) => `${msg} (account: @${account.account_name})`;

  // ── Mark in-progress ────────────────────────────────────────────────────────
  const inProgressStatus = isRepublish ? "republishing" : "publishing";
  await supabaseServer
    .from("ig_posts")
    .update({ status: inProgressStatus, updated_at: new Date().toISOString() })
    .eq("id", postId);

  const log = createLogger();
  log.add({
    step: "fetch_account",
    status: "success",
    detail: [
      isRepublish ? "Republishing" : isScheduled ? "Scheduled publish" : "Publishing",
      `as @${account.account_name} (IG user ${account.ig_user_id})`,
    ].join(" "),
  });
  if (isRepublish) {
    log.add({
      step: "republish_context",
      status: "info",
      detail: `Republishing — old media_id: ${post.media_id ?? "unknown"}`,
    });
  }
  if (isScheduled) {
    log.add({ step: "scheduler", status: "info", detail: `Published by scheduler for post ${postId}` });
  }

  // ── Create container ────────────────────────────────────────────────────────
  const containerResult = await createMediaContainer(
    account.ig_user_id, account.access_token, post.image_url, post.caption, log
  );
  if ("error" in containerResult) {
    const msg = withAccount(containerResult.error);
    await failPost(postId, msg, log);
    return { success: false, error: msg, httpStatus: 502, logs: log.all() };
  }

  // ── Poll ────────────────────────────────────────────────────────────────────
  const pollResult = await pollContainerStatus(containerResult.containerId, account.access_token, log);
  if ("error" in pollResult) {
    const msg = withAccount(pollResult.error);
    await failPost(postId, msg, log);
    return { success: false, error: msg, httpStatus: 502, logs: log.all() };
  }

  // ── Publish ─────────────────────────────────────────────────────────────────
  const publishResult = await publishContainer(
    account.ig_user_id, containerResult.containerId, account.access_token, log
  );
  if ("error" in publishResult) {
    const msg = withAccount(publishResult.error);
    await failPost(postId, msg, log);
    return { success: false, error: msg, httpStatus: 502, logs: log.all() };
  }

  // ── Permalink (non-fatal) ───────────────────────────────────────────────────
  const permalinkResult = await getMediaPermalink(publishResult.mediaId, account.access_token, log);
  const permalink = "error" in permalinkResult ? undefined : permalinkResult.permalink;

  // ── Persist publish_job ─────────────────────────────────────────────────────
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

  // ── Update ig_post ──────────────────────────────────────────────────────────
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
    schedule_error_message: null,
  };

  if (isScheduled) {
    updatePayload.published_by_scheduler = true;
  }

  if (isRepublish) {
    updatePayload.original_media_id = post.original_media_id ?? post.media_id;
    updatePayload.republished_from_media_id = post.media_id;
    log.add({
      step: "republish_ids",
      status: "info",
      detail: `original: ${updatePayload.original_media_id ?? "none"} | from: ${post.media_id ?? "none"} | new: ${publishResult.mediaId}`,
    });
  }

  await supabaseServer.from("ig_posts").update(updatePayload).eq("id", postId);
  log.add({ step: "update_ig_post", status: "success", detail: `ig_post ${postId} → ${successStatus}` });

  return { success: true, mediaId: publishResult.mediaId, permalink, jobId, isRepublish, logs: log.all() };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function err(
  message: string,
  httpStatus: 400 | 401 | 404 | 409 | 502
): PublishResult & { success: false } {
  return { success: false, error: message, httpStatus, logs: [] };
}

async function failPost(postId: number, errorMessage: string, log: PublishLogger) {
  await supabaseServer
    .from("ig_posts")
    .update({ status: "failed", error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", postId);
  log.add({ step: "fail_post", status: "error", detail: `ig_post ${postId} → failed: ${errorMessage}` });
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
