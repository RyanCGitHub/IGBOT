"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ConnectedAccount, Learning, IgPost, PostInsights } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Shape of a grouping stat as stored in a learning's evidence aggregates.
type GroupStat = { key: string; count: number; avgScore: number; smallSample: boolean };
type Evidence = {
  posts_analyzed?: number;
  score_basis?: string;
  by_caption_style?: GroupStat[];
  by_content_pillar?: GroupStat[];
  by_media_source?: GroupStat[];
  by_hour?: GroupStat[];
  by_day_of_week?: GroupStat[];
};

const GROUP_LABELS: { key: keyof Evidence; label: string }[] = [
  { key: "by_caption_style", label: "Caption style" },
  { key: "by_content_pillar", label: "Content pillar" },
  { key: "by_media_source", label: "Media source" },
  { key: "by_hour", label: "Hour of day" },
  { key: "by_day_of_week", label: "Day of week" },
];

function GroupTable({ label, stats }: { label: string; stats: GroupStat[] }) {
  if (!stats?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1.5 space-y-1">
        {stats.slice(0, 6).map(s => (
          <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 truncate text-slate-700">
              {s.key}
              {s.smallSample && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">low sample</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-slate-500">
              {s.avgScore.toFixed(3)} · {s.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LearningEngine ─────────────────────────────────────────────────────────────

export default function LearningEngine() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Load accounts once
  useEffect(() => {
    apiFetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const list = d.accounts as ConnectedAccount[];
          setAccounts(list);
          if (list.length > 0) setAccountId(list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const loadForAccount = useCallback(async (id: number) => {
    setError(null);
    setNotice(null);
    try {
      const [learnRes, postsRes, insightsRes] = await Promise.all([
        apiFetch(`/api/learnings?account_id=${id}`),
        apiFetch("/api/ig-posts"),
        apiFetch("/api/post-insights"),
      ]);
      const learnData = await learnRes.json();
      if (learnData.success) setLearnings(learnData.learnings as Learning[]);

      // Newest synced_at among this account's posts → stale-insights notice.
      const postsData = await postsRes.json();
      const insightsData = await insightsRes.json();
      if (postsData.success && insightsData.success) {
        const accountPostIds = new Set(
          (postsData.posts as IgPost[]).filter(p => p.account_id === id).map(p => p.id)
        );
        const newest = (insightsData.insights as PostInsights[])
          .filter(r => accountPostIds.has(r.post_id) && r.synced_at)
          .reduce<string | null>((latest, r) => (!latest || new Date(r.synced_at) > new Date(latest) ? r.synced_at : latest), null);
        setLastSync(newest);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { if (accountId != null) loadForAccount(accountId); }, [accountId, loadForAccount]);

  async function handleGenerate() {
    if (accountId == null) return;
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/learnings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Generation failed.");
      if (data.message) setNotice(data.message);
      await loadForAccount(accountId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  }

  async function setStatus(l: Learning, status: "active" | "archived") {
    setBusyId(l.id);
    try {
      const res = await apiFetch(`/api/learnings/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Update failed."); return; }
      setLearnings(prev => prev.map(x => x.id === l.id ? (data.learning as Learning) : x));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(l: Learning) {
    if (!confirm("Delete this learning? It will stop influencing generation.")) return;
    setBusyId(l.id);
    try {
      const res = await apiFetch(`/api/learnings/${l.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Delete failed."); return; }
      setLearnings(prev => prev.filter(x => x.id !== l.id));
    } finally {
      setBusyId(null);
    }
  }

  const active = learnings.filter(l => l.status === "active");
  const archived = learnings.filter(l => l.status === "archived");
  // Most recent learning's evidence carries the win/loss aggregates.
  const evidence = (learnings[0]?.evidence ?? null) as Evidence | null;

  // Stale if no sync, or older than 3 days.
  const staleMs = 3 * 24 * 60 * 60 * 1000;
  const isStale = !lastSync || Date.now() - new Date(lastSync).getTime() > staleMs;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Account</label>
          {accounts.length > 0 ? (
            <select
              value={accountId ?? ""}
              onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}
              disabled={isGenerating}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-300 disabled:opacity-50"
            >
              {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
            </select>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">No connected accounts.</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || accountId == null}
          className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating ? "Analyzing…" : "Generate Learning Summary"}
        </button>
      </div>

      {/* Stale-insights notice */}
      {accountId != null && isStale && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Learnings are based on stored insights last synced <strong>{formatRelative(lastSync)}</strong>.
          Run <span className="font-medium">Sync Insights</span> in Analytics for fresher data.
        </p>
      )}

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      {notice && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{notice}</p>}

      {/* Win/loss groupings from the latest summary's evidence */}
      {evidence ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">What&apos;s working</p>
            {typeof evidence.posts_analyzed === "number" && (
              <span className="text-xs text-slate-500">{evidence.posts_analyzed} posts · higher score = better</span>
            )}
          </div>
          {evidence.score_basis && <p className="mt-0.5 text-[11px] text-slate-400">{evidence.score_basis}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {GROUP_LABELS.map(g => (
              <GroupTable key={g.key} label={g.label} stats={(evidence[g.key] as GroupStat[]) ?? []} />
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          Generate a summary to see what&apos;s working, grouped by attribute.
        </p>
      )}

      {/* Active learnings */}
      <div>
        <p className="text-sm font-semibold text-slate-800">Active learnings <span className="text-slate-400">({active.length})</span></p>
        <p className="mt-0.5 text-[11px] text-slate-400">Active learnings steer caption, idea, scheduling, and performance generation for this account.</p>
        <div className="mt-2 space-y-2">
          {isLoading ? (
            <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
          ) : active.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">No active learnings yet.</p>
          ) : (
            active.map(l => (
              <div key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-sm text-slate-700">{l.finding}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setStatus(l, "archived")} disabled={busyId === l.id}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
                    Archive
                  </button>
                  <button type="button" onClick={() => handleDelete(l)} disabled={busyId === l.id}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Archived learnings */}
      {archived.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-800">Archived <span className="text-slate-400">({archived.length})</span></p>
          <div className="mt-2 space-y-2">
            {archived.map(l => (
              <div key={l.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 opacity-70">
                <p className="text-sm text-slate-500">{l.finding}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setStatus(l, "active")} disabled={busyId === l.id}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50">
                    Activate
                  </button>
                  <button type="button" onClick={() => handleDelete(l)} disabled={busyId === l.id}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 disabled:opacity-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
