import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { VALID_STATUSES } from "@/lib/supabase";
import type { PostStatus } from "@/lib/supabase";
import { requireApiKey } from "@/lib/auth";

const TITLE_MAX = 120;
const CAPTION_MAX = 2_200;
const HASHTAGS_MAX = 500;

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("posts")
    .select("id, title, caption, hashtags, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, posts: data });
}

type CreatePostBody = {
  title: string;
  caption: string;
  hashtags?: string;
  status?: PostStatus;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: CreatePostBody;
  try {
    body = (await request.json()) as CreatePostBody;
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

  const status: PostStatus =
    body.status && VALID_STATUSES.includes(body.status) ? body.status : "draft";

  const { data, error } = await supabase
    .from("posts")
    .insert({
      title: body.title.trim(),
      caption: body.caption.trim(),
      hashtags: (body.hashtags ?? "").trim(),
      status,
    })
    .select("id, title, caption, hashtags, status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data }, { status: 201 });
}
