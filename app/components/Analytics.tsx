"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, ConnectedAccount, Campaign, PostInsights } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function metricValue(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

// Reason a published post can't be synced (defensive — published posts normally have both).
function syncBlocker(post: IgPost): string | null {
  if (!post.media_id) return "no media_id";
  if (post.account_id == null) return "no assigned account";
  return null;
}

// ─── Metric chip ────────────────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-xl bg-slate-900/60 px-3 py-2 ring-1 ring-white/5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-100">{metricValue(value)}</p>
    </div>
  );
}

// ─── Post analytics row ─────────────────────────────────────────────────────────

function AnalyticsRow({
  post,
  accountName,
  campaignName,
  insight,
  isSyncing,
  onSync,
}: {
  post: IgPost;
  accountName: string | undefined;
  campaignName: string | undefined;
  insight: PostInsights | undefined;
  isSyncing: boolean;
  onSync: () => void;
}) {
  const blocker = syncBlocker(post);

  return (
    <div className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
      <div className="flex items-start gap-4">
        {/* Thumbnail */}
        <div className="shrink-0">
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.image_url} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-white/10" />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-slate-800 ring-1 ring-white/10" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-6 text-slate-200">{post.caption}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {accountName && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />@{accountName}
              </span>
            )}
            {campaignName && (
              <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-fuchsia-300 ring-1 ring-fuchsia-400/20">
                {campaignName}
              </span>
            )}
            <span>Published {formatDate(post.published_at)}</span>
            {post.media_id && <span className="font-mono">media: {post.media_id}</span>}
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="text-fuchsia-400 hover:text-fuchsia-300">
                View ↗
              </a>
            )}
          </div>
        </div>

        {/* Sync */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing || !!blocker}
            title={blocker ? `Cannot sync — ${blocker}` : "Fetch latest insights from Instagram"}
            className="rounded-2xl bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSyncing ? "Syncing…" : "Sync Insights"}
          </button>
          {blocker && <span className="text-[10px] text-amber-400">Cannot sync — {blocker}</span>}
          {insight?.synced_at && <span className="text-[10px] text-slate-600">Synced {formatDate(insight.synced_at)}</span>}
        </div>
      </div>

      {/* Metrics */}
      {insight ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Metric label="Likes" value={insight.likes} />
          <Metric label="Comments" value={insight.comments} />
          <Metric label="Reach" value={insight.reach} />
          <Metric label="Saves" value={insight.saves} />
          <Metric label="Shares" value={insight.shares} />
          <Metric label="Views" value={insight.views} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">Not synced yet — click Sync Insights to fetch metrics.</p>
      )}

      {insight?.insights_error && (
        <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          Some metrics were unavailable: {insight.insights_error} (likes/comments still shown when available).
        </p>
      )}
    </div>
  );
}

// ─── Analytics ──────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [insights, setInsights] = useState<Record<number, PostInsights>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [postsRes, accountsRes, campaignsRes, insightsRes] = await Promise.all([
        apiFetch("/api/ig-posts"),
        apiFetch("/api/meta/accounts"),
        apiFetch("/api/campaigns"),
        apiFetch("/api/post-insights"),
      ]);

      const postsData = await postsRes.json();
      if (!postsRes.ok || !postsData.success) throw new Error(postsData.error ?? "Failed to load posts.");
      setPosts(
        (postsData.posts as IgPost[]).filter(p => p.status === "published" || p.status === "republished")
      );

      const accountsData = await accountsRes.json();
      if (accountsData.success) setAccounts(accountsData.accounts as ConnectedAccount[]);

      const campaignsData = await campaignsRes.json();
      if (campaignsData.success) setCampaigns(campaignsData.campaigns as Campaign[]);

      const insightsData = await insightsRes.json();
      if (insightsData.success) {
        const map: Record<number, PostInsights> = {};
        for (const row of insightsData.insights as PostInsights[]) map[row.post_id] = row;
        setInsights(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSync(postId: number) {
    setSyncingId(postId);
    try {
      const res = await apiFetch(`/api/ig-posts/${postId}/insights`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Sync failed."); return; }
      setInsights(prev => ({ ...prev, [postId]: data.insights as PostInsights }));
    } finally {
      setSyncingId(null);
    }
  }

  const accountName = (id: number | null) => (id == null ? undefined : accounts.find(a => a.id === id)?.account_name);
  const campaignName = (id: number | null) => (id == null ? undefined : campaigns.find(c => c.id === id)?.name);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Analytics</h2>
          <p className="mt-1 text-sm text-slate-400">
            Performance of published posts. Metrics are fetched read-only from Instagram when you
            click Sync — nothing is posted, scheduled, or changed.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
            {isLoading ? "…" : `${posts.length} posts`}
          </span>
          <button
            type="button"
            onClick={fetchAll}
            disabled={isLoading}
            className="rounded-3xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-600 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* List */}
      <div className="mt-6 space-y-3">
        {isLoading ? (
          [1, 2].map(n => <div key={n} className="h-28 animate-pulse rounded-3xl bg-slate-800/60" />)
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
        ) : posts.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            No published posts yet. Publish a post to track its performance here.
          </p>
        ) : (
          posts.map(post => (
            <AnalyticsRow
              key={post.id}
              post={post}
              accountName={accountName(post.account_id)}
              campaignName={campaignName(post.campaign_id)}
              insight={insights[post.id]}
              isSyncing={syncingId === post.id}
              onSync={() => handleSync(post.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
