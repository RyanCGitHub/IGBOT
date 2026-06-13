import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { publishIgPost } from "@/lib/publish-post";
import { publishingPaused, pausedResponse } from "@/lib/cron-auth";
import { checkPostingSpacing } from "@/lib/media-network/spacing";

const BATCH_SIZE = 5;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — allow in development, warn loudly
    console.warn("[process-scheduled] CRON_SECRET not set — running unauthenticated. Set CRON_SECRET in production.");
    return null;
  }

  // Vercel cron sends: Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return null;

  // Also accept x-cron-secret header for manual testing
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret === secret) return null;

  return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return processDuePosts();
}

async function processDuePosts() {
  const now = new Date().toISOString();

  // ── Find due posts ──────────────────────────────────────────────────────────
  const { data: duePosts, error: fetchErr } = await supabaseServer
    .from("ig_posts")
    .select("id, schedule_attempt_count, account_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .is("archived_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return NextResponse.json({ success: true, serverTime: now, checked: 0, published: 0, failed: 0, skipped: 0, errors: [] });
  }

  // ── Process each post ───────────────────────────────────────────────────────
  let published = 0;
  let failed = 0;
  let spacingHeld = 0;
  const errors: { id: number; error: string }[] = [];

  for (const post of duePosts) {
    // Per-brand anti-burst spacing: a held post stays scheduled and is
    // retried on the next cron tick — no attempt is consumed.
    if (post.account_id) {
      const spacing = await checkPostingSpacing(post.account_id);
      if (!spacing.allowed) {
        spacingHeld++;
        console.log(`[process-scheduled] Post ${post.id} held by spacing rule (${spacing.waitMinutes}m remaining)`);
        continue;
      }
    }

    const attemptNow = new Date().toISOString();

    // Increment attempt counter before publishing so it's tracked even on crash
    await supabaseServer
      .from("ig_posts")
      .update({
        schedule_attempt_count: (post.schedule_attempt_count ?? 0) + 1,
        last_schedule_attempt_at: attemptNow,
        updated_at: attemptNow,
      })
      .eq("id", post.id);

    try {
      const result = await publishIgPost(post.id, { isScheduled: true });

      if (result.success) {
        published++;
        console.log(`[process-scheduled] Post ${post.id} published (media: ${result.mediaId})`);
      } else {
        failed++;
        errors.push({ id: post.id, error: result.error });

        // Also store the schedule-specific error for display
        await supabaseServer
          .from("ig_posts")
          .update({ schedule_error_message: result.error, updated_at: new Date().toISOString() })
          .eq("id", post.id);

        console.error(`[process-scheduled] Post ${post.id} failed: ${result.error}`);
      }
    } catch (e) {
      // Don't let one post crash the whole batch
      const msg = e instanceof Error ? e.message : String(e);
      failed++;
      errors.push({ id: post.id, error: msg });

      await supabaseServer
        .from("ig_posts")
        .update({
          status: "failed",
          error_message: msg,
          schedule_error_message: msg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);

      console.error(`[process-scheduled] Post ${post.id} threw unexpectedly:`, e);
    }
  }

  return NextResponse.json({
    success: true,
    serverTime: now,
    checked: duePosts.length,
    published,
    failed,
    skipped: spacingHeld,
    errors,
  });
}

// Vercel cron invokes GET — it must do the real work, not just health-check.
// (Previously GET was a no-op, so the cron never actually published anything.)
export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return processDuePosts();
}
