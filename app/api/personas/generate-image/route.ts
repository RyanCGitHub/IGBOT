import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { createOpenAIImageProvider } from "@/lib/media-generation/openai";
import { uploadToBucket, publicUrlFor } from "@/lib/reels/storage";
import { photorealPrompt, scoreRealism, type CharacterBible } from "@/lib/persona/realism";

// Generate photorealistic persona photos: N variations from the character bible,
// each scored by the realism quality gate, returned best-first so the owner picks
// (or auto-saves the best as the persona's reference image for consistency).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { persona_id?: number; bible?: CharacterBible; scene?: string; variations?: number; save_best?: boolean };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  // Resolve the bible — from a saved persona, or passed inline.
  let bible: CharacterBible | null = body.bible ?? null;
  if (body.persona_id) {
    const { data: persona } = await supabaseServer.from("personas").select("character_bible, negative_prompt, visual_style").eq("id", body.persona_id).maybeSingle();
    if (persona?.character_bible) bible = persona.character_bible as CharacterBible;
    if (bible && persona?.negative_prompt) bible.negative_prompt = persona.negative_prompt as string;
    // Fall back to free-text visual_style if no structured bible yet.
    if (!bible && persona?.visual_style) bible = { ethnicity_appearance: persona.visual_style as string };
  }
  if (!bible) return NextResponse.json({ success: false, error: "No character bible — describe the persona or save its bible first." }, { status: 400 });

  const n = Math.max(1, Math.min(4, Number(body.variations) || 3));
  const prompt = photorealPrompt(bible, body.scene);
  const provider = createOpenAIImageProvider();

  const variations: { url: string; path: string; realism_score: number; looks_ai: boolean; artifacts: string[]; notes: string }[] = [];
  for (let i = 0; i < n; i++) {
    try {
      const img = await provider.generateImage(prompt, { size: "1024x1536" });
      const jpeg = await sharp(Buffer.from(img.base64, "base64")).jpeg({ quality: 90 }).toBuffer();
      const path = `personas/${body.persona_id ?? "draft"}/${Date.now()}-${i}.jpg`;
      const up = await uploadToBucket(path, jpeg, "image/jpeg");
      const realism = await scoreRealism(jpeg.toString("base64"));
      variations.push({ url: publicUrlFor(up.path), path: up.path, ...realism });
      console.log(`[personas/generate-image] variation ${i + 1}/${n} realism=${realism.realism_score}${realism.looks_ai ? " (looks AI)" : ""}`);
    } catch (e) {
      console.error(`[personas/generate-image] variation ${i + 1} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (variations.length === 0) return NextResponse.json({ success: false, error: "All variations failed to generate." }, { status: 502 });

  variations.sort((a, b) => b.realism_score - a.realism_score);
  const best = variations[0];

  if (body.save_best && body.persona_id && best) {
    await supabaseServer.from("personas").update({
      reference_image_url: best.url, realism_score: best.realism_score, realism_notes: best.notes,
    }).eq("id", body.persona_id);
  }

  return NextResponse.json({ success: true, prompt, variations, best });
}
