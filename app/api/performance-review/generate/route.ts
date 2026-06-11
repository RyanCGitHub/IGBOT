import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import type { PerformanceRecommendation, PerformanceReview, PostInsights } from "@/lib/supabase";
import { getPersonaForAccount, personaPromptBlock } from "@/lib/persona";
import { getActiveLearnings, learningsPromptBlock } from "@/lib/learning";

const NOTES_MAX = 2_000;
const MODEL = "claude-sonnet-4-5";
const MAX_POSTS = 50;       // cap how many posts we feed the model
const CAPTION_TRUNC = 200;
const THIN_THRESHOLD = 3;   // fewer than this → limited

type GenerateBody = {
  campaign_id?: number;
  account_id?: number;
  start_date?: string;
  end_date?: string;
  notes?: string;
};

type PostRow = {
  id: number;
  caption: string;
  account_id: number | null;
  campaign_id: number | null;
  published_at: string | null;
};

function n(v: number | null | undefined): string {
  return typeof v === "number" ? String(v) : "n/a";
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

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return NextResponse.json(
      { success: false, error: `notes must be ${NOTES_MAX} characters or fewer.` },
      { status: 400 }
    );
  }

  // ── Fetch published/republished posts matching the filters ──────────────────
  let postsQuery = supabaseServer
    .from("ig_posts")
    .select("id, caption, account_id, campaign_id, published_at")
    .in("status", ["published", "republished"])
    .order("published_at", { ascending: false })
    .limit(MAX_POSTS);

  if (body.campaign_id) postsQuery = postsQuery.eq("campaign_id", body.campaign_id);
  if (body.account_id) postsQuery = postsQuery.eq("account_id", body.account_id);
  if (body.start_date) postsQuery = postsQuery.gte("published_at", new Date(body.start_date).toISOString());
  if (body.end_date) {
    const end = body.end_date.includes("T")
      ? new Date(body.end_date)
      : new Date(new Date(body.end_date).getTime() + 24 * 60 * 60 * 1000 - 1);
    postsQuery = postsQuery.lte("published_at", end.toISOString());
  }

  const { data: postsData, error: postsErr } = await postsQuery;
  if (postsErr) {
    return NextResponse.json({ success: false, error: postsErr.message }, { status: 500 });
  }
  const posts = (postsData ?? []) as PostRow[];

  // ── Short-circuit when there's nothing to analyze ───────────────────────────
  if (posts.length === 0) {
    const review: PerformanceReview = {
      summary: "No published posts match these filters yet. Publish some posts (and sync their insights) to get a performance review.",
      posts_analyzed: 0,
      metrics_note: "No data available.",
      limited: true,
      recommendations: [],
    };
    return NextResponse.json({ success: true, review });
  }

  // ── Map insights, campaigns, accounts ───────────────────────────────────────
  const ids = posts.map(p => p.id);
  const { data: insightRows } = await supabaseServer
    .from("post_insights")
    .select("*")
    .in("post_id", ids);
  const insightsByPost = new Map<number, PostInsights>();
  for (const row of (insightRows ?? []) as PostInsights[]) insightsByPost.set(row.post_id, row);

  const { data: campaignRows } = await supabaseServer.from("campaigns").select("id, name");
  const campaignName = new Map<number, string>();
  for (const c of campaignRows ?? []) campaignName.set(c.id as number, c.name as string);

  const { data: accountRows } = await supabaseServer.from("connected_accounts").select("id, account_name");
  const accountName = new Map<number, string>();
  for (const a of accountRows ?? []) accountName.set(a.id as number, a.account_name as string);

  // ── Metric availability (only use what's actually present) ──────────────────
  let hasReach = false, hasSaves = false, hasShares = false, anyError = false;
  for (const id of ids) {
    const ins = insightsByPost.get(id);
    if (!ins) continue;
    if (ins.reach != null) hasReach = true;
    if (ins.saves != null) hasSaves = true;
    if (ins.shares != null) hasShares = true;
    if (ins.insights_error) anyError = true;
  }

  const available = ["likes", "comments"];
  if (hasReach) available.push("reach");
  if (hasSaves) available.push("saved");
  if (hasShares) available.push("shares");
  const missing = ["reach", "saved", "shares"].filter(m => !available.includes(m));
  const metricsHint =
    `Available metrics: ${available.join(", ")}.` +
    (missing.length
      ? ` Missing/unavailable (likely Meta permission limits): ${missing.join(", ")} — base conclusions mainly on likes/comments.`
      : "");

  // ── Build a compact digest for the model ────────────────────────────────────
  const digest = posts.map((p, i) => {
    const ins = insightsByPost.get(p.id);
    const cap = (p.caption ?? "").replace(/\s+/g, " ").slice(0, CAPTION_TRUNC);
    const label = [
      p.campaign_id != null ? campaignName.get(p.campaign_id) ?? `campaign ${p.campaign_id}` : "no campaign",
      p.account_id != null ? `@${accountName.get(p.account_id) ?? p.account_id}` : "no account",
      p.published_at ?? "unknown date",
    ].join(" | ");
    const metrics = `likes=${n(ins?.likes)} comments=${n(ins?.comments)} reach=${n(ins?.reach)} saved=${n(ins?.saves)} shares=${n(ins?.shares)}`;
    return `${i + 1}. [${label}] ${metrics} — "${cap}"`;
  }).join("\n");

  const limited = posts.length < THIN_THRESHOLD;

  const filterContext = [
    body.campaign_id ? `Campaign filter: ${campaignName.get(body.campaign_id) ?? body.campaign_id}` : null,
    body.account_id ? `Account filter: @${accountName.get(body.account_id) ?? body.account_id}` : null,
    body.start_date || body.end_date ? `Date range: ${body.start_date ?? "any"} to ${body.end_date ?? "any"}` : null,
    notes ? `User notes: ${notes}` : null,
  ].filter(Boolean).join("\n") || "No filters applied.";

  const prompt = `You are an Instagram performance analyst. Analyze these published posts and recommend what content to make next.

${filterContext}
${metricsHint}
Posts analyzed: ${posts.length}${limited ? " (LIMITED DATA — be cautious and clearly caveat conclusions)" : ""}

Posts (most recent first):
${digest}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{
  "summary": "2-4 sentence read of what appears to be working and the overall state",
  "posts_analyzed": ${posts.length},
  "metrics_note": "one sentence on which metrics this is based on and any limits",
  "limited": ${limited},
  "recommendations": [
    {
      "category": "Best theme | Weak theme | Next angle | Caption/hook | Timing | Campaign idea",
      "title": "short label",
      "detail": "specific, actionable explanation grounded in the data above",
      "idea": {
        "title": "hook",
        "caption_angle": "caption direction",
        "visual_concept": "image/visual idea",
        "cta": "call to action",
        "hashtags": "#a #b #c"
      }
    }
  ]
}

Rules:
- Respond with ONLY the JSON object, no surrounding text
- "category" MUST be one of: Best theme, Weak theme, Next angle, Caption/hook, Timing, Campaign idea
- Include the "idea" object ONLY on "Next angle" and "Campaign idea" recommendations; omit it on the others
- Base conclusions mainly on likes/comments when deeper metrics are missing; never invent metrics
- Only give a "Timing" recommendation if there are enough posts across different times/days to justify it
- If data is thin or metrics are limited, set "limited": true and keep recommendations cautious and caveated`;

  // Persona + learnings context
  const persona = await getPersonaForAccount(body.account_id ?? null);
  const personaBlock = personaPromptBlock(persona);
  const learningsBlock = learningsPromptBlock(await getActiveLearnings(body.account_id ?? null));

  console.log(
    `[performance-review/generate] posts=${posts.length} campaign=${body.campaign_id ?? "any"} ` +
    `account=${body.account_id ?? "any"} metrics=[${available.join(",")}]${anyError ? " (some insights errors)" : ""} → ${MODEL}`
  );

  // ── Generate ──────────────────────────────────────────────────────────────────
  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: [personaBlock, learningsBlock, prompt].filter(Boolean).join("\n\n") }],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[performance-review/generate] Claude error:", msg);
    return NextResponse.json({ success: false, error: `AI performance review failed: ${msg}` }, { status: 500 });
  }

  let parsed: PerformanceReview;
  try {
    const clean = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(clean) as PerformanceReview;
  } catch {
    console.error("[performance-review/generate] JSON parse failed. Raw:", rawText.slice(0, 500));
    return NextResponse.json(
      { success: false, error: "AI returned an unexpected response format. Try again." },
      { status: 500 }
    );
  }

  if (!Array.isArray(parsed.recommendations)) {
    return NextResponse.json(
      { success: false, error: "AI response was missing the recommendations array." },
      { status: 500 }
    );
  }

  // ── Build the authoritative response (server owns the counts) ───────────────
  const review: PerformanceReview = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    posts_analyzed: posts.length,                 // authoritative — never trust the model's count
    metrics_note: typeof parsed.metrics_note === "string" && parsed.metrics_note.trim()
      ? parsed.metrics_note
      : metricsHint,
    limited: limited || parsed.limited === true,  // limited if thin OR the model flags it
    recommendations: parsed.recommendations
      .filter(r => r && typeof r.title === "string" && typeof r.detail === "string")
      .map((r): PerformanceRecommendation => ({
        category: r.category,
        title: r.title,
        detail: r.detail,
        ...(r.idea && typeof r.idea === "object" ? { idea: r.idea } : {}),
      })),
  };

  console.log(`[performance-review/generate] returned ${review.recommendations.length} recommendations (ephemeral — not saved)`);

  return NextResponse.json({ success: true, review });
}
