import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

// Newsroom KPI strip: one call, all counts.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const count = async (table: string, build: (q: ReturnType<typeof supabaseServer.from>) => unknown) => {
    const q = supabaseServer.from(table);
    const { count: n } = await (build(q) as PromiseLike<{ count: number | null }>);
    return n ?? 0;
  };

  const [activeBrands, pendingNews, pendingClips, readyPackages, scheduled, publishedToday, needsReview] = await Promise.all([
    count("media_brands", q => q.select("id", { count: "exact", head: true }).eq("status", "active")),
    count("news_items", q => q.select("id", { count: "exact", head: true }).in("status", ["collected", "needs_review"])),
    count("clip_assets", q => q.select("id", { count: "exact", head: true }).in("status", ["imported", "needs_review"])),
    count("content_packages", q => q.select("id", { count: "exact", head: true }).eq("status", "ready")),
    count("content_packages", q => q.select("id", { count: "exact", head: true }).eq("status", "scheduled")),
    count("content_packages", q => q.select("id", { count: "exact", head: true }).eq("status", "published").gte("updated_at", dayStart.toISOString())),
    count("content_packages", q => q.select("id", { count: "exact", head: true }).in("status", ["idea", "draft"])),
  ]);

  return NextResponse.json({
    success: true,
    overview: { activeBrands, pendingNews, pendingClips, readyPackages, scheduled, publishedToday, needsReview },
  });
}
