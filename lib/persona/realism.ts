import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/claude";

// Persona realism: a structured character bible drives a strong photorealistic
// prompt + negative prompt, and a Claude-vision quality gate scores realism and
// rejects the usual AI tells (plastic skin, warped hands, dead eyes, melted
// jewelry) before an image is saved. Personas are always FICTIONAL — the prompt
// states this and forbids resembling any real or famous person.

export type CharacterBible = {
  name?: string;
  age_range?: string;
  ethnicity_appearance?: string;
  face_structure?: string;
  hair?: string;
  body_type?: string;
  style_fashion?: string;
  personality?: string;
  content_niche?: string;
  poses?: string;
  lighting_style?: string;
  camera_style?: string;
  negative_prompt?: string;
};

// gpt-image-1 has no separate negative-prompt field, so we embed it as "Avoid:".
// Includes the "too-polished" tells that make AI portraits read as fake.
export const DEFAULT_NEGATIVE =
  "plastic or waxy skin, over-smoothed airbrushed skin, warped/extra/fused fingers, " +
  "deformed or malformed hands, asymmetric or dead or glassy eyes, crossed eyes, extra limbs, " +
  "distorted or melted jewelry, uncanny-valley face, doll-like or mannequin look, " +
  "studio lighting, professional retouching, stock-photo look, magazine cover, over-sharpened, " +
  "heavy HDR, beauty-filter skin, 3d render, CGI, octane render, cartoon, illustration, " +
  "blurry, low detail, watermark, text, logo, bad anatomy, disfigured, duplicated features";

// Candid/amateur framing reads far more real than a polished portrait — that's
// the biggest lever on the realism score, so the prompt leans into it hard.
export function photorealPrompt(b: CharacterBible, sceneHint?: string): string {
  const subject = [b.age_range, b.ethnicity_appearance, b.face_structure, b.hair, b.body_type]
    .map(s => (s ?? "").trim()).filter(Boolean).join(", ");
  const scene = sceneHint || b.poses || "a relaxed, unposed candid moment";
  return [
    `A candid, unposed amateur smartphone photo of a single fictional person${subject ? ` — ${subject}` : ""}.`,
    b.style_fashion ? `Wearing ${b.style_fashion}.` : "",
    `${scene}.`,
    b.lighting_style ? `Lighting: ${b.lighting_style}.` : "Natural available light, soft and slightly uneven.",
    b.camera_style ? `Camera: ${b.camera_style}.` : "Shot handheld on an iPhone, slight sensor grain, true-to-life dynamic range, natural imperfect framing.",
    "It should look exactly like a real photo a normal person posted to Instagram — NOT a studio or professional shoot.",
    "Authentic skin with visible pores, faint blemishes and natural under-eye shadows (never airbrushed or smoothed),",
    "realistic eye catchlights with natural asymmetry, anatomically correct hands and fingers, individual flyaway hair strands, true-to-life skin tone and color.",
    "This is an ENTIRELY FICTIONAL AI-generated persona — it must not resemble any real, famous, or identifiable person.",
    `Avoid: ${b.negative_prompt || DEFAULT_NEGATIVE}.`,
  ].filter(Boolean).join(" ");
}

export type RealismVerdict = {
  realism_score: number;      // 0–100
  looks_ai: boolean;
  artifacts: string[];        // specific issues found
  notes: string;
};

// Claude-vision quality gate. Strict — most AI images sit 50–75; reserve 85+ for
// genuinely convincing photos with clean hands/eyes/skin.
export async function scoreRealism(imageB64: string): Promise<RealismVerdict> {
  const instruction = `You are a strict photo-forensics checker for AI-generated portraits. Judge ONLY how convincingly real this image looks as a candid Instagram photo of a person.

Check specifically for AI tells: plastic/waxy or over-smoothed skin, warped/extra/fused fingers or deformed hands, asymmetric/dead/glassy eyes, melted or distorted jewelry, uncanny-valley face, doll-like look, garbled background text.

Be strict and calibrated: most AI portraits land 50–75; reserve 85+ for genuinely convincing photos with clean hands, natural eyes, and realistic skin texture.

Return ONLY JSON (no markdown):
{ "realism_score": int 0-100, "looks_ai": bool, "artifacts": [short strings], "notes": "one line" }`;

  const content: Anthropic.MessageParam["content"] = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
    { type: "text", text: instruction },
  ];
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content }],
    });
    const text = message.content
      .filter((bl): bl is Anthropic.TextBlock => bl.type === "text")
      .map(bl => bl.text).join("").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const p = JSON.parse(text) as Partial<RealismVerdict>;
    return {
      realism_score: Math.max(0, Math.min(100, Math.round(Number(p.realism_score) || 0))),
      looks_ai: !!p.looks_ai,
      artifacts: Array.isArray(p.artifacts) ? p.artifacts.map(s => String(s).slice(0, 80)).slice(0, 8) : [],
      notes: String(p.notes ?? "").slice(0, 240),
    };
  } catch (e) {
    // Fail open — a scoring outage shouldn't block generation.
    return { realism_score: 0, looks_ai: false, artifacts: [], notes: `realism check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
