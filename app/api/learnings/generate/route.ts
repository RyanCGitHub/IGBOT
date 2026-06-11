import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { engagementScore } from "@/lib/engagement";
import { getPersonaForAccount } from "@/lib/persona";
import type { PostInsights, PostAttributes } from "@/lib/supabase";

const MODEL = "claude-sonnet-4-5";
const MAX_POSTS = 200;
const MAX_FINDINGS = 6;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Row = {
  score: number;
  captionStyle: string;
  contentPillar: string;
  mediaSource: string;
  hour: string;
  day: string;
};

type GroupStat = { key: string; count: number; avgScore: number; smallSample: boolean };

function group(rows: Row[], keyFn: (r: Row) => string): GroupStat[] {
  const m = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const k = keyFn(r) || "untagged";
    const g = m.get(k) ?? { count: 0, total: 0 };
    g.count++; g.total += r.score;
    m.set(k, g);
  }
  return [...m.entries()]
    .map(([key, { count, total }]) => ({ key, count, avgScore: Number((total / count).toFixed(4)), smallSample: count < 3 }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { account_id?: number };
  try {
    body = (await request.json()) as { account_id?: number };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const accountId = Number(body.account_id);
  if (!Number.isInteger(accountId) || accountId < 1) {
    return NextResponse.json({ success: false, error: "account_id is required." }, { status: 400 });
  }

  // ── Gather published posts + stored insights + attributes ───────────────────
  const { data: postsData, error: postsErr } = await supabaseServer
    .from("ig_posts")
    .select("id, caption, published_at")
    .eq("account_id", accountId)
    .in("status", ["published", "republished"])
    .limit(MAX_POSTS);
  if (postsErr) return NextResponse.json({ success: false, error: postsErr.message }, { status: 500 });

  const posts = postsData ?? [];
  const ids = posts.map(p => p.id as number);

  if (ids.length === 0) {
    return NextResponse.json({ success: true, learnings: [], message: "No published posts for this account yet." });
  }

  const { data: insightRows } = await supabaseServer.from("post_insights").select("*").in("post_id", ids);
  const insightsByPost = new Map<number, PostInsights>();
  for (const r of (insightRows ?? []) as PostInsights[]) insightsByPost.set(r.post_id, r);

  const { data: attrRows } = await supabaseServer.from("post_attributes").select("*").in("post_id", ids);
  const attrByPost = new Map<number, PostAttributes>();
  for (const r of (attrRows ?? []) as PostAttributes[]) attrByPost.set(r.post_id, r);

  // ── Build scored rows (only posts that have synced insights) ────────────────
  const rows: Row[] = [];
  let anyReachNormalized = false;
  for (const p of posts) {
    const ins = insightsByPost.get(p.id as number);
    if (!ins) continue; // need stored insights to score
    const e = engagementScore(ins);
    if (e.reachNormalized) anyReachNormalized = true;
    const attr = attrByPost.get(p.id as number);
    const when = p.published_at ? new Date(p.published_at as string) : null;
    rows.push({
      score: e.score,
      captionStyle: attr?.caption_style ?? "untagged",
      contentPillar: attr?.content_pillar ?? "untagged",
      mediaSource: attr?.media_source ?? "unknown",
      hour: when ? `${when.getUTCHours()}:00 UTC` : "unknown",
      day: when ? DOW[when.getUTCDay()] : "unknown",
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      learnings: [],
      message: "No synced insights yet for this account. Run Sync Insights on published posts first.",
    });
  }

  const aggregates = {
    posts_analyzed: rows.length,
    score_basis: anyReachNormalized ? "reach-normalized engagement (likes + 2·comments + 3·saves + 3·shares) / reach" : "raw weighted engagement (reach unavailable)",
    by_caption_style: group(rows, r => r.captionStyle),
    by_content_pillar: group(rows, r => r.contentPillar),
    by_media_source: group(rows, r => r.mediaSource),
    by_hour: group(rows, r => r.hour),
    by_day_of_week: group(rows, r => r.day),
  };

  const persona = await getPersonaForAccount(accountId);

  // ── Ask Claude for findings ─────────────────────────────────────────────────
  const prompt = `You are an Instagram performance analyst. Below are engagement aggregates for one account, grouped by post attribute. Higher avgScore = better. "smallSample" means fewer than 3 posts (low confidence).

${JSON.stringify(aggregates, null, 2)}

Return a JSON object with EXACTLY this structure (no markdown, no code blocks):

{ "findings": ["concise, actionable finding grounded in the data above", "..."] }

Rules:
- Respond with ONLY the JSON object
- 2 to ${MAX_FINDINGS} findings, each one sentence, specific and actionable
- Explicitly hedge any finding based on smallSample groups
- Never invent metrics; base everything on the aggregates`;

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block && "text" in block ? block.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[learnings/generate] Claude error:", msg);
    return NextResponse.json({ success: false, error: `Learning generation failed: ${msg}` }, { status: 500 });
  }

  let parsed: { findings: string[] };
  try {
    const clean = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean) as { findings: string[] };
  } catch {
    return NextResponse.json({ success: false, error: "AI returned an unexpected format. Try again." }, { status: 500 });
  }

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.filter((f): f is string => typeof f === "string" && f.trim().length > 0).slice(0, MAX_FINDINGS)
    : [];

  if (findings.length === 0) {
    return NextResponse.json({ success: true, learnings: [], message: "No findings produced." });
  }

  // ── Persist as active learnings (evidence = the aggregates used) ────────────
  const toInsert = findings.map(f => ({
    account_id: accountId,
    persona_id: persona?.id ?? null,
    finding: f.trim(),
    evidence: aggregates as unknown as Record<string, unknown>,
    status: "active",
  }));

  const { data: inserted, error: insErr } = await supabaseServer
    .from("learnings")
    .insert(toInsert)
    .select("*");

  if (insErr) return NextResponse.json({ success: false, error: insErr.message }, { status: 500 });

  console.log(`[learnings/generate] account ${accountId} → ${inserted?.length ?? 0} learnings from ${rows.length} posts`);

  return NextResponse.json({ success: true, learnings: inserted, posts_analyzed: rows.length });
}
