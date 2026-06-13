import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireCronOrApiKey } from "@/lib/cron-auth";
import { createLogger, getMediaInsights, MEDIA_DELETED_CODES } from "@/lib/instagram";
import { reconcileMediaNetwork } from "@/lib/media-network/performance";

// The "measure → adjust" cron (daily). Syncs insights snapshots for every
// published post (images and reels), then asks the existing learning engine to
// re-distill findings per account — those findings feed the next strategist run.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_POSTS_PER_RUN = 50;

type PostRow = { id: number; media_id: string; account_id: number | null; media_type: string | null };

async function measure(origin: string): Promise<NextResponse> {
  const { data: posts, error: postsErr } = await supabaseServer
    .from("ig_posts")
    .select("id, media_id, account_id, media_type")
    .in("status", ["published", "republished"])
    .not("media_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(MAX_POSTS_PER_RUN);

  if (postsErr) {
    return NextResponse.json({ success: false, error: postsErr.message }, { status: 500 });
  }

  const { data: accounts, error: acctErr } = await supabaseServer
    .from("connected_accounts")
    .select("id, access_token");
  if (acctErr || !accounts || accounts.length === 0) {
    return NextResponse.json({ success: true, synced: 0, note: "No connected accounts." });
  }
  const tokenByAccount = new Map(accounts.map(a => [a.id as number, a.access_token as string]));

  let synced = 0;
  let deleted = 0;
  let errors = 0;
  const accountsTouched = new Set<number>();

  for (const post of (posts ?? []) as PostRow[]) {
    const token = post.account_id != null ? tokenByAccount.get(post.account_id) : undefined;
    if (!token) { errors++; continue; }

    const log = createLogger();
    const now = new Date().toISOString();
    const result = await getMediaInsights(
      post.media_id, token, log,
      post.media_type === "reel" ? "REELS" : "IMAGE"
    );

    if ("error" in result) {
      // Mark deleted ONLY on Meta's explicit object-gone codes — never on
      // auth/rate-limit errors (same policy as the per-post insights route).
      if (result.code != null && MEDIA_DELETED_CODES.has(result.code)) {
        await supabaseServer.from("ig_posts").update({
          status: "deleted_on_instagram",
          deleted_detected_at: now,
          last_instagram_sync_at: now,
          updated_at: now,
        }).eq("id", post.id);
        deleted++;
      } else {
        await supabaseServer.from("post_insights").upsert(
          { post_id: post.id, media_id: post.media_id, insights_error: result.error, synced_at: now, updated_at: now },
          { onConflict: "post_id" }
        );
        errors++;
      }
      continue;
    }

    await supabaseServer.from("post_insights").upsert(
      {
        post_id: post.id,
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
    );
    synced++;
    if (post.account_id != null) accountsTouched.add(post.account_id);
  }

  // Re-distill learnings per account through the existing engine. Internal
  // server-to-server call so the route's analysis logic stays in one place.
  const apiKey = process.env.NEXT_PUBLIC_APP_INTERNAL_API_KEY;
  let learningsRefreshed = 0;
  for (const accountId of accountsTouched) {
    try {
      const res = await fetch(new URL("/api/learnings/generate", origin), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "x-app-api-key": apiKey } : {}) },
        body: JSON.stringify({ account_id: accountId }),
      });
      if (res.ok) learningsRefreshed++;
      else console.error(`[reels/measure] learnings refresh failed for account ${accountId}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`[reels/measure] learnings refresh threw for account ${accountId}:`, e);
    }
  }

  // Media Network feedback loop: package statuses + performance_tags.
  let mediaNetwork = { reconciled: 0, tagged: 0 };
  try {
    mediaNetwork = await reconcileMediaNetwork();
  } catch (e) {
    console.error("[reels/measure] media-network reconciliation failed:", e instanceof Error ? e.message : e);
  }

  console.log(`[reels/measure] insights synced=${synced} deleted=${deleted} errors=${errors} learnings refreshed for ${learningsRefreshed} account(s); media-network reconciled=${mediaNetwork.reconciled} tagged=${mediaNetwork.tagged}`);
  return NextResponse.json({ success: true, synced, deleted, errors, learningsRefreshed, mediaNetwork });
}

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return measure(new URL(request.url).origin);
}

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  return measure(new URL(request.url).origin);
}
