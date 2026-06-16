// Reference Discovery Engine — pack assembly.
//
// discoverReferencePack(reelId) is the one entry point used by both the pipeline
// stage and the manual "Auto-find references" button. It:
//   1. reads the Reel's brief + persona + niche,
//   2. generates specific search queries,
//   3. searches the configured providers (Pexels direct-use + web reference-only),
//   4. filters junk (dupes, tiny images, watermark/real-person flags),
//   5. persists each surviving asset with full license metadata,
//   6. has Claude-vision analyze the thumbnails into a palette + lighting/camera/
//      environment/texture/realism guidance pack,
//   7. picks a license-clear "hero" background for optional direct compositing,
//   8. writes one reel_reference_packs row (superseding older packs for the Reel).
//
// It FAILS OPEN at every step: no provider keys, an API outage, or an analysis
// error all yield an empty/partial pack rather than blocking the Reel.

import { anthropic } from "@/lib/claude";
import { supabaseServer } from "@/lib/supabase-server";
import { getPersonaForAccount } from "@/lib/persona";
import type { ReelBrief } from "@/lib/reels/types";
import { generateReferenceQueries } from "./query-gen";
import {
  searchPexelsPhotos, searchPexelsVideos, searchWebImages,
  providerStatus, anyProviderConfigured,
} from "./providers";
import type { DiscoveredAsset, ReferencePack, ReferenceAsset, PackAnalysis, ReferenceQueries } from "./types";

const MODEL = "claude-sonnet-4-5";
const MIN_IMAGE_DIM = 500;       // drop direct-use stock below this on its short side
const MAX_IMAGES = 15;
const MAX_VIDEOS = 5;
const ANALYZE_THUMBS = 6;        // thumbnails sent to the vision analyzer

type DiscoveredWithQuery = DiscoveredAsset & { search_query: string };

// ─── Discovery + filtering ───────────────────────────────────────────────────

async function discover(queries: ReferenceQueries): Promise<DiscoveredWithQuery[]> {
  const { pexels, web } = providerStatus();
  const out: DiscoveredWithQuery[] = [];

  // Limit fan-out: a handful of queries is plenty and keeps API usage bounded.
  const qs = queries.queries.slice(0, 6);
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const tasks: Promise<DiscoveredAsset[]>[] = [];
    if (pexels) {
      tasks.push(searchPexelsPhotos(q, 4));
      if (i < 3) tasks.push(searchPexelsVideos(q, 2)); // videos only for the first few queries
    }
    if (web) tasks.push(searchWebImages(q, 3));
    const results = await Promise.all(tasks);
    for (const arr of results) for (const a of arr) out.push({ ...a, search_query: q });
  }
  return out;
}

function filterAndCap(assets: DiscoveredWithQuery[]): DiscoveredWithQuery[] {
  const seen = new Set<string>();
  const images: DiscoveredWithQuery[] = [];
  const videos: DiscoveredWithQuery[] = [];

  for (const a of assets) {
    const key = a.full_url || a.source_url || a.thumbnail_url || "";
    if (!key || seen.has(key)) continue;
    // Drop obviously-tiny direct-use stock; web results often lack dims, keep them.
    if (a.asset_type === "image" && a.width && a.height && Math.min(a.width, a.height) < MIN_IMAGE_DIM && a.direct_use_allowed) continue;
    seen.add(key);
    if (a.asset_type === "video") { if (videos.length < MAX_VIDEOS) videos.push(a); }
    else if (images.length < MAX_IMAGES) images.push(a);
  }
  // Direct-use assets first so the hero pick and grid favor license-clear stock.
  images.sort((a, b) => Number(b.direct_use_allowed) - Number(a.direct_use_allowed));
  return [...images, ...videos];
}

// Heuristic relevance (0-100): license-clean + portrait + resolution. The vision
// pass refines realism separately; this just orders the grid and hero pick.
function relevanceOf(a: DiscoveredWithQuery): number {
  let s = a.direct_use_allowed ? 70 : 45;
  if (a.width && a.height && a.height >= a.width) s += 12;            // portrait fits 9:16
  if (a.width && a.height && Math.min(a.width, a.height) >= 1080) s += 10;
  if (a.asset_type === "video") s += 3;
  return Math.min(100, s);
}

// ─── Vision analysis ─────────────────────────────────────────────────────────

