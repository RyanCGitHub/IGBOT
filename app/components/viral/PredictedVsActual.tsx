"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Predicted vs Actual: every scored post in one table — account, media, caption,
// predicted score, real views/reach/engagement, accuracy result, posted date.

type Row = {
  published_post_id: number; account: string | null; thumbnail: string | null; permalink: string | null;
  caption: string | null; content_lane: string | null;
  predicted_viral_score: number | null; actual_views: number | null; actual_reach: number | null;
  actual_engagement_rate: number | null; actual_performance_score: number | null;
  accuracy_score: number | null; prediction_result: string | null; did_go_viral: boolean | null;
  published_at: string | null;
};

const fmt = (n: number | null) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const date = (s: string | null) => s ? new Date(s).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }) : "—";
const accColor = (a: number | null) => a == null ? "text-slate-400" : a >= 85 ? "text-emerald-300" : a >= 70 ? "text-lime-300" : a >= 50 ? "text-amber-300" : "text-rose-300";
const resultChip = (r: string | null) => ({
  accurate_high_confidence: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  accurate_medium_confidence: "border-lime-500/40 bg-lime-500/10 text-lime-300",
  overestimated: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  major_overestimate: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  underestimated: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  major_underestimate: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
}[r ?? ""] ?? "border-slate-600 bg-slate-800 text-slate-400");

export default function PredictedVsActual() {
  const [rows, setRows] = useState<Row[]>([]);
  const [account, setAccount] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/viral-score/predicted-vs-actual");
      const d = await res.json();
      if (res.ok && d.success !== false) setRows(d.rows as Row[]);
    } catch { /* */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const accounts = useMemo(() => [...new Set(rows.map(r => r.account).filter(Boolean))] as string[], [rows]);
  const shown = account ? rows.filter(r => r.account === account) : rows;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Predicted vs Actual</h2>
          <p className="text-xs text-slate-400">Every scored post: what we predicted vs how it really performed.</p>
        </div>
        {accounts.length > 1 && (
          <select value={account} onChange={e => setAccount(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a} value={a}>@{a}</option>)}
          </select>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 py-4 text-center text-sm text-slate-500">No scored posts yet. Posts appear here once they publish and analytics sync.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2"></th><th className="pr-2">Account</th><th className="pr-2">Caption</th>
                <th className="pr-2">Predicted</th><th className="pr-2">Views</th><th className="pr-2">Reach</th><th className="pr-2">Eng%</th>
                <th className="pr-2">Actual</th><th className="pr-2">Accuracy</th><th className="pr-2">Result</th><th className="pr-2">Posted</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.published_post_id} className="border-t border-slate-800">
                  <td className="py-1 pr-2">{r.thumbnail
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={r.thumbnail} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-slate-600">—</span>}</td>
                  <td className="pr-2 text-slate-400">{r.account ? `@${r.account}` : "—"}</td>
                  <td className="max-w-[200px] truncate pr-2 text-slate-400" title={r.caption ?? ""}>{r.caption ?? "—"}</td>
                  <td className="pr-2 tabular-nums font-semibold text-cyan-300">{r.predicted_viral_score ?? "—"}</td>
                  <td className="pr-2 tabular-nums text-slate-300">{fmt(r.actual_views)}</td>
                  <td className="pr-2 tabular-nums text-slate-400">{fmt(r.actual_reach)}</td>
                  <td className="pr-2 tabular-nums text-slate-400">{r.actual_engagement_rate != null ? `${(r.actual_engagement_rate * 100).toFixed(1)}` : "—"}</td>
                  <td className="pr-2 tabular-nums text-slate-300">{r.actual_performance_score ?? "—"}{r.did_go_viral ? " 🔥" : ""}</td>
                  <td className={`pr-2 tabular-nums font-semibold ${accColor(r.accuracy_score)}`}>{r.accuracy_score ?? "—"}</td>
                  <td className="pr-2">{r.prediction_result ? <span className={`rounded border px-1.5 py-0.5 text-[10px] ${resultChip(r.prediction_result)}`}>{r.prediction_result.replace(/_/g, " ")}</span> : <span className="text-slate-600">pending</span>}</td>
                  <td className="pr-2 text-slate-500">{date(r.published_at)}</td>
                  <td>{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">↗</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
