import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import { clipRightsVerdict, sourcePublishability } from "@/lib/media-network/compliance";
import type { ClipAsset, MediaBrand, ContentSource } from "@/lib/media-network/types";

// Turns a clip asset into a content_package: hook, caption per the clip-page
// structure, hashtags, on-screen title. Rights verdict gates generation —
// needs_review/blocked rights or HIGH impersonation risk refuse outright.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-5";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { clip_asset_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const clipId = Number(body.clip_asset_id);
  if (!Number.isInteger(clipId) || clipId < 1) {
    return NextResponse.json({ success: false, error: "clip_asset_id is required." }, { status: 400 });
  }

  const { data: clip } = await supabaseServer.from("clip_assets").select("*").eq("id", clipId).single<ClipAsset>();
  if (!clip) return NextResponse.json({ success: false, error: "Clip not found." }, { status: 404 });
  if (clip.status === "rejected") return NextResponse.json({ success: false, error: "Clip was rejected." }, { status: 400 });
  if (!clip.uploaded_file_url) return NextResponse.json({ success: false, error: "Clip has no uploaded media." }, { status: 400 });

  const { data: brand } = await supabaseServer.from("media_brands").select("*").eq("id", clip.media_brand_id).single<MediaBrand>();
  if (!brand) return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });

  // ── Compliance gates before any generation ──────────────────────────────────
  const rightsVerdict = clipRightsVerdict(clip.rights_status, clip.impersonation_risk);
  if (!rightsVerdict.allowed) {
    return NextResponse.json({ success: false, error: rightsVerdict.blockers.join(" ") }, { status: 400 });
  }
  let source: ContentSource | null = null;
  if (clip.source_id) {
    const { data } = await supabaseServer.from("content_sources").select("*").eq("id", clip.source_id).single<ContentSource>();
    source = data;
    if (source) {
      const sv = sourcePublishability(source.permission_status);
      if (!sv.allowed) return NextResponse.json({ success: false, error: sv.blockers.join(" ") }, { status: 400 });
    }
  }

  const creditText = clip.source_credit_text
    || (clip.streamer_name ? `Credit: ${clip.streamer_name}${clip.streamer_platform ? ` (${clip.streamer_platform})` : ""}` : null);
  if (!creditText) {
    return NextResponse.json({ success: false, error: "No credit text — add streamer name or source credit first." }, { status: 400 });
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const context = [
    `Brand: ${brand.brand_name} (${brand.sub_niche ?? "streamer clips"})`,
    brand.brand_voice ? `Brand voice: ${brand.brand_voice}` : null,
    `Clip: ${clip.clip_title}`,
    clip.streamer_name ? `Streamer: ${clip.streamer_name} (${clip.streamer_platform ?? "?"})` : null,
    clip.game_or_category ? `Game/category: ${clip.game_or_category}` : null,
    clip.clip_moment_type ? `Moment type: ${clip.clip_moment_type}` : null,
    clip.clip_summary ? `What happens: ${clip.clip_summary}` : null,
    clip.transcript ? `Transcript (excerpt): ${clip.transcript.slice(0, 1200)}` : null,
  ].filter(Boolean).join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1_000,
    messages: [{
      role: "user",
      content: `You write Instagram captions for a streamer-clip page (think fan-run clip accounts): fast, funny, viral energy — never corporate.

${context}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "hook": "scroll-stopping first line, max 10 words, can use one emoji",
  "caption": "the full caption: hook line, one line of context (what stream/when if known), short reaction line. NO hashtags here. NO credit here (appended separately).",
  "on_screen_text": "video title overlay, max 8 words, plain words",
  "hashtags": "#tag1 #tag2 #tag3 (3-5: streamer/game/community tags)",
  "engagement_question": "a fast binary-style question (W or L? / real or acting?)"
}

Rules:
- Respond with ONLY the JSON object
- Third-person fan-page voice ALWAYS — never write as if you ARE the streamer, never first person
- Use the streamer's name in hook or caption
- Don't invent things that aren't in the summary/transcript
- Keep it short — clip pages are not essays`,
    }],
  });

  const text = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map(b => b.text).join("").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  let gen: { hook?: string; caption?: string; on_screen_text?: string; hashtags?: string; engagement_question?: string };
  try { gen = JSON.parse(text) as typeof gen; }
  catch { return NextResponse.json({ success: false, error: "Generator returned invalid JSON." }, { status: 502 }); }

  let caption = String(gen.caption ?? "").trim();
  if (gen.engagement_question && !caption.includes(String(gen.engagement_question))) {
    caption = `${caption}\n\n${gen.engagement_question}`;
  }
  caption = `${caption}\n\n${creditText}`;

  const complianceNotes = [...rightsVerdict.warnings];
  if (source) complianceNotes.push(...sourcePublishability(source.permission_status).warnings);

  // The uploaded clip is the package media for now; Clip Studio (Phase 4.5)
  // replaces it with the subtitled/branded processed version.
  const uploadedPath = clip.uploaded_file_url?.split("/instagram-media/")[1] ?? null;

  const { data: pkg, error: pkgErr } = await supabaseServer
    .from("content_packages")
    .insert({
      media_brand_id: brand.id,
      connected_account_id: brand.connected_account_id,
      source_clip_asset_id: clip.id,
      package_family: "streamer_clips",
      package_type: "clip_reel",
      title: clip.clip_title.slice(0, 200),
      hook: String(gen.hook ?? "").slice(0, 300) || null,
      caption,
      hashtags: String(gen.hashtags ?? "").slice(0, 300) || null,
      on_screen_text: String(gen.on_screen_text ?? "").slice(0, 200) || null,
      source_credit_text: creditText,
      source_urls: clip.original_clip_url ? [clip.original_clip_url] : [],
      compliance_notes: complianceNotes.join("\n") || null,
      rights_status: clip.rights_status,
      processed_media_path: uploadedPath,
      urgency_level: clip.clip_moment_type === "drama" || clip.clip_moment_type === "newsworthy" ? "high" : "low",
      status: "draft",
    })
    .select("*")
    .single();

  if (pkgErr || !pkg) return NextResponse.json({ success: false, error: pkgErr?.message ?? "Package insert failed." }, { status: 500 });

  await supabaseServer.from("clip_assets").update({ status: "used", updated_at: new Date().toISOString() }).eq("id", clip.id);

  return NextResponse.json({ success: true, package: pkg, complianceNotes });
}
