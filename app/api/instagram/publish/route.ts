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

type PublishBody = {
  image_url: string;
  image_storage_path?: string;
  caption: string;
  account_id?: number;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: PublishBody;
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.image_url?.trim()) {
    return NextResponse.json({ success: false, error: "image_url is required." }, { status: 400 });
  }
  if (!body.caption?.trim()) {
    return NextResponse.json({ success: false, error: "caption is required." }, { status: 400 });
  }

  const log = createLogger();

  // ─── Fetch account (with access_token — service role only) ───────────────
  const accountRes = body.account_id
    ? await supabaseServer
        .from("connected_accounts")
        .select("id, account_name, ig_user_id, access_token")
        .eq("id", body.account_id)
        .single()
    : await supabaseServer
        .from("connected_accounts")
        .select("id, account_name, ig_user_id, access_token")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

  if (accountRes.error || !accountRes.data) {
    return NextResponse.json(
      { success: false, error: "No connected Instagram account found. Connect an account first.", logs: log.all() },
      { status: 400 }
    );
  }

  const account = accountRes.data;
  log.add({
    step: "fetch_account",
    status: "success",
    detail: `Using @${account.account_name} (IG user ID: ${account.ig_user_id})`,
  });

  // ─── Step 1: Create media container ──────────────────────────────────────
  const containerResult = await createMediaContainer(
    account.ig_user_id,
    account.access_token,
    body.image_url,
    body.caption,
    log
  );

  if ("error" in containerResult) {
    await persistJob({
      accountId: account.id, caption: body.caption, imageUrl: body.image_url,
      imagePath: body.image_storage_path, status: "failed", errorMessage: containerResult.error, log,
    });
    return NextResponse.json({ success: false, error: containerResult.error, logs: log.all() }, { status: 502 });
  }

  // ─── Step 2: Poll until FINISHED ─────────────────────────────────────────
  const pollResult = await pollContainerStatus(
    containerResult.containerId,
    account.access_token,
    log
  );

  if ("error" in pollResult) {
    await persistJob({
      accountId: account.id, caption: body.caption, imageUrl: body.image_url,
      imagePath: body.image_storage_path, containerId: containerResult.containerId,
      status: "failed", errorMessage: pollResult.error, log,
    });
    return NextResponse.json({ success: false, error: pollResult.error, logs: log.all() }, { status: 502 });
  }

  // ─── Step 3: Publish ─────────────────────────────────────────────────────
  const publishResult = await publishContainer(
    account.ig_user_id,
    containerResult.containerId,
    account.access_token,
    log
  );

  if ("error" in publishResult) {
    await persistJob({
      accountId: account.id, caption: body.caption, imageUrl: body.image_url,
      imagePath: body.image_storage_path, containerId: containerResult.containerId,
      status: "failed", errorMessage: publishResult.error, log,
    });
    return NextResponse.json({ success: false, error: publishResult.error, logs: log.all() }, { status: 502 });
  }

  // ─── Step 4: Get permalink (non-fatal) ───────────────────────────────────
  const permalinkResult = await getMediaPermalink(publishResult.mediaId, account.access_token, log);
  const permalink = "error" in permalinkResult ? undefined : permalinkResult.permalink;

  // ─── Step 5: Persist to DB ───────────────────────────────────────────────
  const jobId = await persistJob({
    accountId: account.id, caption: body.caption, imageUrl: body.image_url,
    imagePath: body.image_storage_path, containerId: containerResult.containerId,
    mediaId: publishResult.mediaId, permalink, status: "published", log,
  });

  log.add({ step: "save_job", status: "success", detail: `Saved to database (job ID: ${jobId ?? "unknown"})` });

  return NextResponse.json({
    success: true,
    mediaId: publishResult.mediaId,
    permalink,
    jobId,
    logs: log.all(),
  });
}

// ─── DB helper ───────────────────────────────────────────────────────────────

type PersistParams = {
  accountId: number;
  caption: string;
  imageUrl: string;
  imagePath?: string;
  containerId?: string;
  mediaId?: string;
  permalink?: string;
  status: string;
  errorMessage?: string;
  log: PublishLogger;
};

async function persistJob(p: PersistParams): Promise<number | undefined> {
  const { data, error } = await supabaseServer
    .from("publish_jobs")
    .insert({
      account_id: p.accountId,
      caption: p.caption,
      image_url: p.imageUrl,
      image_storage_path: p.imagePath ?? null,
      container_id: p.containerId ?? null,
      media_id: p.mediaId ?? null,
      permalink: p.permalink ?? null,
      status: p.status,
      error_message: p.errorMessage ?? null,
      log_steps: p.log.all(),
      published_at: p.status === "published" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) console.error("[IG Publish] Failed to save job:", error.message);
  return data?.id;
}
