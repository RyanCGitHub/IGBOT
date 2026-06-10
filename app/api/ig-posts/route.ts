import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { IG_POST_VALID_STATUSES } from "@/lib/supabase";
import type { IgPostStatus, CaptionOption } from "@/lib/supabase";

const CAPTION_MAX = 2_200;

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabaseServer
    .from("ig_posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, posts: data });
}

type CreateBody = {
  title?: string;
  caption: string;
  image_url?: string;
  image_storage_path?: string;
  image_analysis?: Record<string, unknown>;
  caption_options?: CaptionOption[];
  normalization_meta?: Record<string, unknown>;
  account_id?: number;
  status?: IgPostStatus;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.caption?.trim()) {
    return NextResponse.json({ success: false, error: "caption is required." }, { status: 400 });
  }

  if (body.caption.trim().length > CAPTION_MAX) {
    return NextResponse.json(
      { success: false, error: `caption must be ${CAPTION_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  const status: IgPostStatus =
    body.status && IG_POST_VALID_STATUSES.includes(body.status) ? body.status : "draft";

  const { data, error } = await supabaseServer
    .from("ig_posts")
    .insert({
      title: body.title?.trim() ?? "",
      caption: body.caption.trim(),
      image_url: body.image_url ?? null,
      image_storage_path: body.image_storage_path ?? null,
      image_analysis: body.image_analysis ?? null,
      caption_options: body.caption_options ?? null,
      normalization_meta: body.normalization_meta ?? null,
      account_id: body.account_id ?? null,
      status,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data }, { status: 201 });
}
