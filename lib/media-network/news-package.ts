import { anthropic } from "@/lib/claude";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadToBucket } from "@/lib/reels/storage";
import { renderHeadlineGraphic } from "@/lib/media-network/headline-graphic";
import { sourceBackgroundImage } from "@/lib/media-network/background-image";
import { renderMotionReel } from "@/lib/media-network/motion-graphic";
import { sourcePublishability, newsVerificationVerdict } from "@/lib/media-network/compliance";
import type { ContentPackage, NewsItem, MediaBrand, ContentSource } from "@/lib/media-network/types";

// Shared package-generation core. Turns a reviewed news item into a
// content_package (caption + carousel + headline graphic), enforcing the same
// compliance + hedging rules whether the caller is the manual route or the
// auto-pilot worker. Lives here (not inline in the route) so both share ONE
// implementation — the hedging/prompt logic must never drift between them.

const MODEL = "claude-sonnet-4-5";
const HEDGE_WORDS = ["alleged", "allegedly", "developing", "unconfirmed", "reportedly", "rumor", "user-submitted", "claims", "according to"];

export type BuildPackageResult =
  | { ok: true; package: ContentPackage; complianceNotes: string[] }
  | { ok: false; status: number; error: string };

export async function buildNewsPackage(
  itemId: number,
  packageTypeRaw?: string,
  opts?: { mode?: "auto" | "manual" }
): Promise<BuildPackageResult> {
  const manual = opts?.mode === "manual";
  const packageType = ["breaking_news_reel", "news_carousel", "image_headline_post"].includes(String(packageTypeRaw))
    ? String(packageTypeRaw)
    : "image_headline_post";

  // ── Load item + brand + source, run compliance up front ────────────────────
  const { data: item } = await supabaseServer.from("news_items").select("*").eq("id", itemId).single<NewsItem>();
  if (!item) return { ok: false, status: 404, error: "News item not found." };
  if (item.status === "rejected") return { ok: false, status: 400, error: "Item was rejected." };

  const { data: brand } = await supabaseServer.from("media_brands").select("*").eq("id", item.media_brand_id).single<MediaBrand>();
  if (!brand) return { ok: false, status: 404, error: "Brand not found." };

  let source: ContentSource | null = null;
  if (item.source_id) {
    const { data } = await supabaseServer.from("content_sources").select("*").eq("id", item.source_id).single<ContentSource>();
    source = data;
  }
  if (source) {
    const verdict = sourcePublishability(source.permission_status);
    if (!verdict.allowed) {
      return { ok: false, status: 400, error: verdict.blockers.join(" ") };
    }
  }
  if (item.sensitivity_level === "high" && item.status !== "approved") {
    return { ok: false, status: 400, error: "HIGH sensitivity item — approve it in review before generating a package." };
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const isUnverified = item.verification_status === "unverified" || item.verification_status === "single_source";
  const referenceOnly = source?.permission_status === "public_reference_only";

  const context = [
    `Brand: ${brand.brand_name} (${brand.sub_niche ?? brand.niche ?? "news"})${brand.city_or_region ? `, ${brand.city_or_region}` : ""}`,
    brand.brand_voice ? `Brand voice: ${brand.brand_voice}` : null,
    `Headline: ${item.headline}`,
    item.short_summary ? `Summary: ${item.short_summary}` : null,
    item.full_context ? `Context: ${item.full_context}` : null,
    item.people_or_brands_involved ? `People/brands involved: ${item.people_or_brands_involved}` : null,
    `Claim type: ${item.claim_type} | Verification: ${item.verification_status} | Sensitivity: ${item.sensitivity_level}`,
    `Source: ${item.source_name ?? source?.source_name ?? "unknown"}${item.source_url ? ` (${item.source_url})` : ""}`,
  ].filter(Boolean).join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1_500,
    messages: [{
      role: "user",
      content: `You write Instagram posts for a news/media page (think @akademiks / local news pages): short, punchy, credible.

${context}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "hook": "strong first line, max 12 words",
  "caption": "the full caption: hook line, short context (2-3 lines), key facts, then the engagement question. NO hashtags here. NO source credit here (appended separately).",
  "carousel_slides": ["slide 1 text (the hook)", "slide 2 text", "slide 3 text"],
  "headline_graphic_text": "compressed headline for the image graphic, max 12 words",
  "image_subject": "the single best real, well-known person or entity to use as the background PHOTO (e.g. 'Taylor Swift', 'Travis Kelce', 'Boston Celtics') — pick the most recognizable one named in the story; if no clear public figure, give a short literal scene phrase (e.g. 'NBA arena at night')",
  "reel_script": "a 30-45 second spoken script covering the story, or null if this works better as an image post",
  "hashtags": "#tag1 #tag2 #tag3 (3-5, niche-relevant)",
  "engagement_question": "one genuine question, answerable in a few words"
}

Rules:
- Respond with ONLY the JSON object
- NEVER state anything beyond what the summary/context supports — no invented details, numbers, or quotes
${isUnverified ? '- This story is NOT fully verified: the caption MUST use hedging language ("reportedly", "according to ' + (item.source_name ?? "the source") + '", "developing") and read as developing news, never as established fact' : ""}
${item.claim_type === "rumor" ? "- This is a RUMOR: it must be framed explicitly as unconfirmed" : ""}
${item.claim_type === "user_submitted" ? "- User-submitted: caption must note it is user-submitted and unverified" : ""}
${referenceOnly ? "- Reference-only source: summarize in OUR OWN words; do not quote at length or imply we have their media" : ""}
${item.sensitivity_level === "high" ? "- HIGH sensitivity: neutral careful wording, no speculation, attribute every claim to the source, no graphic detail" : ""}
- Never impersonate the source outlet; we are reporting on it
- Short sentences. No corporate filler.`,
    }],
  });

  const text = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map(b => b.text).join("").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let gen: {
    hook?: string; caption?: string; carousel_slides?: string[]; headline_graphic_text?: string;
    image_subject?: string; reel_script?: string | null; hashtags?: string; engagement_question?: string;
  };
  try { gen = JSON.parse(text) as typeof gen; }
  catch { return { ok: false, status: 502, error: "Generator returned invalid JSON." }; }

  const creditText = item.source_credit_text || `Source: ${item.source_name ?? source?.source_name ?? "see link"}`;
  let caption = String(gen.caption ?? "").trim();
  if (gen.engagement_question && !caption.includes(String(gen.engagement_question))) {
    caption = `${caption}\n\n${gen.engagement_question}`;
  }
  caption = `${caption}\n\n${creditText}`;

  // Deterministic hedging backstop (compliance V: rumors never read as facts).
  if (isUnverified && !HEDGE_WORDS.some(w => caption.toLowerCase().includes(w))) {
    caption = `DEVELOPING: ${caption}`;
  }

  // ── Headline graphic (+ manual-lane motion Reel) ────────────────────────────
  let processedMediaPath: string | null = null;
  let manualVideoPath: string | null = null;
  const complianceNotes: string[] = [];
  const tag = item.claim_type === "confirmed" && item.verification_status === "official_source"
    ? "BREAKING" : isUnverified ? "DEVELOPING" : null;
  const headlineText = String(gen.headline_graphic_text ?? item.headline).slice(0, 140);
  // Lead with a real (license-clean) photo of the subject, else an editorial
  // backdrop — never a blank background. (sourceBackgroundImage never throws.)
  const bg = await sourceBackgroundImage({
    subject: gen.image_subject ?? item.people_or_brands_involved ?? null,
    sceneHint: headlineText,
  });

  try {
    const graphic = await renderHeadlineGraphic({
      brandName: brand.brand_name,
      handle: brand.instagram_handle,
      headline: headlineText,
      tag,
      creditText,
      background: bg?.buffer ?? null,
      photoCredit: bg?.attribution ?? null,
    });
    const upload = await uploadToBucket(`media-network/${brand.id}/news-${item.id}-${Date.now()}.jpg`, graphic, "image/jpeg");
    processedMediaPath = upload.path;
  } catch (e) {
    complianceNotes.push(`Headline graphic failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Manual lane: also render a silent 9:16 motion Reel for in-app upload.
  if (manual) {
    try {
      const still = await renderHeadlineGraphic({
        brandName: brand.brand_name,
        handle: brand.instagram_handle,
        headline: headlineText,
        tag,
        creditText,
        background: bg?.buffer ?? null,
        photoCredit: bg?.attribution ?? null,
        heightPx: 1920,
      });
      const video = await renderMotionReel(still);
      const up = await uploadToBucket(`media-network/${brand.id}/news-${item.id}-${Date.now()}.mp4`, video, "video/mp4");
      manualVideoPath = up.path;
    } catch (e) {
      complianceNotes.push(`Manual motion video failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const verdict = newsVerificationVerdict(item.verification_status, item.sensitivity_level, caption);
  complianceNotes.push(...verdict.blockers.map(b => `BLOCKER: ${b}`), ...verdict.warnings);
  if (source) complianceNotes.push(...sourcePublishability(source.permission_status).warnings);

  // ── Create the package ──────────────────────────────────────────────────────
  const { data: pkg, error: pkgErr } = await supabaseServer
    .from("content_packages")
    .insert({
      media_brand_id: brand.id,
      connected_account_id: brand.connected_account_id,
      source_news_item_id: item.id,
      package_family: "news_media",
      package_type: packageType,
      title: item.headline.slice(0, 200),
      hook: String(gen.hook ?? "").slice(0, 300) || null,
      caption,
      hashtags: String(gen.hashtags ?? "").slice(0, 300) || null,
      on_screen_text: String(gen.headline_graphic_text ?? "").slice(0, 300) || null,
      carousel_slide_text: Array.isArray(gen.carousel_slides) ? gen.carousel_slides.slice(0, 8) : null,
      source_credit_text: creditText,
      source_urls: item.source_url ? [item.source_url] : [],
      compliance_notes: complianceNotes.join("\n") || null,
      rights_status: source ? source.permission_status : "needs_review",
      verification_status: item.verification_status,
      processed_media_path: processedMediaPath,
      manual_only: manual,
      manual_video_path: manualVideoPath,
      urgency_level: item.claim_type === "confirmed" ? "high" : "medium",
      // Manual items wait in the Manual Queue (status "ready"); auto items follow
      // the compliance verdict into draft/idea for the auto-pilot.
      status: manual ? "ready" : (verdict.allowed ? "draft" : "idea"),
    })
    .select("*")
    .single<ContentPackage>();

  if (pkgErr || !pkg) return { ok: false, status: 500, error: pkgErr?.message ?? "Package insert failed." };

  await supabaseServer.from("news_items").update({ status: "used", updated_at: new Date().toISOString() }).eq("id", item.id);

  return { ok: true, package: pkg, complianceNotes };
}
