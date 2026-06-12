import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { supabaseServer } from "@/lib/supabase-server";
import { requireCronOrApiKey, publishingPaused, pausedResponse } from "@/lib/cron-auth";
import { detectSensitivity } from "@/lib/media-network/compliance";

// Automated news CANDIDATE ingestion (owner decision: automatic entry, never
// automatic posting). Polls active RSS sources per brand, creates news_items
// as candidates: claim_type=developing, verification=unverified, sensitivity
// auto-flagged. Everything still passes human review before becoming a post.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PER_SOURCE = 5;
const FEED_TIMEOUT_MS = 10_000;

type FeedItem = { title?: string; link?: string | { "@_href"?: string }; description?: string; pubDate?: string; summary?: string };

function itemLink(item: FeedItem): string | null {
  if (typeof item.link === "string") return item.link.trim() || null;
  if (item.link && typeof item.link === "object") return item.link["@_href"]?.trim() || null;
  return null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

async function ingest(): Promise<NextResponse> {
  const { data: sources, error: srcErr } = await supabaseServer
    .from("content_sources")
    .select("id, media_brand_id, source_name, source_url, permission_status")
    .eq("source_type", "rss")
    .eq("is_active", true)
    .not("source_url", "is", null);

  if (srcErr) return NextResponse.json({ success: false, error: srcErr.message }, { status: 500 });

  const parser = new XMLParser({ ignoreAttributes: false });
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const source of sources ?? []) {
    // Blocked sources are never read at all.
    if (source.permission_status === "blocked") continue;
    try {
      const res = await fetch(source.source_url as string, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers: { "User-Agent": "ig-bot-media-network/1.0 (news candidate ingestion)" },
      });
      if (!res.ok) { errors.push(`${source.source_name}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const feed = parser.parse(xml);

      // RSS 2.0 or Atom shapes.
      const rawItems: FeedItem[] =
        feed?.rss?.channel?.item ?? feed?.feed?.entry ?? [];
      const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).slice(0, MAX_PER_SOURCE);

      for (const item of items) {
        const headline = stripHtml(String(item.title ?? "")).slice(0, 300);
        const link = itemLink(item);
        if (!headline || !link) continue;

        // Dedup on source_url.
        const { count } = await supabaseServer
          .from("news_items")
          .select("id", { count: "exact", head: true })
          .eq("source_url", link);
        if ((count ?? 0) > 0) { skipped++; continue; }

        const summary = stripHtml(String(item.description ?? item.summary ?? "")).slice(0, 1000) || null;
        const sensitivity = detectSensitivity(`${headline} ${summary ?? ""}`);

        const { error: insErr } = await supabaseServer.from("news_items").insert({
          media_brand_id: source.media_brand_id,
          source_id: source.id,
          headline,
          short_summary: summary,
          source_url: link,
          source_name: source.source_name,
          claim_type: "developing",
          verification_status: "unverified",
          sensitivity_level: sensitivity,
          source_credit_text: `Source: ${source.source_name}`,
          status: sensitivity === "high" ? "needs_review" : "collected",
        });
        if (insErr) errors.push(`${source.source_name}: ${insErr.message}`);
        else created++;
      }
    } catch (e) {
      errors.push(`${source.source_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[media-network/ingest-news] sources=${(sources ?? []).length} created=${created} deduped=${skipped} errors=${errors.length}`);
  return NextResponse.json({ success: true, sources: (sources ?? []).length, created, deduped: skipped, errors });
}

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return ingest();
}

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return ingest();
}
