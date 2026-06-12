"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ReelsAccountSettings, ReelRunView } from "@/lib/supabase";

// The Reels autopilot control surface. By design this is view-mostly: the only
// human actions are the per-account toggle/settings — ideation, production,
// publishing, and learning all run on crons.

const STAGE_ORDER = [
  "queued", "briefed", "keyframes_ready", "clips_generating",
  "lipsyncing", "clips_ready", "assembled", "captioned", "publishing", "published",
];

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  briefed: "Brief ready",
  keyframes_ready: "Keyframes ready",
  clips_generating: "Generating clips",
  lipsyncing: "Lip-syncing host",
  clips_ready: "Clips ready",
  assembled: "Video assembled",
  captioned: "Awaiting slot",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
};

function statusChipClasses(status: string): string {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-600";
  if (status === "publishing" || status === "captioned") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function stageProgress(status: string): number {
  const i = STAGE_ORDER.indexOf(status);
  return i < 0 ? 0 : Math.round((i / (STAGE_ORDER.length - 1)) * 100);
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ReelsAutopilot() {
  const [accounts, setAccounts] = useState<ReelsAccountSettings[]>([]);
  const [runs, setRuns] = useState<ReelRunView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [settingsRes, runsRes] = await Promise.all([
        apiFetch("/api/reels/settings"),
        apiFetch("/api/reels/runs?limit=25"),
      ]);
      const settingsData = await settingsRes.json();
      const runsData = await runsRes.json();
      if (!settingsRes.ok || settingsData.success === false) throw new Error(settingsData.error || "Failed to load settings.");
      if (!runsRes.ok || runsData.success === false) throw new Error(runsData.error || "Failed to load runs.");
      setAccounts(settingsData.accounts as ReelsAccountSettings[]);
      setRuns(runsData.runs as ReelRunView[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000); // pipeline moves on 5-min ticks
    return () => clearInterval(timer);
  }, [refresh]);

  async function patchAccount(accountId: number, patch: Record<string, unknown>) {
    setBusyAccountId(accountId);
    setError(null);
    try {
      const res = await apiFetch("/api/reels/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to update settings.");
      setAccounts(prev => prev.map(a => (a.id === accountId ? (data.account as ReelsAccountSettings) : a)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAccountId(null);
    }
  }

  async function queueRunNow(accountId: number) {
    setBusyAccountId(accountId);
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch("/api/reels/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to queue a reel.");
      setNotice("Reel queued — the next pipeline tick (≤5 min) starts producing it.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAccountId(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}

      {/* Per-account autopilot settings */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-xl bg-slate-200/60" />
        ) : accounts.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
            Connect an Instagram account first — autopilot is configured per account.
          </p>
        ) : (
          accounts.map(account => (
            <div key={account.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={account.reels_autopilot_enabled}
                    disabled={busyAccountId === account.id}
                    onClick={() => patchAccount(account.id, { reels_autopilot_enabled: !account.reels_autopilot_enabled })}
                    className={`relative h-6 w-11 rounded-full transition ${account.reels_autopilot_enabled ? "bg-emerald-500" : "bg-slate-300"} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${account.reels_autopilot_enabled ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">@{account.account_name}</p>
                    <p className="text-xs text-slate-500">
                      {account.reels_autopilot_enabled
                        ? `Autopilot ON — ${account.reels_daily_cap} reel${account.reels_daily_cap > 1 ? "s" : ""}/day around ${account.posting_hour_utc ?? 17}:00 UTC`
                        : "Autopilot off — reels only via Queue now"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Reels/day
                    <select
                      value={account.reels_daily_cap}
                      disabled={busyAccountId === account.id}
                      onChange={e => patchAccount(account.id, { reels_daily_cap: Number(e.target.value) })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Post hour (UTC)
                    <select
                      value={account.posting_hour_utc ?? ""}
                      disabled={busyAccountId === account.id}
                      onChange={e => patchAccount(account.id, { posting_hour_utc: e.target.value === "" ? null : Number(e.target.value) })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="">default</option>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busyAccountId === account.id}
                    onClick={() => queueRunNow(account.id)}
                    className="rounded-xl bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50"
                  >
                    Queue a reel now
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  defaultValue={account.niche ?? ""}
                  placeholder="Niche, e.g. budget travel hacks for students (guides the strategist)"
                  disabled={busyAccountId === account.id}
                  onBlur={e => {
                    const value = e.target.value.trim() || null;
                    if (value !== (account.niche ?? null)) patchAccount(account.id, { niche: value });
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-fuchsia-300"
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pipeline runs */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Production pipeline</h3>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-slate-200/60" />
          ) : runs.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
              No reels in production yet. Turn on autopilot or queue one manually.
            </p>
          ) : (
            runs.map(run => (
              <div key={run.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {run.title ?? `Run #${run.id}`}
                      {run.account_name && <span className="ml-2 text-xs font-normal text-slate-400">@{run.account_name}</span>}
                    </p>
                    {run.hook && <p className="mt-0.5 truncate text-xs text-slate-500">{run.hook}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusChipClasses(run.status)}`}>
                      {STAGE_LABELS[run.status] ?? run.status}
                    </span>
                    <span className="text-[11px] text-slate-400">{formatRelative(run.updated_at)}</span>
                  </div>
                </div>

                {run.status !== "failed" && run.status !== "published" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-fuchsia-400 transition-all" style={{ width: `${stageProgress(run.status)}%` }} />
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                  {run.beats > 0 && <span>{run.keyframes_done}/{run.beats} keyframes · {run.clips_done}/{run.beats} clips</span>}
                  {run.audio_mood && <span>audio: {run.audio_mood}</span>}
                  {run.scheduled_for && run.status === "captioned" && (
                    <span>slot: {new Date(run.scheduled_for).toLocaleString()}</span>
                  )}
                  {run.video_url && (
                    <a href={run.video_url} target="_blank" rel="noreferrer" className="font-medium text-fuchsia-600 hover:underline">
                      Preview video
                    </a>
                  )}
                  {run.permalink && (
                    <a href={run.permalink} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 hover:underline">
                      View on Instagram
                    </a>
                  )}
                </div>

                {run.error_message && (
                  <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-600">
                    {run.status === "failed" ? `Failed at ${run.failed_stage ?? "?"}: ` : `Retrying (attempt ${run.attempt_count}): `}
                    {run.error_message}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
