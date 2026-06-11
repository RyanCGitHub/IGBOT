import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import type { ScheduleSuggestion } from "@/lib/supabase";
import { getPersonaForAccount, personaPromptBlock } from "@/lib/persona";

const NOTES_MAX = 2_000;
const MODEL = "claude-sonnet-4-5";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 14;

type GenerateBody = {
  campaign_id?: number;
  account_id?: number;
  start_date?: string;
  end_date?: string;
  count?: number;
  notes?: string;
};

// Parse a date input. If it is date-only (no time component), the end of the
// range is stretched to the end of that day so the whole day is included.
function parseRange(start: string, end: string): { startMs: number; endMs: number } | null {
  const startMs = new Date(start).getTime();
  let endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  if (!end.includes("T")) endMs += 24 * 60 * 60 * 1000 - 1; // include the full end day
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

function buildPrompt(
  context: {
    campaign: { name: string; description: string | null; content_style: string | null } | null;
    accountName: string | null;
    startIso: string;
    endIso: string;
    count: number;
    notes: string | null;
    occupied: string[];
  }
): string {
  const lines = [
    context.campaign ? `Campaign: ${context.campaign.name}` : "Campaign: (none specified)",
    context.campaign?.description ? `Campaign theme/description: ${context.campaign.description}` : null,
    context.campaign?.content_style ? `Content style / niche: ${context.campaign.content_style}` : null,
    context.accountName ? `Target Instagram account: @${context.accountName}` : null,
    `Planning window (UTC): ${context.startIso} to ${context.endIso}`,
    context.notes ? `User notes: ${context.notes}` : null,
    context.occupied.length
      ? `Already-scheduled times to AVOID (UTC): ${context.occupied.join(", ")}`
      : `No posts are currently scheduled in this window.`,
  ].filter(Boolean).join("\n");

  return `You are an Instagram scheduling strategist. Recommend ${context.count} posting time slots.

${lines}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "suggestions": [
    {
      "recommended_at": "ISO 8601 datetime in UTC, e.g. 2026-06-15T17:00:00Z",
      "reason": "why this time works for this audience",
      "theme": "suggested post theme or idea for this slot"
    }
  ]
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- Produce exactly ${context.count} suggestions
- Every recommended_at MUST be in UTC ISO 8601 and fall within the planning window
- Spread the slots out across the window; do NOT cluster them
- Avoid the already-scheduled times listed above
- Use realistic high-engagement posting times for the audience
- These are suggestions only — nothing will be scheduled automatically`;
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.start_date || !body.end_date) {
    return NextResponse.json(
      { success: false, error: "start_date and end_date are required." },
      { status: 400 }
    );
  }

  const range = parseRange(body.start_date, body.end_date);
  if (!range) {
    return NextResponse.json(
      { success: false, error: "Invalid date range. end_date must be a valid date after start_date." },
      { status: 400 }
    );
  }
  const { startMs, endMs } = range;

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return NextResponse.json(
      { success: false, error: `notes must be ${NOTES_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  const count = Math.min(MAX_COUNT, Math.max(1, Number(body.count) || DEFAULT_COUNT));

  // ── Optional campaign ─────────────────────────────────────────────────────────
  let campaign: { name: string; description: string | null; content_style: string | null } | null = null;
  if (body.campaign_id) {
    const { data, error } = await supabaseServer
      .from("campaigns")
      .select("name, description, content_style")
      .eq("id", body.campaign_id)
      .single();
    if (error || !data) {
      return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
    }
    campaign = data;
  }

  // ── Optional account label (display/context only — never affects publishing) ──
  let accountName: string | null = null;
  if (body.account_id) {
    const { data } = await supabaseServer
      .from("connected_accounts")
      .select("account_name")
      .eq("id", body.account_id)
      .single();
    accountName = data?.account_name ?? null;
  }

  // Persona context (in-character suggestions when the account has one)
  const persona = await getPersonaForAccount(body.account_id ?? null);
  const personaBlock = personaPromptBlock(persona);

  // ── Existing scheduled posts in the window (occupied slots) ──────────────────
  let occupiedQuery = supabaseServer
    .from("ig_posts")
    .select("scheduled_at, account_id")
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", new Date(startMs).toISOString())
    .lte("scheduled_at", new Date(endMs).toISOString());
  if (body.account_id) occupiedQuery = occupiedQuery.eq("account_id", body.account_id);

  const { data: occupiedRows } = await occupiedQuery;
  const occupied = (occupiedRows ?? [])
    .map(r => r.scheduled_at as string | null)
    .filter((s): s is string => !!s);

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  console.log(
    `[schedule-suggestions/generate] campaign=${body.campaign_id ?? "none"} account=${body.account_id ?? "none"} ` +
    `window=${startIso}..${endIso} count=${count} occupied=${occupied.length} → ${MODEL}`
  );

  // ── Generate ──────────────────────────────────────────────────────────────────
  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: (personaBlock ? `${personaBlock}\n\n` : "") + buildPrompt({ campaign, accountName, startIso, endIso, count, notes: notes || null, occupied }),
        },
      ],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[schedule-suggestions/generate] Claude error:", msg);
    return NextResponse.json({ success: false, error: `AI schedule generation failed: ${msg}` }, { status: 500 });
  }

  let parsed: { suggestions: ScheduleSuggestion[] };
  try {
    const clean = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    console.error("[schedule-suggestions/generate] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json(
      { success: false, error: "AI returned an unexpected response format. Try again." },
      { status: 500 }
    );
  }

  if (!Array.isArray(parsed.suggestions)) {
    return NextResponse.json(
      { success: false, error: "AI response was missing the suggestions array." },
      { status: 500 }
    );
  }

  // ── Sanitize: keep only valid, future, in-range, de-duplicated slots ─────────
  const now = Date.now();
  const occupiedSet = new Set(occupied.map(s => new Date(s).getTime()));
  const seen = new Set<number>();

  const suggestions: ScheduleSuggestion[] = parsed.suggestions
    .map(s => {
      const t = new Date(s?.recommended_at ?? "").getTime();
      return { t, s };
    })
    .filter(({ t }) => !Number.isNaN(t) && t > now && t >= startMs && t <= endMs)
    .filter(({ t }) => !occupiedSet.has(t))          // skip exact occupied slots
    .filter(({ t }) => (seen.has(t) ? false : (seen.add(t), true))) // de-dupe
    .sort((a, b) => a.t - b.t)
    .map(({ s }) => ({
      recommended_at: new Date(s.recommended_at).toISOString(),
      reason: typeof s.reason === "string" ? s.reason : "",
      theme: typeof s.theme === "string" ? s.theme : "",
    }));

  console.log(
    `[schedule-suggestions/generate] returned ${suggestions.length}/${parsed.suggestions.length} valid suggestions (none saved, none scheduled)`
  );

  return NextResponse.json({
    success: true,
    suggestions,
    context: {
      campaign_id: body.campaign_id ?? null,
      account_id: body.account_id ?? null,
      account_name: accountName,
      start: startIso,
      end: endIso,
    },
  });
}
