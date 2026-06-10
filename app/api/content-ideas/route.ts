import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

const TITLE_MAX = 300;
const FIELD_MAX = 2_000;

// ─── GET: list saved ideas (optionally filtered by campaign) ────────────────────

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const campaignParam = searchParams.get("campaign_id");

  let query = supabaseServer
    .from("content_ideas")
    .select("*")
    .order("created_at", { ascending: false });

  if (campaignParam) {
    const campaignId = Number(campaignParam);
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return NextResponse.json({ success: false, error: "Invalid campaign_id." }, { status: 400 });
    }
    query = query.eq("campaign_id", campaignId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ideas: data });
}

// ─── POST: save one idea ────────────────────────────────────────────────────────

type SaveBody = {
  campaign_id?: number;
  title?: string;
  caption_angle?: string;
  visual_concept?: string;
  cta?: string;
  hashtags?: string;
  source_prompt?: string;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const campaignId = Number(body.campaign_id);
  if (!Number.isInteger(campaignId) || campaignId < 1) {
    return NextResponse.json({ success: false, error: "campaign_id is required." }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ success: false, error: "title is required." }, { status: 400 });
  }
  if (title.length > TITLE_MAX) {
    return NextResponse.json(
      { success: false, error: `title must be ${TITLE_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  // Verify the campaign exists (FK is enforced, but this gives a clean error)
  const { data: campaign, error: campErr } = await supabaseServer
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .single();
  if (campErr || !campaign) {
    return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
  }

  const clamp = (v: string | undefined) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, FIELD_MAX) : null;

  const { data, error } = await supabaseServer
    .from("content_ideas")
    .insert({
      campaign_id: campaignId,
      title,
      caption_angle: clamp(body.caption_angle),
      visual_concept: clamp(body.visual_concept),
      cta: clamp(body.cta),
      hashtags: clamp(body.hashtags),
      source_prompt: clamp(body.source_prompt),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, idea: data }, { status: 201 });
}
