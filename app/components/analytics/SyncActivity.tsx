"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Sync activity: when analytics last synced, the recent run history (so bad
// syncs are debuggable), and any posts stuck on a Meta error.

type Run = {
  id: number; started_at: string; finished_at: string | null; status: string; trigger: string | null;
  accounts_checked: number; instagram_posts_found: number; new_posts_created: number;
  existing_posts_rechecked: number; snapshots_created: number; viral_checks_created: number; errors_count: number;
};
type ErrPost = { id: number; caption: string | null; permalink: string | null; sync_error_count: number; last_sync_error: string | null; last_analytics_sync_at: string | null; status: string | null };
type Data = { last_sync_at: string | null; runs: Run[]; error_posts: ErrPost[] };

const ptTime = (s: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "never";

export default function SyncActivity() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/analytics/sync-logs");
      const d = await res.json();
      if (res.ok && d.success !== false) setData(d as Data);
    } catch { /* */ }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 120_000); return () => clearInterval(t); }, [refresh]);

  if (!data) return null;
  const errs = data.error_posts.length;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Sync activity</h3>
          <p className="text-xs text-slate-400">Last synced {ptTime(data.last_sync_at)} · {data.runs.length} recent runs{errs > 0 ? <span className="text-rose-300"> · {errs} post{errs === 1 ? "" : "s"} with errors</span> : null}</p>
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700">
          {open ? "Hide log" : "Show log"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-slate-500"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Trigger</th><th className="pr-3">Accts</th><th className="pr-3">Found</th><th className="pr-3">New</th><th className="pr-3">Snapshots</th><th className="pr-3">Backfills</th><th>Errors</th></tr></thead>
              <tbody>
                {data.runs.map(r => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="py-1 pr-3 text-slate-400">{ptTime(r.finished_at ?? r.started_at)}</td>
                    <td className="pr-3 text-slate-500">{r.trigger ?? "?"}</td>
                    <td className="pr-3 tabular-nums text-slate-400">{r.accounts_checked}</td>
                    <td className="pr-3 tabular-nums text-slate-400">{r.instagram_posts_found}</td>
                    <td className="pr-3 tabular-nums text-slate-400">{r.new_posts_created}</td>
                    <td className="pr-3 tabular-nums text-slate-400">{r.snapshots_created}</td>
                    <td className="pr-3 tabular-nums text-slate-400">{r.viral_checks_created}</td>
                    <td className={`tabular-nums ${r.errors_count > 0 ? "text-rose-300" : "text-slate-500"}`}>{r.errors_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.error_posts.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-rose-300">Posts with sync errors</p>
              <div className="mt-1 space-y-1">
                {data.error_posts.slice(0, 10).map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className={`rounded px-1.5 py-0.5 ${p.status === "error" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>{p.sync_error_count}×</span>
                    <span className="min-w-0 flex-1 truncate">{p.caption ?? `post ${p.id}`} — <span className="text-slate-500">{p.last_sync_error ?? ""}</span></span>
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">↗</a>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
