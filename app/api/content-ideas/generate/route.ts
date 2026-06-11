import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import type { GeneratedIdea } from "@/lib/supabase";
import { getPersonaForAccount, personaPromptBlock } from "@/lib/persona";

const NOTES_MAX = 2_000;
const MODEL = "claude-sonnet-4-5";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 8;

type GenerateBody = {
  campaign_id?: number;
  notes?: string;
  count?: number;
};

function buildPrompt(
  campaign: { name: string; description: string | null; content_style: string | null },
  accountName: string | null,
  notes: string | null,
  count: number
): string {
  const lines = [
    `Campaign name: ${campaign.name}`,
    campaign.description ? `Campaign description/theme: ${campaign.description}` : null,
    campaign.content_style ? `Content style / niche: ${campaign.content_style}` : null,
    accountName ? `Target Instagram account: @${accountName}` : null,
    notes ? `Additional notes from the user: ${notes}` : null,
  ].filter(Boolean).join("\n");

  return `You are an Instagram content strategist. Generate ${count} distinct post ideas for the following campaign.

${lines}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "ideas": [
    {
      "title": "short hook or headline for the post",
      "caption_angle": "2-3 sentences describing the caption direction and tone",
      "visual_concept": "concrete description of the image or visual to shoot/use",
      "cta": "a specific call to action",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
    }
  ]
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- Produce exactly ${count} ideas in the "ideas" array
- Every idea must be distinct in angle — no near-duplicates
- Tailor each idea to THIS campaign's theme, style, and audience
- These are planning ideas only — do not assume anything is published`;
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const campaignId = Number(body.campaign_id);
  if (!Number.isInteger(campaignId) || campaignId < 1) {
    return NextResponse.json({ success: false, error: "campaign_id is required." }, { status: 400 });
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return NextResponse.json(
      { success: false, error: `notes must be ${NOTES_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || DEFAULT_COUNT));

  // ── Fetch the campaign ────────────────────────────────────────────────────────
  const { data: campaign, error: campErr } = await supabaseServer
    .from("campaigns")
    .select("id, name, description, content_style, account_id")
    .eq("id", campaignId)
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
  }

  // Optional target account name (label only — never affects publishing)
  let accountName: string | null = null;
  if (campaign.account_id) {
    const { data: acct } = await supabaseServer
      .from("connected_accounts")
      .select("account_name")
      .eq("id", campaign.account_id)
      .single();
    accountName = acct?.account_name ?? null;
  }

  // Persona context (in-character generation when the account has one)
  const persona = await getPersonaForAccount(campaign.account_id);
  const personaBlock = personaPromptBlock(persona);

  console.log(`[content-ideas/generate] campaign ${campaignId} "${campaign.name}" → ${count} ideas via ${MODEL}`);

  // ── Generate ──────────────────────────────────────────────────────────────────
  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: (personaBlock ? `${personaBlock}\n\n` : "") + buildPrompt(campaign, accountName, notes || null, count) }],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[content-ideas/generate] Claude error:", msg);
    return NextResponse.json({ success: false, error: `AI idea generation failed: ${msg}` }, { status: 500 });
  }

  let parsed: { ideas: GeneratedIdea[] };
  try {
    const clean = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    console.error("[content-ideas/generate] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json(
      { success: false, error: "AI returned an unexpected response format. Try again." },
      { status: 500 }
    );
  }

  if (!Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
    return NextResponse.json(
      { success: false, error: "AI response was missing the ideas array." },
      { status: 500 }
    );
  }

  console.log(`[content-ideas/generate] campaign ${campaignId} → returned ${parsed.ideas.length} ideas (not saved)`);

  // Ideas are returned only — NOT persisted. Saving happens via POST /api/content-ideas.
  return NextResponse.json({ success: true, campaign_id: campaignId, ideas: parsed.ideas });
}
