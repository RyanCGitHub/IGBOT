"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, ConnectedAccount, Campaign } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

// ─── ContentQueue ───────────────────────────────────────────────────────────────

export default function ContentQueue() {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [postsRes, accountsRes, campaignsRes] = await Promise.all([
        apiFetch("/api/ig-posts"),
        apiFetch("/api/meta/accounts"),
        apiFetch("/api/campaigns"),
      ]);
      const postsData = await postsRes.json();
      if (!postsRes.ok || !postsData.success) throw new Error(postsData.error ?? "Failed to load posts.");
      setPosts(postsData.posts as IgPost[]);

      const accountsData = await accountsRes.json();
      if (accountsData.success) setAccounts(accountsData.accounts as ConnectedAccount[]);

      const campaignsData = await campaignsRes.json();
      if (campaignsData.success) setCampaigns(campaignsData.campaigns as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const accountName = (id: number | null) =>
    id == null ? null : accounts.find(a => a.id === id)?.account_name ?? null;
  const campaignName = (id: number | null) =>
    id == null ? null : campaigns.find(c => c.id === id)?.name ?? null;

  // Upcoming = scheduled posts, soonest first
  const queue = posts
    .filter(p => p.status === "scheduled" && p.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Upcoming Queue</h2>
          <p className="mt-1 text-sm text-slate-400">
            Scheduled posts in the order they will publish. This is a read-only view — the
            scheduler still runs independently.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300 ring-1 ring-violet-400/20">
            {isLoading ? "…" : `${queue.length} queued`}
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
          [1, 2].map(n => <div key={n} className="h-20 animate-pulse rounded-3xl bg-slate-800/60" />)
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
        ) : queue.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            Nothing scheduled. Schedule a post from Create Post to see it here.
          </p>
        ) : (
          queue.map((post, idx) => {
            const isNext = idx === 0;
            const acct = accountName(post.account_id);
            const camp = campaignName(post.campaign_id);
            return (
              <div
                key={post.id}
                className={`flex items-start gap-4 rounded-3xl p-4 ring-1 ${
                  isNext
                    ? "bg-violet-500/5 ring-violet-400/30"
                    : "bg-slate-950/80 ring-white/5"
                }`}
              >
                {/* Thumbnail */}
                <div className="shrink-0">
                  {post.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.image_url}
                      alt="Scheduled post"
                      className="h-16 w-16 rounded-xl object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-800 text-slate-600 ring-1 ring-white/10">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isNext && (
                      <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-200 ring-1 ring-violet-400/30">
                        Next up
                      </span>
                    )}
                    <span className="text-sm font-semibold text-white">{formatWhen(post.scheduled_at!)}</span>
                    <span className="text-xs text-violet-300">{countdown(post.scheduled_at!)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-slate-300">{post.caption}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300 ring-1 ring-violet-400/20">
                      Scheduled
                    </span>
                    {acct ? (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />@{acct}
                      </span>
                    ) : (
                      <span className="text-amber-400">No account assigned</span>
                    )}
                    {camp && (
                      <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-fuchsia-300 ring-1 ring-fuchsia-400/20">
                        {camp}
                      </span>
                    )}
                    {post.timezone && <span className="text-slate-600">{post.timezone}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
