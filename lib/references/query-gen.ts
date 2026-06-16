// Reference Discovery Engine — search query generation.
//
// Turns a Reel's brief (topic, hook, beats, visual style, location, mood) plus
// the persona/niche into 5-10 SPECIFIC stock-search strings. Specificity is the
// whole game: "luxury restaurant interior warm candlelight table setting" finds
// useful references; "restaurant" does not.

import { anthropic } from "@/lib/claude";
import type { Persona } from "@/lib/supabase";
import type { ReelBrief } from "@/lib/reels/types";
import type { ReferenceQueries } from "./types";

const MODEL = "claude-sonnet-4-5";

function fallbackQueries(brief: ReelBrief): ReferenceQueries {
  const base = brief.event_location || brief.title || brief.content_pillar || "lifestyle scene";
  return {
    topic: brief.title,
    location_type: brief.event_location ?? null,
    mood: brief.audio_mood ?? null,
    camera_style: null,
    queries: [
      `${base} candid phone photo`,
      `${base} natural lighting`,
      `${base} interior environment`,
      `${base} handheld footage`,
      `${base} realistic everyday`,
    ],
  };
}

export async function generateReferenceQueries(
  brief: ReelBrief,
  persona: Persona | null,
  niche: string | null
): Promise<ReferenceQueries> {
  const beats = brief.beats.map(b => `- ${b.subtitle}: ${b.image_prompt}`).join("\n");
  const instruction = `You generate stock-footage / stock-photo SEARCH QUERIES that will be used to find real visual REFERENCES (lighting, environment, composition, mood, texture) for an AI-generated Instagram Reel. The references make the AI footage look like real phone footage of a real place.

REEL
Title: ${brief.title}
Hook: ${brief.hook}
Content pillar: ${brief.content_pillar}
Visual style: ${brief.visual_style}
Mood (audio): ${brief.audio_mood}
${brief.event_location ? `Real location: ${brief.event_location}` : ""}
Caption angle: ${brief.caption_angle}
Hashtags: ${brief.hashtags}
Beats:
${beats}
${niche ? `Account niche: ${niche}` : ""}
${persona?.visual_style ? `Persona visual style: ${persona.visual_style}` : ""}

Write 5-10 DISTINCT, SPECIFIC search queries. Rules:
- Each query 3-7 words, the kind that returns real stock photos/videos.
- Cover variety: the environment/interior, the lighting, key objects/props, wide establishing context, AND at least one "candid handheld phone footage" angle for realism.
- Describe scene/place/lighting/objects — NOT named real people or copyrighted characters.
- Never request a specific celebrity or identifiable real person's face.

Return ONLY JSON (no markdown):
{ "topic": "short topic label", "location_type": "string or null", "mood": "string or null", "camera_style": "string or null", "queries": ["...", "..."] }`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: instruction }],
    });
    const text = message.content
      .map(b => (b.type === "text" ? b.text : "")).join("").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const p = JSON.parse(text) as Partial<ReferenceQueries>;
    const queries = Array.isArray(p.queries)
      ? p.queries.map(q => String(q).trim()).filter(Boolean).slice(0, 10)
      : [];
    if (queries.length < 3) return fallbackQueries(brief);
    return {
      topic: String(p.topic ?? brief.title).slice(0, 120),
      location_type: p.location_type ? String(p.location_type).slice(0, 80) : (brief.event_location ?? null),
      mood: p.mood ? String(p.mood).slice(0, 60) : (brief.audio_mood ?? null),
      camera_style: p.camera_style ? String(p.camera_style).slice(0, 80) : null,
      queries,
    };
  } catch (e) {
    console.warn(`[references] query-gen failed, using fallback:`, e instanceof Error ? e.message : e);
    return fallbackQueries(brief);
  }
}
