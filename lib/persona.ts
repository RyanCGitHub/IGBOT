// Persona helpers for persona-aware AI generation.
// When an account has no persona, every helper degrades to a no-op so existing
// flows behave exactly as before.

import { supabaseServer } from "@/lib/supabase-server";
import type { Persona } from "@/lib/supabase";

export async function getPersonaForAccount(
  accountId: number | null | undefined
): Promise<Persona | null> {
  if (accountId == null) return null;
  const { data } = await supabaseServer
    .from("personas")
    .select("*")
    .eq("account_id", accountId)
    .single(); // no row → data null (PGRST116 ignored)
  return (data as Persona) ?? null;
}

// A compact text block describing the persona, prepended to Claude prompts.
// Returns "" when there is no persona.
export function personaPromptBlock(persona: Persona | null): string {
  if (!persona) return "";
  const pillars =
    Array.isArray(persona.content_pillars) && persona.content_pillars.length
      ? persona.content_pillars.join(", ")
      : null;
  const lines = [
    "You are generating content AS this Instagram persona. Stay fully in character with its voice and themes.",
    `Persona name: ${persona.name}`,
    persona.handle_display ? `Handle: ${persona.handle_display}` : null,
    persona.persona_type ? `Persona type: ${persona.persona_type}` : null,
    persona.bio ? `Bio / backstory: ${persona.bio}` : null,
    persona.voice_and_tone ? `Voice & tone: ${persona.voice_and_tone}` : null,
    pillars ? `Content pillars: ${pillars}` : null,
    persona.audience_description ? `Audience: ${persona.audience_description}` : null,
    persona.hashtag_strategy ? `Hashtag strategy: ${persona.hashtag_strategy}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

// Append the AI-disclosure label to a caption when the persona requires it and it
// is not already present. No-op when there is no persona or disclosure is off.
export function applyDisclosure(caption: string, persona: Persona | null): string {
  if (!persona || !persona.ai_disclosure_enabled) return caption;
  const tag = (persona.ai_disclosure_text ?? "").trim();
  if (!tag || caption.includes(tag)) return caption;
  return `${caption.trimEnd()}\n\n${tag}`;
}
