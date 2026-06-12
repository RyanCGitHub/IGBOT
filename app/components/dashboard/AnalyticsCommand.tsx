"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, PostInsights } from "@/lib/supabase";

// The owner's primary view: account-level KPIs + per-published-reel analytics.
// Dark "mission control" styling. Read-only — all numbers come from stored
// post_insights snapshots (synced daily by the measure cron).

type Joined = { post: IgPost; insights: PostInsights | null };

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

export default function AnalyticsCommand() {
  const [rows, setRows] = useState<Joined[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [postsRes, insightsRes] = await Promise.all([
        apiFetch("/api/ig-posts"),
        apiFetch("/api/post-insights"),
      ]);
      const postsData = await postsRes.json();
      const insightsData = await insightsRes.json();
      if (!postsRes.ok || postsData.success === false) throw new Error(postsData.error || "Failed to load posts.");
      if (!insightsRes.ok || insightsData.success === false) throw new Error(insightsData.error || "Failed to load insights.");

      const byPost = new Map<number, PostInsights>(
        (insightsData.insights as PostInsights[]).map(i => [i.post_id, i])
      );
      const published = (postsData.posts as IgPost[])
        .filter(p => p.status === "published" || p.status === "republished")
        .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
      setRows(published.map(post => ({ post, insights: byPost.get(post.id) ?? null })));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 120_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const sum = (f: (i: PostInsights) => number | null) =>
    rows.reduce((s, r) => s + (r.insights ? f(r.insights) ?? 0 : 0), 0);

  const views = sum(i => i.views);
  const reach = sum(i => i.reach);
  const likes = sum(i => i.likes);
  const comments = sum(i => i.comments);
  const saves = sum(i => i.saves);
  const shares = sum(i => i.shares);
  const engagement = reach > 0 ? `${(((likes + comments + saves + shares) / reach) * 100).toFixed(1)}%` : "—";

  return (
    <section>
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="Published" value={String(rows.length)} accent="text-slate-100" />
        <Kpi label="Views" value={fmt(views) === "0" ? "—" : fmt(views)} accent="text-cyan-300" />
        <Kpi label="Reach" value={fmt(reach) === "0" ? "—" : fmt(reach)} accent="text-cyan-300" />
        <Kpi label="Likes" value={fmt(likes)} accent="text-fuchsia-300" />
        <Kpi label="Comments" value={fmt(comments)} accent="text-fuchsia-300" />
        <Kpi label="Saves" value={fmt(saves) === "0" ? "—" : fmt(saves)} accent="text-emerald-300" />
        <Kpi label="Shares" value={fmt(shares) === "0" ? "—" : fmt(shares)} accent="text-emerald-300" />
        <Kpi label="Engagement" value={engagement} accent="text-amber-300" />
      </div>

      {/* Per-reel analytics */}
      <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Published reels & posts</h2>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="mt-3 h-16 animate-pulse rounded-xl bg-slate-800/60" />
        ) : error ? (
          <p className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Nothing published yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="pb-2 pr-3 font-semibold">Reel</th>
                  <th className="pb-2 pr-3 font-semibold">Published</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Views</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Reach</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Likes</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Comments</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Saves</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Shares</th>
                  <th className="pb-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ post, insights }) => (
                  <tr key={post.id} className="border-t border-slate-800">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        {post.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={post.image_url} alt="" className="h-12 w-7 shrink-0 rounded object-cover" />
                        )}
                        <span className="max-w-[220px] truncate font-medium text-slate-200">{post.title || `Post ${post.id}`}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-slate-400">
                      {post.published_at ? new Date(post.published_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-cyan-300">{fmt(insights?.views)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-cyan-300">{fmt(insights?.reach)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-200">{fmt(insights?.likes)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-200">{fmt(insights?.comments)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-200">{fmt(insights?.saves)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-200">{fmt(insights?.shares)}</td>
                    <td className="py-2.5 text-right">
                      {post.permalink && (
                        <a href={post.permalink} target="_blank" rel="noreferrer" className="text-xs font-medium text-fuchsia-400 hover:underline">
                          View ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.some(r => r.insights?.insights_error) && (
              <p className="mt-2 text-[11px] text-amber-400/80">
                Reach/views need the upgraded Instagram permission — reconnect the account once to unlock full metrics.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
