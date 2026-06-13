"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Viral Score Accuracy: prediction vs actual. The headline numbers are the 72h
// window (official); 24h/7d are reported alongside. "Recalculate Accuracy"
// rebuilds evaluations from existing snapshots without touching predictions.

type LaneStat = { posts: number; avg_predicted: number | null; avg_actual: number | null; avg_accuracy: number | null; overestimate_rate: number; underestimate_rate: number };
type Ranked = { key: string; acc: number; posts: number } | null;
type Summary = {
  avg_accuracy: number | null; avg_absolute_error: number | null;
  evaluated_total: number; evaluated_24h: number; evaluated_72h: number; evaluated_7d: number;
  bucket_correct_pct: number | null; overestimate_pct: number | null; underestimate_pct: number | null;
  best_lane: Ranked; worst_lane: Ranked; best_model: Ranked; worst_model: Ranked;
};
type Row = {
  published_post_id: number | null; thumbnail: string | null; permalink: string | null;
  content_lane: string | null; published_at: string | null;
  predicted_viral_score: number | null; actual_72h_score: number | null; accuracy_score: number | null;
  prediction_result: string | null; views: number | null; performance_multiplier: number | null; did_go_viral: boolean | null;
};
type Data = { summary: Summary; perLane: Record<string, LaneStat>; table: Row[] };

const laneLabel = (l: string | null) => ({ news_media: "News/Media", streamer_clips: "Streamer Clips", avatar_reels: "Avatar Reels", general: "General" }[l ?? ""] ?? l ?? "—");
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }) : "—";
const accColor = (a: number | null) => a == null ? "text-slate-400" : a >= 85 ? "text-emerald-300" : a >= 70 ? "text-lime-300" : a >= 50 ? "text-amber-300" : "text-rose-300";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-100">{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}

const resultChip = (r: string | null) => {
  const map: Record<string, string> = {
    accurate_high_confidence: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    accurate_medium_confidence: "border-lime-500/40 bg-lime-500/10 text-lime-300",
    overestimated: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    major_overestimate: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    underestimated: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    major_underestimate: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  };
  return map[r ?? ""] ?? "border-slate-600 bg-slate-800 text-slate-400";
};

