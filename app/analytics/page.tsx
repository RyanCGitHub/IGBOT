"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import ManualQueueRecovery from "@/app/components/analytics/ManualQueueRecovery";
import ScoreHistory from "@/app/components/analytics/ScoreHistory";

// Analytics hub: real synced Instagram metrics, global or per-page. Page
// selector filters every number. "Sync Analytics Now" runs the same engine as
// the hourly cron on demand.

type Account = { id: number; account_name: string; followers_count: number | null; last_analytics_sync_at: string | null; totals: { posts: number; views: number } };
type Totals = { views: number; reach: number; likes: number; comments: number; saves: number; shares: number; total_interactions: number; avg_engagement_rate: number };
type PostRef = { id: number; caption: string | null; thumbnail: string | null; permalink: string | null; views: number } | null;
type Overview = { totals: Totals; posts_tracked: number; best_post: PostRef; worst_post: PostRef; newest_post: PostRef; last_sync_at: string | null };
type Post = {
  id: number; permalink: string | null; media_type: string | null; content_lane: string | null;
  caption: string | null; media_public_url: string | null; thumbnail_url: string | null;
  predicted_viral_score: number | null; viral_checker_status: string | null; published_at: string | null;
  metrics: { views: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; engagement_rate: number | null } | null;
};

const fmt = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "never";
const laneLabel = (l: string | null) => ({ news_media: "News", streamer_clips: "Clips", avatar_reels: "Avatar", general: "General" }[l ?? ""] ?? l ?? "—");
const checkerChip = (s: string | null) => s === "complete" ? "text-emerald-300" : s === "backfilled" ? "text-amber-300" : "text-rose-300";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-100">{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<number | "all">("all");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await apiFetch("/api/analytics/accounts");
      const d = await res.json();
      if (res.ok && d.success !== false) setAccounts(d.accounts as Account[]);
    } catch { /* */ }
  }, []);

  const load = useCallback(async () => {
    const qs = selected === "all" ? "" : `?account_id=${selected}`;
    try {
      const [oRes, pRes] = await Promise.all([
        apiFetch(`/api/analytics/overview${qs}`),
        apiFetch(`/api/analytics/posts${qs}`),
      ]);
      const o = await oRes.json(); const p = await pRes.json();
      if (oRes.ok && o.success !== false) setOverview(o as Overview);
      if (pRes.ok && p.success !== false) setPosts(p.posts as Post[]);
    } catch { /* */ }
  }, [selected]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { load(); }, [load]);

  async function syncNow() {
    setSyncing(true); setNote(null);
    try {
      const res = await apiFetch("/api/admin/sync-analytics-now", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d.success === false) throw new Error(d.error || "Sync failed.");
      const s = d.summary;
      setNote(`Synced — ${s.accounts_checked} accounts, ${s.instagram_posts_found} IG posts found, ${s.new_posts_created} new, ${s.snapshots_created} snapshots, ${s.manual_queue_posts_resolved} manual resolved, ${s.viral_checks_created} viral backfills.`);
      await Promise.all([loadAccounts(), load()]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  const t = overview?.totals;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(56,189,248,0.10),transparent)]" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:px-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
            <p className="text-sm text-slate-400">Real Instagram metrics, synced hourly · last sync {fmtDate(overview?.last_sync_at ?? null)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={syncNow} disabled={syncing}
              className="rounded-full bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">
              {syncing ? "Syncing…" : "↻ Sync Analytics Now"}
            </button>
            <Link href="/" className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700">← Command Center</Link>
          </div>
        </header>

        {note && <p className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300">{note}</p>}

        {/* Page selector */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-1.5">
          <button type="button" onClick={() => setSelected("all")}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${selected === "all" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50"}`}>
            All Pages
          </button>
          {accounts.map(a => (
            <button key={a.id} type="button" onClick={() => setSelected(a.id)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${selected === a.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50"}`}>
              @{a.account_name}{a.followers_count != null ? ` · ${fmt(a.followers_count)}` : ""}
            </button>
          ))}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Views" value={fmt(t?.views)} />
          <Stat label="Reach" value={fmt(t?.reach)} />
          <Stat label="Likes" value={fmt(t?.likes)} />
          <Stat label="Comments" value={fmt(t?.comments)} />
          <Stat label="Saves" value={fmt(t?.saves)} />
          <Stat label="Shares" value={fmt(t?.shares)} />
          <Stat label="Interactions" value={fmt(t?.total_interactions)} />
          <Stat label="Posts tracked" value={overview?.posts_tracked ?? 0} />
        </div>
        <p className="text-[11px] text-slate-500">Avg engagement rate {t ? (t.avg_engagement_rate * 100).toFixed(2) : "0"}% · best post {overview?.best_post ? `${fmt(overview.best_post.views)} views` : "—"} · newest {overview?.newest_post?.caption ?? "—"}</p>

        {/* Posts table */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Posts {selected === "all" ? "(all pages)" : `(@${accounts.find(a => a.id === selected)?.account_name ?? ""})`}</h2>
          {posts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No tracked posts yet. Hit “Sync Analytics Now” after a post goes live.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr><th className="py-1 pr-2"></th><th className="pr-2">Lane</th><th className="pr-2">Pub</th><th className="pr-2">Views</th><th className="pr-2">Reach</th><th className="pr-2">Likes</th><th className="pr-2">Cmts</th><th className="pr-2">Saves</th><th className="pr-2">Shares</th><th className="pr-2">Score</th><th className="pr-2">Checker</th><th></th></tr>
                </thead>
                <tbody>
                  {posts.map(p => (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="py-1 pr-2">{(p.thumbnail_url || p.media_public_url)
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={(p.thumbnail_url || p.media_public_url)!} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-slate-600">—</span>}</td>
                      <td className="pr-2 text-slate-400">{laneLabel(p.content_lane)}</td>
                      <td className="pr-2 text-slate-500">{p.published_at ? new Date(p.published_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }) : "—"}</td>
                      <td className="pr-2 tabular-nums text-slate-300">{fmt(p.metrics?.views)}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{fmt(p.metrics?.reach)}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{fmt(p.metrics?.likes)}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{fmt(p.metrics?.comments)}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{fmt(p.metrics?.saves)}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{fmt(p.metrics?.shares)}</td>
                      <td className="pr-2 tabular-nums text-cyan-300">{p.predicted_viral_score ?? "—"}</td>
                      <td className={`pr-2 ${checkerChip(p.viral_checker_status)}`}>{p.viral_checker_status ?? "—"}</td>
                      <td>{p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">↗</a> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ManualQueueRecovery />
        <ScoreHistory accounts={accounts.map(a => ({ id: a.id, account_name: a.account_name }))} />
      </div>
    </main>
  );
}
