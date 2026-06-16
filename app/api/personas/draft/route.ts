import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";

const DESC_MAX = 2_000;
const MODEL = "claude-sonnet-4-5";

type DraftBody = { description?: string };

export type PersonaDraft = {
  name: string;
  handle_display: string;
  persona_type: string;
  bio: string;
  voice_and_tone: string;
  visual_style: string;
  content_pillars: string[];
  audience_description: string;
  hashtag_strategy: string;
  character_bible?: Record<string, string>;
};

// POST /api/personas/draft
// Proposes persona fields from a short description. Ephemeral — never saved here;
// the UI lets the user edit, then save via POST /api/personas.
export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description) {
    return NextResponse.json({ success: false, error: "description is required." }, { status: 400 });
  }
  if (description.length > DESC_MAX) {
    return NextResponse.json({ success: false, error: `description must be ${DESC_MAX} characters or fewer.` }, { status: 400 });
  }

  const prompt = `You are designing an Instagram persona profile from a short brief.

Brief: ${description}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "name": "persona display name",
  "handle_display": "@suggested_handle",
  "persona_type": "virtual_influencer | brand_voice | niche_expert",
  "bio": "1-2 sentence backstory",
  "voice_and_tone": "vocabulary, sentence style, emoji usage, humor level",
  "visual_style": "detailed visual identity: subject appearance, color palette, lighting, photography style, recurring settings",
  "content_pillars": ["pillar 1", "pillar 2", "pillar 3"],
  "audience_description": "who follows this persona",
  "hashtag_strategy": "how this persona uses hashtags",
  "character_bible": {
    "age_range": "e.g. 24-28",
    "ethnicity_appearance": "skin tone, distinctive features — fictional, not a real or famous person",
    "face_structure": "jaw, cheekbones, nose, eye shape",
    "hair": "color, length, style, texture",
    "body_type": "build/height",
    "style_fashion": "wardrobe + aesthetic",
    "personality": "traits that show in photos",
    "content_niche": "what they post about",
    "poses": "typical poses/framing (selfie, candid, etc.)",
    "lighting_style": "e.g. warm golden-hour, soft window light",
    "camera_style": "e.g. shot on iPhone, 35mm film look",
    "negative_prompt": "things to avoid for THIS persona (leave generic if none)"
  }
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- Make it specific and usable, grounded in the brief
- content_pillars: 3-5 short items
- The persona is ENTIRELY FICTIONAL — never base appearance on a real, famous, or identifiable person
- character_bible drives photorealistic image generation, so be concrete and consistent`;

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[personas/draft] Claude error:", msg);
    return NextResponse.json({ success: false, error: `AI persona draft failed: ${msg}` }, { status: 500 });
  }

  let parsed: PersonaDraft;
  try {
    const clean = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as PersonaDraft;
  } catch {
    console.error("[personas/draft] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json({ success: false, error: "AI returned an unexpected response format. Try again." }, { status: 500 });
  }

  // Normalize content_pillars to a string array.
  const pillars = Array.isArray(parsed.content_pillars)
    ? parsed.content_pillars.filter((p): p is string => typeof p === "string").map(p => p.trim()).filter(Boolean)
    : [];

  return NextResponse.json({ success: true, draft: { ...parsed, content_pillars: pillars } });
}
