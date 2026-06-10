import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type Params = { id: string };

// Statuses from which a post can be scheduled (or rescheduled)
const SCHEDULABLE_STATUSES = new Set([
  "draft", "ready", "failed", "scheduled",
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

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { scheduled_at?: string; timezone?: string; scheduled_by?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.scheduled_at) {
    return NextResponse.json({ success: false, error: "scheduled_at is required." }, { status: 400 });
  }

  const scheduledDate = new Date(body.scheduled_at);
  if (isNaN(scheduledDate.getTime())) {
    return NextResponse.json({ success: false, error: "scheduled_at is not a valid date." }, { status: 400 });
  }
  if (scheduledDate <= new Date()) {
    return NextResponse.json(
      { success: false, error: "scheduled_at must be in the future." },
      { status: 400 }
    );
  }

  // ── Fetch post ──────────────────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .select("id, status, image_url, caption, archived_at")
    .eq("id", postId)
    .single();

  if (postErr || !post) {
    return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
  }

  if (post.archived_at) {
    return NextResponse.json(
      { success: false, error: "Cannot schedule an archived post — restore it first." },
      { status: 400 }
    );
  }

  if (!post.image_url) {
    return NextResponse.json(
      { success: false, error: "Post has no image — upload an image before scheduling." },
      { status: 400 }
    );
  }

  if (!post.caption?.trim()) {
    return NextResponse.json(
      { success: false, error: "Post has no caption." },
      { status: 400 }
    );
  }

  if (!SCHEDULABLE_STATUSES.has(post.status)) {
    return NextResponse.json(
      {
        success: false,
        error: `Cannot schedule a post with status "${post.status}". Only draft, ready, failed, or scheduled posts can be (re)scheduled.`,
      },
      { status: 400 }
    );
  }

  // ── Update post ─────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("ig_posts")
    .update({
      status: "scheduled",
      scheduled_at: scheduledDate.toISOString(),
      timezone: body.timezone ?? null,
      scheduled_by: body.scheduled_by ?? null,
      schedule_error_message: null,
      error_message: null,
      updated_at: now,
    })
    .eq("id", postId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data });
}