export default function ViralAccuracy() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalcing, setRecalcing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/viral-accuracy");
      const d = await res.json();
      if (res.ok && d.success !== false) setData(d as Data);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function recalculate() {
    setRecalcing(true);
    setNote(null);
    try {
      const res = await apiFetch("/api/viral-accuracy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalculate" }) });
      const d = await res.json();
      if (!res.ok || d.success === false) throw new Error(d.error || "Recalculate failed.");
      setNote(`Recalculated — ${d.evaluations} evaluations across ${d.posts} posts (24h=${d.windows["24h"]} 72h=${d.windows["72h"]} 7d=${d.windows["7d"]}).`);
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setRecalcing(false);
    }
  }

  const s = data?.summary;
  const hasData = !!s && s.evaluated_total > 0;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Viral Score Accuracy</h2>
          <p className="text-xs text-slate-400">Predicted vs actual performance. Official accuracy = 72h window.</p>
        </div>
        <button type="button" onClick={recalculate} disabled={recalcing}
          className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50">
          {recalcing ? "Recalculating…" : "↻ Recalculate Accuracy"}
        </button>
      </div>
      {note && <p className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300">{note}</p>}

      {loading ? (
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : !hasData ? (
        <p className="mt-4 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          No evaluations yet. Once posts publish and the nightly metrics run captures 24h/72h/7d snapshots, accuracy fills in here. (Or hit Recalculate after snapshots exist.)
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Avg accuracy (72h)" value={s!.avg_accuracy ?? "—"} />
            <Stat label="Avg abs error" value={s!.avg_absolute_error ?? "—"} />
            <Stat label="Bucket correct" value={s!.bucket_correct_pct != null ? `${s!.bucket_correct_pct}%` : "—"} />
            <Stat label="Overestimated" value={s!.overestimate_pct != null ? `${s!.overestimate_pct}%` : "—"} />
            <Stat label="Underestimated" value={s!.underestimate_pct != null ? `${s!.underestimate_pct}%` : "—"} />
            <Stat label="Evaluated" value={s!.evaluated_72h} sub={`24h ${s!.evaluated_24h} · 7d ${s!.evaluated_7d}`} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs">
              <span className="text-slate-400">Best lane:</span> <span className="text-emerald-300">{s!.best_lane ? `${laneLabel(s!.best_lane.key)} (${s!.best_lane.acc} acc)` : "—"}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-slate-400">Worst:</span> <span className="text-rose-300">{s!.worst_lane ? `${laneLabel(s!.worst_lane.key)} (${s!.worst_lane.acc})` : "—"}</span>
            </div>
            <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs">
              <span className="text-slate-400">Best model:</span> <span className="text-emerald-300">{s!.best_model ? `${s!.best_model.key} (${s!.best_model.acc})` : "—"}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-slate-400">Worst:</span> <span className="text-rose-300">{s!.worst_model ? `${s!.worst_model.key} (${s!.worst_model.acc})` : "—"}</span>
            </div>
          </div>

          {Object.keys(data!.perLane).length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr><th className="py-1 pr-3">Lane</th><th className="pr-3">Posts</th><th className="pr-3">Avg pred</th><th className="pr-3">Avg actual</th><th className="pr-3">Accuracy</th><th className="pr-3">Over%</th><th>Under%</th></tr>
                </thead>
                <tbody>
                  {Object.entries(data!.perLane).map(([lane, st]) => (
                    <tr key={lane} className="border-t border-slate-800">
                      <td className="py-1 pr-3 text-slate-300">{laneLabel(lane)}</td>
                      <td className="pr-3 tabular-nums text-slate-400">{st.posts}</td>
                      <td className="pr-3 tabular-nums text-slate-400">{st.avg_predicted ?? "—"}</td>
                      <td className="pr-3 tabular-nums text-slate-400">{st.avg_actual ?? "—"}</td>
                      <td className={`pr-3 tabular-nums font-semibold ${accColor(st.avg_accuracy)}`}>{st.avg_accuracy ?? "—"}</td>
                      <td className="pr-3 tabular-nums text-amber-300/80">{st.overestimate_rate}%</td>
                      <td className="tabular-nums text-sky-300/80">{st.underestimate_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data!.table.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2"></th><th className="pr-2">Lane</th><th className="pr-2">Pub</th>
                    <th className="pr-2">Pred</th><th className="pr-2">72h</th><th className="pr-2">Acc</th>
                    <th className="pr-2">Result</th><th className="pr-2">Views</th><th className="pr-2">Mult</th><th className="pr-2">Viral</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data!.table.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-1 pr-2">{r.thumbnail
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={r.thumbnail} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-slate-600">—</span>}</td>
                      <td className="pr-2 text-slate-400">{laneLabel(r.content_lane)}</td>
                      <td className="pr-2 text-slate-500">{fmtDate(r.published_at)}</td>
                      <td className="pr-2 tabular-nums text-slate-300">{r.predicted_viral_score ?? "—"}</td>
                      <td className="pr-2 tabular-nums text-slate-300">{r.actual_72h_score ?? "—"}</td>
                      <td className={`pr-2 tabular-nums font-semibold ${accColor(r.accuracy_score)}`}>{r.accuracy_score ?? "—"}</td>
                      <td className="pr-2"><span className={`rounded border px-1.5 py-0.5 text-[10px] ${resultChip(r.prediction_result)}`}>{(r.prediction_result ?? "—").replace(/_/g, " ")}</span></td>
                      <td className="pr-2 tabular-nums text-slate-400">{r.views ?? "—"}</td>
                      <td className="pr-2 tabular-nums text-slate-400">{r.performance_multiplier != null ? `${r.performance_multiplier}x` : "—"}</td>
                      <td className="pr-2">{r.did_go_viral ? "🔥" : ""}</td>
                      <td>{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">open ↗</a> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
