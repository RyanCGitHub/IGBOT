import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { normalizeForInstagram } from "@/lib/image-normalize";
import { getImageProvider, IMAGE_DAILY_CAP } from "@/lib/media-generation";
import { getPersonaForAccount } from "@/lib/persona";

const PROMPT_MAX = 4_000;
const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const BUCKET = "instagram-media"; // reuse the existing bucket

type GenerateBody = {
  account_id?: number;
  prompt?: string;
  persona_id?: number;
  draft_id?: number;
  size?: string;
};

// POST /api/media/generate-image
// Generates one image with the persona's visual style prepended, normalizes it
// for Instagram, stores it in the existing bucket, and logs it to generated_media.
// Returns imageUrl/path shaped like the upload route so the UI attaches it to a
// draft via the same data path. Never auto-attaches, never publishes/schedules.
export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const accountId = Number(body.account_id);
  if (!Number.isInteger(accountId) || accountId < 1) {
    return NextResponse.json({ success: false, error: "account_id is required." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ success: false, error: "prompt is required." }, { status: 400 });
  }
  if (prompt.length > PROMPT_MAX) {
    return NextResponse.json({ success: false, error: `prompt must be ${PROMPT_MAX} characters or fewer.` }, { status: 400 });
  }

  const size = body.size && ALLOWED_SIZES.has(body.size) ? body.size : "1024x1024";

  // ── Per-account daily cap (successful images in the last 24h) ────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: capErr } = await supabaseServer
    .from("generated_media")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("media_type", "image")
    .eq("status", "generated")
    .gte("created_at", since);

  if (capErr) {
    return NextResponse.json({ success: false, error: capErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= IMAGE_DAILY_CAP) {
    return NextResponse.json(
      { success: false, error: `Daily image generation cap reached (${IMAGE_DAILY_CAP}/day) for this account. Try again later.` },
      { status: 429 }
    );
  }

  // ── Compose the prompt: always prepend the persona's visual style ────────────
  const persona = await getPersonaForAccount(accountId);
  const personaId = body.persona_id ?? persona?.id ?? null;
  const visualStyle = persona?.visual_style?.trim();
  const composedPrompt = visualStyle ? `${visualStyle}\n\n${prompt}` : prompt;

  const provider = getImageProvider();

  // ── Generate (log a failed row on provider error) ────────────────────────────
  let result;
  try {
    result = await provider.generateImage(composedPrompt, { size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[media/generate-image] provider error:", msg);
    await supabaseServer.from("generated_media").insert({
      account_id: accountId,
      persona_id: personaId,
      draft_id: body.draft_id ?? null,
      prompt_used: composedPrompt,
      provider: provider.name,
      media_type: "image",
      status: "failed",
      error_message: msg,
    });
    return NextResponse.json({ success: false, error: `Image generation failed: ${msg}` }, { status: 502 });
  }

  // ── Normalize for Instagram (reuse the existing pipeline) ────────────────────
  let normalized: Awaited<ReturnType<typeof normalizeForInstagram>>;
  try {
    const inputBuffer = Buffer.from(result.base64, "base64");
    normalized = await normalizeForInstagram(inputBuffer, result.mimeType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseServer.from("generated_media").insert({
      account_id: accountId,
      persona_id: personaId,
      draft_id: body.draft_id ?? null,
      prompt_used: composedPrompt,
      provider: provider.name,
      media_type: "image",
      status: "failed",
      error_message: `Normalization failed: ${msg}`,
      provider_meta: result.providerMeta,
    });
    return NextResponse.json({ success: false, error: `Image processing failed: ${msg}` }, { status: 500 });
  }

  // ── Upload to the existing bucket under generated/ ───────────────────────────
  const { buffer, meta } = normalized;
  const storagePath = `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { data: uploadData, error: uploadErr } = await supabaseServer.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

  if (uploadErr || !uploadData) {
    await supabaseServer.from("generated_media").insert({
      account_id: accountId,
      persona_id: personaId,
      draft_id: body.draft_id ?? null,
      prompt_used: composedPrompt,
      provider: provider.name,
      media_type: "image",
      status: "failed",
      error_message: `Storage upload failed: ${uploadErr?.message ?? "unknown"}`,
      provider_meta: result.providerMeta,
    });
    return NextResponse.json({ success: false, error: `Storage upload failed: ${uploadErr?.message ?? "unknown"}` }, { status: 500 });
  }

  const { data: urlData } = supabaseServer.storage.from(BUCKET).getPublicUrl(uploadData.path);

  // ── Log the successful generation ────────────────────────────────────────────
  const { data: row, error: insertErr } = await supabaseServer
    .from("generated_media")
    .insert({
      account_id: accountId,
      persona_id: personaId,
      draft_id: body.draft_id ?? null,
      prompt_used: composedPrompt,
      provider: provider.name,
      storage_path: uploadData.path,
      media_type: "image",
      status: "generated",
      provider_meta: result.providerMeta,
    })
    .select("id")
    .single();

  if (insertErr) {
    // Image is stored and usable; just couldn't log it. Surface a soft warning.
    console.error("[media/generate-image] log insert failed:", insertErr.message);
  }

  console.log(`[media/generate-image] account ${accountId} → generated image (${provider.name}, ${size})`);

  return NextResponse.json({
    success: true,
    imageUrl: urlData.publicUrl,
    path: uploadData.path,
    normalization: meta,
    generatedMediaId: row?.id ?? null,
    promptUsed: composedPrompt,
  });
}
