import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const TEXT_MAX = 500;
const MAX_HASHTAGS = 30;
type Params = { id: string };

function clampText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, TEXT_MAX) : null;
}

function cleanHashtags(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v
    .filter((x): x is string => typeof x === "string")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_HASHTAGS);
  return arr.length ? arr : null;
}

// Derive media_source when not supplied: an AI-generated image leaves a
// generated_media row linked to this draft.
async function deriveMediaSource(postId: number): Promise<string> {
  const { count } = await supabaseServer
    .from("generated_media")
    .select("id", { count: "exact", head: true })
    .eq("draft_id", postId)
    .eq("status", "generated");
  return (count ?? 0) > 0 ? "ai_generated" : "uploaded";
}

// ─── GET: a post's attributes ───────────────────────────────────────────────────

export async function GET(
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

  const { data } = await supabaseServer
    .from("post_attributes")
    .select("*")
    .eq("post_id", postId)
    .single();

  return NextResponse.json({ success: true, attributes: data ?? null });
}

// ─── PUT: upsert a post's attributes (1 row per post) ───────────────────────────

type PutBody = {
  content_pillar?: string;
  caption_style?: string;
  media_source?: string;
  image_style_summary?: string;
  hashtag_set?: unknown;
};

export async function PUT(
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

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  // Verify the post exists (FK also enforces this; clean error here).
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .select("id")
    .eq("id", postId)
    .single();
  if (postErr || !post) {
    return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
  }

  const mediaSource =
    body.media_source === "uploaded" || body.media_source === "ai_generated"
      ? body.media_source
      : await deriveMediaSource(postId);

  const { data, error } = await supabaseServer
    .from("post_attributes")
    .upsert(
      {
        post_id: postId,
        content_pillar: clampText(body.content_pillar),
        caption_style: clampText(body.caption_style),
        media_source: mediaSource,
        image_style_summary: clampText(body.image_style_summary),
        hashtag_set: cleanHashtags(body.hashtag_set),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "post_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, attributes: data });
}
