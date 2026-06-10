import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type Params = { id: string };

// Statuses that have a live Instagram media object we can attempt to delete
const DELETABLE_STATUSES = new Set(["published", "republished"]);

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

  if (!DELETABLE_STATUSES.has(post.status)) {
    return NextResponse.json(
      {
        success: false,
        error: `Only published or republished posts can be deleted from Instagram (current status: "${post.status}").`,
      },
      { status: 400 }
    );
  }

  if (!post.media_id) {
    return NextResponse.json(
      { success: false, error: "Post has no media_id — cannot delete from Instagram." },
      { status: 400 }
    );
  }

  // ── Fetch connected account (server-side only — access_token never leaves here) ──
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
      { success: false, error: "No connected Instagram account found." },
      { status: 400 }
    );
  }

  const { access_token } = accountRes.data;

  // ── Call Graph API DELETE ─────────────────────────────────────────────────
  // DELETE /v21.0/{ig-media-id}?access_token=...
  // Returns { "success": true } on success, or an error object.
  const graphUrl = `https://graph.facebook.com/v21.0/${post.media_id}`;

  let graphBody: { success?: boolean; error?: { code: number; message: string; type?: string } };
  try {
    const res = await fetch(graphUrl, {
      method: "DELETE",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token }),
    });
    graphBody = await res.json();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: `Network error reaching Instagram API: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  // ── Handle Graph API errors ───────────────────────────────────────────────
  if (graphBody.error) {
    const { code, message } = graphBody.error;
    // Code 100: media doesn't exist (already deleted on Instagram) — treat as success
    if (code === 100 || code === 803) {
      // It's already gone from Instagram — mark accordingly
      const now = new Date().toISOString();
      await supabaseServer
        .from("ig_posts")
        .update({
          status: "deleted_by_dashboard",
          deleted_at: now,
          updated_at: now,
          sync_error_message: null,
          deleted_detected_at: null,
        })
        .eq("id", postId);

      return NextResponse.json({
        success: true,
        note: "Media was already deleted on Instagram — post marked deleted_by_dashboard.",
      });
    }

    // Code 10 / 200: permission error
    if (code === 10 || code === 200) {
      return NextResponse.json(
        {
          success: false,
          error: `Instagram does not allow deleting this media (permission denied). Error ${code}: ${message}`,
        },
        { status: 403 }
      );
    }

    // All other Graph errors — do not change post status
    return NextResponse.json(
      { success: false, error: `Instagram API error ${code}: ${message}` },
      { status: 502 }
    );
  }

  if (!graphBody.success) {
    return NextResponse.json(
      { success: false, error: "Instagram API returned an unexpected response — post not deleted." },
      { status: 502 }
    );
  }

  // ── Success — update post record ──────────────────────────────────────────
  const now = new Date().toISOString();
  await supabaseServer
    .from("ig_posts")
    .update({
      status: "deleted_by_dashboard",
      deleted_at: now,
      updated_at: now,
      sync_error_message: null,
    })
    .eq("id", postId);

  return NextResponse.json({ success: true, deletedMediaId: post.media_id });
}
