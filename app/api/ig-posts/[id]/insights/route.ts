import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { createLogger, getMediaInsights } from "@/lib/instagram";

type Params = { id: string };

// POST /api/ig-posts/[id]/insights
// Read-only against Instagram. Fetches metrics for ONE published post using its
// assigned account token and upserts a snapshot into post_insights (1 row/post).
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

  // ── Fetch the post ──────────────────────────────────────────────────────────
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
      { success: false, error: "Post has no media_id — only published posts have insights." },
      { status: 400 }
    );
  }
  if (post.status !== "published" && post.status !== "republished") {
    return NextResponse.json(
      { success: false, error: `Only published/republished posts have insights (current: ${post.status}).` },
      { status: 400 }
    );
  }

  // ── Resolve the post's assigned account token (service role) ────────────────
  if (post.account_id == null) {
    return NextResponse.json(
      { success: false, error: "Post has no assigned Instagram account." },
      { status: 400 }
    );
  }
  const { data: account, error: acctErr } = await supabaseServer
    .from("connected_accounts")
    .select("id, access_token")
    .eq("id", post.account_id)
    .single();

  if (acctErr || !account) {
    return NextResponse.json(
      { success: false, error: "The Instagram account assigned to this post is no longer connected." },
      { status: 400 }
    );
  }

  // ── Fetch insights (read-only) ──────────────────────────────────────────────
  const log = createLogger();
  const result = await getMediaInsights(post.media_id, account.access_token, log);
  const now = new Date().toISOString();

  // Hard failure (couldn't even read like/comment fields) — record and surface.
  if ("error" in result) {
    await supabaseServer
      .from("post_insights")
      .upsert(
        { post_id: postId, media_id: post.media_id, insights_error: result.error, synced_at: now, updated_at: now },
        { onConflict: "post_id" }
      );
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  // ── Upsert snapshot (one row per post) ──────────────────────────────────────
  const { data: row, error: upsertErr } = await supabaseServer
    .from("post_insights")
    .upsert(
      {
        post_id: postId,
        media_id: post.media_id,
        likes: result.likes,
        comments: result.comments,
        reach: result.reach,
        impressions: result.impressions,
        saves: result.saves,
        shares: result.shares,
        views: result.views,
        raw: result.raw,
        insights_error: result.insightsError,
        synced_at: now,
        updated_at: now,
      },
      { onConflict: "post_id" }
    )
    .select("*")
    .single();

  if (upsertErr) {
    return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
  }

  console.log(
    `[ig-posts/${postId}/insights] synced — likes=${result.likes ?? "?"} comments=${result.comments ?? "?"} ` +
    `reach=${result.reach ?? "?"} saved=${result.saves ?? "?"}${result.insightsError ? " (insights partial)" : ""}`
  );

  return NextResponse.json({ success: true, insights: row });
}
