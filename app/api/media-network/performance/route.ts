import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Performance Lab data: groups performance_tags along every dimension the
// plan asks for. Aggregation is in-process over a bounded window — the data
// volume is "posts per account", not telemetry-scale.
export const dynamic = "force-dynamic";

type Tag = {
  media_brand_id: number;
  topic: string | null;
  streamer_name: string | null;
  city_or_region: string | null;
  format: string | null;
  moment_type: string | null;
  posted_at: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  engagement_rate: number | null;
};

type GroupStat = { key: string; posts: number; avgEngagement: number | null; totalReach: number; totalLikes: number };

function groupBy(tags: Tag[], keyFn: (t: Tag) => string | null): GroupStat[] {
  const m = new Map<string, { posts: number; erSum: number; erN: number; reach: number; likes: number }>();
  for (const t of tags) {
    const k = keyFn(t);
    if (!k) continue;
    const g = m.get(k) ?? { posts: 0, erSum: 0, erN: 0, reach: 0, likes: 0 };
    g.posts++;
    if (t.engagement_rate != null) { g.erSum += t.engagement_rate; g.erN++; }
    g.reach += t.reach ?? 0;
    g.likes += t.likes ?? 0;
    m.set(k, g);
  }
  return [...m.entries()]
    .map(([key, g]) => ({
      key,
      posts: g.posts,
      avgEngagement: g.erN > 0 ? Number((g.erSum / g.erN).toFixed(4)) : null,
      totalReach: g.reach,
      totalLikes: g.likes,
    }))
    .sort((a, b) => (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1) || b.totalLikes - a.totalLikes);
}

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const [{ data: tags, error }, { data: brands }] = await Promise.all([
    supabaseServer.from("performance_tags").select("*").order("posted_at", { ascending: false }).limit(500),
    supabaseServer.from("media_brands").select("id, brand_name"),
  ]);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const nameById = new Map((brands ?? []).map(b => [b.id as number, b.brand_name as string]));
  const rows = (tags ?? []) as Tag[];

  return NextResponse.json({
    success: true,
    totalTagged: rows.length,
    byBrand: groupBy(rows, t => nameById.get(t.media_brand_id) ?? `Brand ${t.media_brand_id}`),
    byFormat: groupBy(rows, t => t.format),
    byStreamer: groupBy(rows, t => t.streamer_name),
    byMomentType: groupBy(rows, t => t.moment_type),
    byTopic: groupBy(rows, t => t.topic),
    byCity: groupBy(rows, t => t.city_or_region),
    // Hour key is UTC; the client renders it in the viewer's local time (PT).
    byHourUtc: groupBy(rows, t => (t.posted_at ? String(new Date(t.posted_at).getUTCHours()) : null)),
  });
}
