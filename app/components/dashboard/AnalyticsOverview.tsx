"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, ContentIdea, PostInsights, ConnectedAccount } from "@/lib/supabase";
import StatCard from "@/app/components/dashboard/StatCard";

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Sum a nullable metric across insight rows. Returns null when NO row has a value
// (so the UI can show "Unavailable" instead of a fake 0).
function sumMetric(rows: PostInsights[], key: "likes" | "comments" | "reach" | "saves" | "shares"): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number") { total += v; any = true; }
  }
  return any ? total : null;
}

export default function AnalyticsOverview() {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [insights, setInsights] = useState<PostInsights[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [postsRes, ideasRes, insightsRes, accountsRes] = await Promise.all([
        apiFetch("/api/ig-posts"),
        apiFetch("/api/content-ideas"),
        apiFetch("/api/post-insights"),
        apiFetch("/api/meta/accounts"),
      ]);
      const postsData = await postsRes.json();
      if (!postsRes.ok || !postsData.success) throw new Error(postsData.error ?? "Failed to load posts.");
      setPosts(postsData.posts as IgPost[]);

      const ideasData = await ideasRes.json();
      if (ideasData.success) setIdeas(ideasData.ideas as ContentIdea[]);
      const insightsData = await insightsRes.json();
      if (insightsData.success) setInsights(insightsData.insights as PostInsights[]);
      const accountsData = await accountsRes.json();
      if (accountsData.success) setAccounts(accountsData.accounts as ConnectedAccount[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh when another section reconciles data (e.g. Analytics detects a post
  // was deleted on Instagram). No Meta call here — just re-reads stored data.
  useEffect(() => {
    const handler = () => fetchAll();
    window.addEventListener("ig:data-changed", handler);
    return () => window.removeEventListener("ig:data-changed", handler);
  }, [fetchAll]);

  // ── Compute from stored data only (no Meta calls) ───────────────────────────
  const published = posts.filter(p => p.status === "published" || p.status === "republished").length;
  const scheduled = posts.filter(p => p.status === "scheduled").length;
  const drafts = posts.filter(p => p.status === "draft").length;
  const failed = posts.filter(p => p.status === "failed").length;
  const ideasWaiting = ideas.filter(i => i.converted_post_id == null).length;

  const totalLikes = sumMetric(insights, "likes");
  const totalComments = sumMetric(insights, "comments");
  const totalReach = sumMetric(insights, "reach");
  const totalSaves = sumMetric(insights, "saves");
  const totalShares = sumMetric(insights, "shares");

  const syncedCount = insights.length;
  const lastSync = insights.reduce<string | null>((latest, r) => {
    if (!r.synced_at) return latest;
    return !latest || new Date(r.synced_at) > new Date(latest) ? r.synced_at : latest;
  }, null);

  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString());

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Analytics Overview</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Live counts from your stored data. Engagement totals come from synced insights — not fetched on load.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchAll}
          disabled={isLoading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? "…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">{error}</div>
      ) : (
        <>
          {/* Pipeline */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Connected accounts" value={accounts.length} accent="blue" />
            <StatCard label="Published" value={published} accent="cyan" />
            <StatCard label="Scheduled" value={scheduled} accent="purple" />
            <StatCard label="Drafts" value={drafts} accent="slate" />
            <StatCard label="Failed" value={failed} accent="magenta" />
            <StatCard label="Ideas waiting" value={ideasWaiting} accent="gold" />
          </div>

          {/* Engagement (stored insights only) */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total likes" value={fmt(totalLikes)} accent="magenta" unavailable={totalLikes == null && syncedCount > 0} />
            <StatCard label="Total comments" value={fmt(totalComments)} accent="blue" unavailable={totalComments == null && syncedCount > 0} />
            <StatCard label="Reach" value={fmt(totalReach)} accent="cyan" unavailable={totalReach == null} />
            <StatCard label="Saves" value={fmt(totalSaves)} accent="purple" unavailable={totalSaves == null} />
            <StatCard label="Shares" value={fmt(totalShares)} accent="gold" unavailable={totalShares == null} />
          </div>

          {/* Sync meta */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Synced posts" value={syncedCount} accent="slate" hint="post_insights snapshots" />
            <StatCard label="Last analytics sync" value={formatRelative(lastSync)} accent="slate" />
          </div>

          {(totalReach == null || totalSaves == null || totalShares == null) && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Reach / saves / shares show <strong>Unavailable</strong> when Instagram hasn&apos;t returned them
              (typically a Meta permission limit). Likes and comments still sync. Use per-post
              <span className="font-medium"> Sync Insights</span> in Analytics detail below.
            </p>
          )}
        </>
      )}
    </section>
  );
}