async function analyzePack(thumbs: string[], topic: string): Promise<{ analysis: PackAnalysis; flagged: number[] }> {
  const empty: PackAnalysis = {
    color_palette: [], lighting_summary: "", camera_summary: "",
    environment_summary: "", texture_notes: "", realism_notes: "",
  };
  if (!thumbs.length) return { analysis: empty, flagged: [] };

  const images = thumbs.map((url, i) => ([
    { type: "text" as const, text: `Reference #${i}:` },
    { type: "image" as const, source: { type: "url" as const, url } },
  ])).flat();

  const instruction = `You are a cinematography reference analyst. These are ${thumbs.length} stock reference images for an Instagram Reel about: "${topic}".

Synthesize them into ONE concrete visual guide that an AI image generator can follow to make footage look like a real candid phone video of this scene. Also flag any reference that is unusable: visible watermark/logo text, or that shows an identifiable real/famous person's face.

Return ONLY JSON (no markdown):
{
  "color_palette": ["#rrggbb", ... up to 6 dominant colors],
  "lighting_summary": "one or two sentences: light direction, quality, color temperature, shadows",
  "camera_summary": "lens feel, height, angle, handheld vs stable, depth of field",
  "environment_summary": "the setting, key objects, textures, spatial layout",
  "texture_notes": "surface/material textures and grain that read as real",
  "realism_notes": "what specifically makes this look like real phone footage, not AI",
  "flagged_reference_indexes": [indexes of unusable references]
}`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      messages: [{ role: "user", content: [...images, { type: "text", text: instruction }] }],
    });
    const text = message.content.map(b => (b.type === "text" ? b.text : "")).join("").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const p = JSON.parse(text) as Partial<PackAnalysis> & { flagged_reference_indexes?: number[] };
    const hex = (s: unknown) => /^#[0-9a-f]{6}$/i.test(String(s));
    return {
      analysis: {
        color_palette: Array.isArray(p.color_palette) ? p.color_palette.filter(hex).slice(0, 6) : [],
        lighting_summary: String(p.lighting_summary ?? "").slice(0, 400),
        camera_summary: String(p.camera_summary ?? "").slice(0, 400),
        environment_summary: String(p.environment_summary ?? "").slice(0, 500),
        texture_notes: String(p.texture_notes ?? "").slice(0, 400),
        realism_notes: String(p.realism_notes ?? "").slice(0, 500),
      },
      flagged: Array.isArray(p.flagged_reference_indexes) ? p.flagged_reference_indexes.map(Number).filter(n => Number.isInteger(n)) : [],
    };
  } catch (e) {
    console.warn(`[references] vision analysis failed:`, e instanceof Error ? e.message : e);
    return { analysis: empty, flagged: [] };
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

type ReelRow = { account_id: number; persona_id: number | null; brief: ReelBrief | null };

async function loadReel(reelId: number): Promise<ReelRow | null> {
  const { data } = await supabaseServer
    .from("reel_runs").select("account_id, persona_id, brief").eq("id", reelId).maybeSingle();
  return (data as ReelRow) ?? null;
}

async function writeEmptyPack(reelId: number, reel: ReelRow, topic: string, queries: string[], note: string): Promise<ReferencePack> {
  await supabaseServer.from("reel_reference_packs").update({ superseded: true }).eq("reel_id", reelId).eq("superseded", false);
  const { data } = await supabaseServer.from("reel_reference_packs").insert({
    reel_id: reelId, persona_id: reel.persona_id, account_id: reel.account_id,
    topic, generated_search_queries: queries, status: "empty", realism_notes: note,
  }).select("*").single();
  return data as ReferencePack;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function discoverReferencePack(reelId: number): Promise<{ pack: ReferencePack; assets: ReferenceAsset[] }> {
  const reel = await loadReel(reelId);
  if (!reel) throw new Error(`Reel ${reelId} not found.`);
  if (!reel.brief) throw new Error(`Reel ${reelId} has no brief yet — references need the brief first.`);

  const persona = await getPersonaForAccount(reel.account_id);
  const { data: account } = await supabaseServer
    .from("connected_accounts").select("niche").eq("id", reel.account_id).maybeSingle();
  const niche = (account as { niche: string | null } | null)?.niche ?? null;

  const queries = await generateReferenceQueries(reel.brief, persona, niche);

  // No providers configured → write an empty pack and let the Reel proceed.
  if (!anyProviderConfigured()) {
    const pack = await writeEmptyPack(reelId, reel, queries.topic, queries.queries,
      "No reference providers configured (set PEXELS_API_KEY and/or SERPAPI_KEY / GOOGLE_CSE_KEY+CX).");
    return { pack, assets: [] };
  }

  const discovered = filterAndCap(await discover(queries));
  if (discovered.length === 0) {
    const pack = await writeEmptyPack(reelId, reel, queries.topic, queries.queries,
      "Providers returned no usable references for this topic.");
    return { pack, assets: [] };
  }

  // Analyze the first few thumbnails (prefer direct-use stock, already sorted first).
  const thumbs = discovered.map(a => a.thumbnail_url).filter((u): u is string => !!u).slice(0, ANALYZE_THUMBS);
  const { analysis, flagged } = await analyzePack(thumbs, queries.topic);
  const flaggedSet = new Set(flagged);

  // Persist assets with full license metadata + brief-derived tags.
  const rows = discovered.map((a, i) => ({
    reel_id: reelId, account_id: reel.account_id, persona_id: reel.persona_id,
    source_provider: a.source_provider, source_url: a.source_url, full_url: a.full_url,
    thumbnail_url: a.thumbnail_url, asset_type: a.asset_type,
    width: a.width, height: a.height, duration_s: a.duration_s,
    license_type: a.license_type, license_url: a.license_url, creator_name: a.creator_name,
    source_domain: a.source_domain, search_query: a.search_query,
    tags: [queries.topic, a.search_query].filter(Boolean),
    location_type: queries.location_type, lighting_style: analysis.lighting_summary || null,
    camera_style: queries.camera_style, mood: queries.mood,
    // A flagged reference (watermark / real person) is demoted to reference-only + review.
    direct_use_allowed: a.direct_use_allowed && !flaggedSet.has(i),
    reference_only: a.reference_only || flaggedSet.has(i),
    needs_review: a.needs_review || flaggedSet.has(i),
    relevance_score: relevanceOf(a),
  }));

  const { data: inserted, error } = await supabaseServer.from("reference_assets").insert(rows).select("*");
  if (error) throw new Error(`Failed to save reference assets: ${error.message}`);
  const assets = (inserted as ReferenceAsset[]) ?? [];

  // Hero = highest-relevance license-clear portrait image for optional direct compositing.
  const hero = assets
    .filter(a => a.asset_type === "image" && a.direct_use_allowed)
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))[0] ?? null;

  await supabaseServer.from("reel_reference_packs").update({ superseded: true }).eq("reel_id", reelId).eq("superseded", false);
  const { data: packRow, error: packErr } = await supabaseServer.from("reel_reference_packs").insert({
    reel_id: reelId, persona_id: reel.persona_id, account_id: reel.account_id,
    topic: queries.topic, generated_search_queries: queries.queries,
    selected_asset_ids: assets.map(a => a.id),
    color_palette: analysis.color_palette,
    lighting_summary: analysis.lighting_summary || null,
    camera_summary: analysis.camera_summary || null,
    environment_summary: analysis.environment_summary || null,
    texture_notes: analysis.texture_notes || null,
    realism_notes: analysis.realism_notes || null,
    hero_asset_id: hero?.id ?? null,
    status: "ready",
  }).select("*").single();
  if (packErr) throw new Error(`Failed to save reference pack: ${packErr.message}`);

  console.log(`[references] reel ${reelId}: ${assets.length} assets (${assets.filter(a => a.direct_use_allowed).length} direct-use), hero=${hero?.id ?? "none"}`);
  return { pack: packRow as ReferencePack, assets };
}

