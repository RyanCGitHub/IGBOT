import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type Params = { id: string };

type GraphErrorCode = 100 | 803 | 190 | 32 | 4;

type GraphMediaResponse = {
  id?: string;
  media_type?: string;
  error?: {
    code: number;
    message: string;
    type?: string;
    error_subcode?: number;
  };
};

// Error codes that confirm the media was deleted from Instagram
const DELETED_CODES = new Set([100, 803]);
// Auth errors — don't change status, just record
const AUTH_ERROR_CODES = new Set([190]);
// Rate-limit codes
const RATE_LIMIT_CODES = new Set([32, 4]);

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

  // ── Fetch ig_post ─────────────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .select("id, status, media_id, account_id")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
  }

  if (!post.media_id) {
    return NextResponse.json(
      { success: false, error: "Post has no media_id — cannot sync." },
      { status: 400 }
    );
  }

  if (post.status !== "published" && post.status !== "republished") {
    return NextResponse.json(
      { success: false, error: `Only published/republished posts can be synced (current: ${post.status}).` },
      { status: 400 }
    );
  }

  // ── Fetch connected account (service role) ────────────────────────────────
  const accountRes = post.account_id
    ? await supabaseServer
        .from("connected_accounts")
        .select("id, access_token")
        .eq("id", post.account_id)
        .single()
    : await supabaseServer
        .from("connected_accounts")
        .select("id, access_token")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

  if (accountRes.error || !accountRes.data) {
    return NextResponse.json(
      { success: false, error: "No connected account found." },
      { status: 400 }
    );
  }
  const { access_token } = accountRes.data;

  // ── Call Graph API ────────────────────────────────────────────────────────
  const graphUrl = `https://graph.facebook.com/v21.0/${post.media_id}?fields=id,media_type&access_token=${access_token}`;
  const now = new Date().toISOString();

  let graphBody: GraphMediaResponse;
  try {
    const res = await fetch(graphUrl);
    graphBody = (await res.json()) as GraphMediaResponse;
  } catch (e) {
    await supabaseServer
      .from("ig_posts")
      .update({
        last_instagram_sync_at: now,
        sync_error_message: `Network error contacting Graph API: ${e instanceof Error ? e.message : String(e)}`,
        updated_at: now,
      })
      .eq("id", postId);

    return NextResponse.json({ success: false, error: "Network error reaching Graph API.", result: "error" });
  }

  // ── Classify response ─────────────────────────────────────────────────────
  if (graphBody.id) {
    // Post is still live on Instagram
    await supabaseServer
      .from("ig_posts")
      .update({
        last_instagram_sync_at: now,
        sync_error_message: null,
        updated_at: now,
      })
      .eq("id", postId);

    return NextResponse.json({ success: true, result: "still_published", mediaId: graphBody.id });
  }

  const code = graphBody.error?.code as GraphErrorCode | undefined;

  if (code !== undefined && DELETED_CODES.has(code)) {
    // Media not found → deleted on Instagram
    await supabaseServer
      .from("ig_posts")
      .update({
        status: "deleted_on_instagram",
        deleted_detected_at: now,
        last_instagram_sync_at: now,
        sync_error_message: null,
        updated_at: now,
      })
      .eq("id", postId);

    return NextResponse.json({
      success: true,
      result: "deleted_on_instagram",
      errorCode: code,
      errorMessage: graphBody.error?.message,
    });
  }

  if (code !== undefined && (AUTH_ERROR_CODES.has(code) || RATE_LIMIT_CODES.has(code))) {
    // Auth/rate-limit: don't change post status, just record the error
    const syncErrorMsg = `Graph API error ${code}: ${graphBody.error?.message ?? "unknown"}`;
    await supabaseServer
      .from("ig_posts")
      .update({
        last_instagram_sync_at: now,
        sync_error_message: syncErrorMsg,
        updated_at: now,
      })
      .eq("id", postId);

    return NextResponse.json({
      success: false,
      result: "error",
      errorCode: code,
      error: syncErrorMsg,
    });
  }

  // Unknown error — record but don't change status
  const unknownMsg = `Graph API error: ${graphBody.error?.message ?? "no id returned, no known error code"}`;
  await supabaseServer
    .from("ig_posts")
    .update({
      last_instagram_sync_at: now,
      sync_error_message: unknownMsg,
      updated_at: now,
    })
    .eq("id", postId);

  return NextResponse.json({ success: false, result: "error", error: unknownMsg });
}
