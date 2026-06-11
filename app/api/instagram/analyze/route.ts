import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";
import type { CaptionOption } from "@/lib/supabase";
import { getPersonaForAccount, personaPromptBlock, applyDisclosure } from "@/lib/persona";
import { getActiveLearnings, learningsPromptBlock } from "@/lib/learning";

export type SuggestedAttributes = {
  content_pillar?: string;
  caption_style?: string;
  image_style_summary?: string;
  hashtag_set?: string[];
};

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"] as const;
type AcceptedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type ImageAnalysis = {
  category: string;
  subcategory: string;
  sceneDescription: string;
  objects: string[];
  people: string;
  setting: string;
  mood: string;
  visibleText: string;
  audience: string;
  postingAngle: string;
};

export type AnalyzeResponse = {
  success: true;
  analysis: ImageAnalysis;
  caption: string;           // backward-compat: professional option text (caption + hashtags)
  captionOptions: CaptionOption[];
  attributes?: SuggestedAttributes | null;  // AI-classified tags for analytics (Part 3)
  debug: {
    model: string;
    imageSentToAI: boolean;
    imageSizeBytes: number;
    mediaType: string;
  };
};

const VISION_PROMPT = `You are analyzing an image for Instagram content creation.
Study the image carefully and return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "analysis": {
    "category": "primary content category (lifestyle/fashion/food/travel/product/fitness/beauty/art/nature/other)",
    "subcategory": "more specific description",
    "sceneDescription": "one clear sentence describing what you see",
    "objects": ["key", "visible", "objects"],
    "people": "describe any people visible, or 'none'",
    "setting": "location and environment description",
    "mood": "emotional tone (energetic/calm/luxurious/playful/inspirational/bold/etc)",
    "visibleText": "any text visible in the image, or 'none'",
    "audience": "target Instagram demographic for this content",
    "postingAngle": "specific recommended angle or theme for the Instagram post"
  },
  "captionOptions": [
    {
      "style": "professional",
      "label": "Clean & Professional",
      "caption": "2-3 polished sentences, brand-appropriate tone",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
    },
    {
      "style": "casual",
      "label": "Casual & Fun",
      "caption": "Relaxed, conversational tone with personality — like talking to a friend",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
    },
    {
      "style": "motivational",
      "label": "Motivational",
      "caption": "Inspiring, uplifting message that resonates with the audience",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
    },
    {
      "style": "cta",
      "label": "Sales / CTA",
      "caption": "Benefit-driven with a clear, specific call to action",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
    },
    {
      "style": "viral",
      "label": "Short & Viral",
      "caption": "Punchy and memorable — 1-2 lines max, built to stop the scroll",
      "hashtags": "#hashtag1 #hashtag2 #hashtag3"
    }
  ],
  "attributes": {
    "content_pillar": "which content theme/pillar this post best fits",
    "caption_style": "one of: hook-question, storytelling, listicle, cta-heavy, short-viral",
    "image_style_summary": "one short phrase describing the visual style",
    "hashtag_set": ["#tag1", "#tag2", "#tag3"]
  }
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- Make ALL captions specific to THIS image — never generic
- Each caption style must be genuinely different in tone
- Keep hashtags relevant to the actual image content
- attributes: classify the post for analytics; caption_style MUST be one of the listed values`;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Failed to parse form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No image file provided." }, { status: 400 });
  }

  if (!ACCEPTED_TYPES.includes(file.type as typeof ACCEPTED_TYPES[number])) {
    return NextResponse.json(
      { success: false, error: `Unsupported file type: ${file.type}. Use JPEG or PNG.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: "Image must be 8 MB or smaller." }, { status: 400 });
  }

  // Optional persona context — keeps captions in-character for this account.
  const accountIdRaw = formData.get("account_id");
  const accountId = accountIdRaw != null && String(accountIdRaw).trim() ? Number(accountIdRaw) : null;
  const persona = await getPersonaForAccount(Number.isInteger(accountId) ? accountId : null);
  const personaBlock = personaPromptBlock(persona);
  const learnings = await getActiveLearnings(Number.isInteger(accountId) ? accountId : null);
  const learningsBlock = learningsPromptBlock(learnings);

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const mediaTypeMap: Record<string, AcceptedMediaType> = {
    "image/jpeg": "image/jpeg",
    "image/jpg":  "image/jpeg",
    "image/png":  "image/png",
    "image/webp": "image/webp",
    "image/gif":  "image/gif",
  };
  const mediaType: AcceptedMediaType = mediaTypeMap[file.type] ?? "image/jpeg";

  const model = "claude-sonnet-4-5";
  console.log(`[IG Analyze] ${file.name} (${file.type}, ${file.size} bytes) → ${model}`);

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: [personaBlock, learningsBlock, VISION_PROMPT].filter(Boolean).join("\n\n") },
          ],
        },
      ],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[IG Analyze] Claude error:", msg);
    return NextResponse.json({ success: false, error: `AI analysis failed: ${msg}` }, { status: 500 });
  }

  let parsed: { analysis: ImageAnalysis; captionOptions: CaptionOption[]; attributes?: SuggestedAttributes };
  try {
    const clean = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    console.error("[IG Analyze] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json(
      { success: false, error: "AI returned an unexpected response format. Try again.", rawResponse: rawText },
      { status: 500 }
    );
  }

  if (!parsed.analysis || !Array.isArray(parsed.captionOptions) || parsed.captionOptions.length === 0) {
    return NextResponse.json(
      { success: false, error: "AI response was missing required fields.", rawResponse: rawText },
      { status: 500 }
    );
  }

  // Apply the persona's AI-disclosure label to each caption (still editable in the draft).
  const captionOptions = persona
    ? parsed.captionOptions.map(o => ({ ...o, caption: applyDisclosure(o.caption, persona) }))
    : parsed.captionOptions;

  // Backward-compat: caption = professional option full text
  const firstOption = captionOptions[0];
  const caption = [firstOption.caption, firstOption.hashtags].filter(Boolean).join("\n\n");

  console.log(`[IG Analyze] Done. Category: ${parsed.analysis.category}. Options: ${parsed.captionOptions.length}`);

  return NextResponse.json({
    success: true,
    analysis: parsed.analysis,
    caption,
    captionOptions,
    attributes: parsed.attributes ?? null,
    debug: {
      model,
      imageSentToAI: true,
      imageSizeBytes: file.size,
      mediaType,
    },
  } satisfies AnalyzeResponse);
}
