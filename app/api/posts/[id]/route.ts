import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { VALID_STATUSES } from "@/lib/supabase";
import type { PostStatus } from "@/lib/supabase";
import { requireApiKey } from "@/lib/auth";

const TITLE_MAX = 120;
const CAPTION_MAX = 2_200;
const HASHTAGS_MAX = 500;

type Params = { id: string };

type UpdatePostBody = {
  title: string;
  caption: string;
  hashtags?: string;
  status?: PostStatus;
};

export async function PUT(
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

  let body: UpdatePostBody;
  try {
    body = (await request.json()) as UpdatePostBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.title?.trim() || !body.caption?.trim()) {
    return NextResponse.json(
      { success: false, error: "title and caption are required." },
      { status: 400 }
    );
  }

  if (body.title.trim().length > TITLE_MAX) {
    return NextResponse.json(
      { success: false, error: `title must be ${TITLE_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  if (body.caption.trim().length > CAPTION_MAX) {
    return NextResponse.json(
      { success: false, error: `caption must be ${CAPTION_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  if (body.hashtags && body.hashtags.trim().length > HASHTAGS_MAX) {
    return NextResponse.json(
      { success: false, error: `hashtags must be ${HASHTAGS_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ success: false, error: "Invalid status value." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("posts")
    .update({
      title: body.title.trim(),
      caption: body.caption.trim(),
      hashtags: (body.hashtags ?? "").trim(),
      ...(body.status ? { status: body.status } : {}),
    })
    .eq("id", numericId)
    .select("id, title, caption, hashtags, status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ success: false, error: "Post not found." }, { status: 404 });
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

  // .select().single() causes PostgREST to error (PGRST116) when 0 rows are
  // deleted, giving us a real 404 instead of a silent no-op success.
  const { error } = await supabase
    .from("posts")
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