// ─── Consumption: guidance block injected into keyframe prompts ───────────────

export type ReelReferenceContext = {
  guidance: string;            // text appended to the image prompt
  heroAssetId: number | null;  // license-clear background available for direct compositing
};

// Reads the current (non-superseded) pack for a Reel and turns it into a prompt
// addendum. Returns empty guidance when there is no pack — callers stay no-op.
export async function getReferenceContext(reelId: number): Promise<ReelReferenceContext> {
  const { data } = await supabaseServer
    .from("reel_reference_packs").select("*")
    .eq("reel_id", reelId).eq("superseded", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const pack = data as ReferencePack | null;
  if (!pack || pack.status !== "ready") return { guidance: "", heroAssetId: null };

  const lines = [
    "REAL-WORLD VISUAL REFERENCE (match these to look like authentic phone footage of the real place):",
    pack.environment_summary ? `Environment: ${pack.environment_summary}` : "",
    pack.lighting_summary ? `Lighting: ${pack.lighting_summary}` : "",
    pack.camera_summary ? `Camera: ${pack.camera_summary}` : "",
    pack.texture_notes ? `Textures: ${pack.texture_notes}` : "",
    pack.color_palette?.length ? `Color palette: ${pack.color_palette.join(", ")}` : "",
    pack.realism_notes ? `Realism: ${pack.realism_notes}` : "",
  ].filter(Boolean);
  if (lines.length <= 1) return { guidance: "", heroAssetId: pack.hero_asset_id };
  return { guidance: lines.join("\n"), heroAssetId: pack.hero_asset_id };
}
