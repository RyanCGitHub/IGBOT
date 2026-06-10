import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { IG_POST_VALID_STATUSES } from "@/lib/supabase";
import type { IgPostStatus } from "@/lib/supabase";

const CAPTION_MAX = 2_200;
type Params = { id: string };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid post id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.caption === "string" && body.caption.trim().length > CAPTION_MAX) {
    return NextResponse.json(
      { success: false, error: `caption must be ${CAPTION_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  if (body.status && !IG_POST_VALID_STATUSES.includes(body.status as IgPostStatus)) {
    return NextResponse.json({ success: false, error: "Invalid status value." }, { status: 400 });
  }

  // Only allow safe fields to be patched
  const allowed = [
    "title", "caption", "image_url", "image_storage_path", "image_analysis",
    "caption_options", "normalization_meta", "account_id", "status",
    "error_message", "media_id", "permalink", "publish_job_id", "published_at",
    "original_media_id", "republished_from_media_id",
    "deleted_detected_at", "last_instagram_sync_at", "sync_error_message",
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  if (typeof patch.caption === "string") patch.caption = patch.caption.trim();

  const { data, error } = await supabaseServer
    .from("ig_posts")
    .update(patch)
    .eq("id", numericId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ success: false, error: "Invalid post id." }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("ig_posts")
    .delete()
    .eq("id", numericId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
