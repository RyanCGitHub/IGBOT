import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type GraphMediaResponse = {
  id?: string;
  error?: { code: number; message: string };
};

const DELETED_CODES = new Set([100, 803]);
const AUTH_ERROR_CODES = new Set([190, 32, 4]);

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  // ── Fetch all published/republished posts with a media_id ─────────────────
  const { data: posts, error: postsErr } = await supabaseServer
    .from("ig_posts")
    .select("id, media_id, account_id, status")
    .in("status", ["published", "republished"])
    .not("media_id", "is", null);

  if (postsErr) {
    return NextResponse.json({ success: false, error: postsErr.message }, { status: 500 });
  }

  if (!posts || posts.length === 0) {
    return NextResponse.json({ success: true, checked: 0, stillPublished: 0, deletedCount: 0, errorCount: 0 });
  }

  // ── Fetch all connected accounts (service role) ───────────────────────────
  const { data: accounts, error: acctErr } = await supabaseServer
    .from("connected_accounts")
    .select("id, access_token");

  if (acctErr || !accounts || accounts.length === 0) {
    return NextResponse.json({ success: false, error: "No connected accounts found." }, { status: 400 });
  }

  const accountMap = new Map(accounts.map(a => [a.id as number, a.access_token as string]));
  // Fallback: use the first account's token if post has no account_id
  const fallbackToken = accounts[0].access_token as string;

  const now = new Date().toISOString();
  let stillPublished = 0;
  let deletedCount = 0;
  let errorCount = 0;

  // ── Check each post ───────────────────────────────────────────────────────
  for (const post of posts) {
    const token = (post.account_id ? accountMap.get(post.account_id) : undefined) ?? fallbackToken;
    const graphUrl = `https://graph.facebook.com/v21.0/${post.media_id}?fields=id,media_type&access_token=${token}`;

    let body: GraphMediaResponse;
    try {
      const res = await fetch(graphUrl);
      body = (await res.json()) as GraphMediaResponse;
    } catch {
      await supabaseServer
        .from("ig_posts")
        .update({
          last_instagram_sync_at: now,
          sync_error_message: "Network error during bulk sync",
          updated_at: now,
        })
        .eq("id", post.id);
      errorCount++;
      continue;
    }

    if (body.id) {
      await supabaseServer
        .from("ig_posts")
        .update({
          last_instagram_sync_at: now,
          sync_error_message: null,
          updated_at: now,
        })
        .eq("id", post.id);
      stillPublished++;
      continue;
    }

    const code = body.error?.code;

    if (code !== undefined && DELETED_CODES.has(code)) {
      await supabaseServer
        .from("ig_posts")
        .update({
          status: "deleted_on_instagram",
          deleted_detected_at: now,
          last_instagram_sync_at: now,
          sync_error_message: null,
          updated_at: now,
        })
        .eq("id", post.id);
      deletedCount++;
      continue;
    }

    if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
      await supabaseServer
        .from("ig_posts")
        .update({
          last_instagram_sync_at: now,
          sync_error_message: `Graph API auth/rate error ${code}: ${body.error?.message ?? "unknown"}`,
          updated_at: now,
        })
        .eq("id", post.id);
      errorCount++;
      continue;
    }

    // Unknown error
    await supabaseServer
      .from("ig_posts")
      .update({
        last_instagram_sync_at: now,
        sync_error_message: `Graph API error: ${body.error?.message ?? "no id returned"}`,
        updated_at: now,
      })
      .eq("id", post.id);
    errorCount++;
  }

  return NextResponse.json({
    success: true,
    checked: posts.length,
    stillPublished,
    deletedCount,
    errorCount,
  });
}
