import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireApiKey } from "@/lib/auth";

const PROMPT_MAX = 2_000;
const CAPTION_MAX = 2_200;

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("saved_captions")
    .select("id, prompt, caption, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, captions: data });
}

type SaveCaptionBody = {
  prompt: string;
  caption: string;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: SaveCaptionBody;
  try {
    body = (await request.json()) as SaveCaptionBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!body.prompt?.trim() || !body.caption?.trim()) {
    return NextResponse.json(
      { success: false, error: "prompt and caption are required." },
      { status: 400 }
    );
  }

  if (body.prompt.length > PROMPT_MAX) {
    return NextResponse.json(
      { success: false, error: `prompt must be ${PROMPT_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  if (body.caption.length > CAPTION_MAX) {
    return NextResponse.json(
      { success: false, error: `caption must be ${CAPTION_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("saved_captions")
    .insert({ prompt: body.prompt.trim(), caption: body.caption.trim() })
    .select("id, prompt, caption, created_at")
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, caption: data }, { status: 201 });
}
