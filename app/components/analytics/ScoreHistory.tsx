"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Viral Score History: every score ever given, filterable, with a row drill-down
// (strengths / weaknesses / fixes). pre_publish vs backfill vs manual stay
// visually distinct.

type Row = {
  id: number; account_name: string | null; thumbnail: string | null; permalink: string | null; post_status: string | null;
  media_type: string | null; content_lane: string | null; score_context: string; viral_score: number | null; confidence_score: number | null;
  hook_score: number | null; retention_score: number | null; shareability_score: number | null; caption_score: number | null;
  scored_at: string; accuracy_score: number | null; prediction_result: string | null;
  strengths: string[] | null; weaknesses: string[] | null; suggested_fixes: string[] | null;
};

const ctxChip = (c: string) => ({
  pre_publish_prediction: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  manual_check: "border-slate-600 bg-slate-800 text-slate-300",
  post_publish_backfill: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "24h_review": "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
}[c] ?? "border-slate-600 bg-slate-800 text-slate-400");
const fmt = (s: string) => new Date(s).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });

export default function ScoreHistory({ accounts }: { accounts: { id: number; account_name: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [account, setAccount] = useState("");
  const [context, setContext] = useState("");
  const [lane, setLane] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const p = new URLSearchParams();
    if (account) p.set("account_id", account);
    if (context) p.set("score_context", context);
    if (lane) p.set("content_lane", lane);
    try {
      const res = await apiFetch(`/api/viral-score/history?${p}`);
      const d = await res.json();
      if (res.ok && d.success !== false) setRows(d.rows as Row[]);
    } catch { /* */ }
  }, [account, context, lane]);
  useEffect(() => { refresh(); }, [refresh]);

  const sel = "rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300";

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Viral Score History</h2>
        <div className="flex flex-wrap gap-1.5">
          <select className={sel} value={account} onChange={e => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
          </select>
          <select className={sel} value={context} onChange={e => setContext(e.target.value)}>
            <option value="">All contexts</option>
            <option value="pre_publish_prediction">Pre-publish</option>
            <option value="post_publish_backfill">Backfill</option>
            <option value="manual_check">Manual check</option>
            <option value="24h_review">24h review</option>
          </select>
          <select className={sel} value={lane} onChange={e => setLane(e.target.value)}>
            <option value="">All lanes</option>
            <option value="news_media">News</option>
            <option value="streamer_clips">Clips</option>
            <option value="avatar_reels">Avatar</option>
            <option value="general">General</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 py-4 text-center text-sm text-slate-500">No scores recorded yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-slate-500">
              <tr><th className="py-1 pr-2"></th><th className="pr-2">Account</th><th className="pr-2">Context</th><th className="pr-2">Type</th><th className="pr-2">Lane</th><th className="pr-2">Score</th><th className="pr-2">Conf</th><th className="pr-2">Hook</th><th className="pr-2">Ret</th><th className="pr-2">Share</th><th className="pr-2">Cap</th><th className="pr-2">Scored</th><th className="pr-2">Acc</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="py-1 pr-2">{r.thumbnail
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={r.thumbnail} alt="" className="h-7 w-7 rounded object-cover" /> : <span className="text-slate-600">—</span>}</td>
                    <td className="pr-2 text-slate-400">{r.account_name ? `@${r.account_name}` : "—"}</td>
                    <td className="pr-2"><span className={`rounded border px-1.5 py-0.5 text-[10px] ${ctxChip(r.score_context)}`}>{r.score_context.replace(/_/g, " ")}</span></td>
                    <td className="pr-2 text-slate-400">{r.media_type ?? "—"}</td>
                    <td className="pr-2 text-slate-400">{r.content_lane ?? "—"}</td>
                    <td className="pr-2 tabular-nums font-semibold text-cyan-300">{r.viral_score ?? "—"}</td>
                    <td className="pr-2 tabular-nums text-slate-500">{r.confidence_score ?? "—"}</td>
                    <td className="pr-2 tabular-nums text-slate-400">{r.hook_score ?? "—"}</td>
                    <td className="pr-2 tabular-nums text-slate-400">{r.retention_score ?? "—"}</td>
                    <td className="pr-2 tabular-nums text-slate-400">{r.shareability_score ?? "—"}</td>
                    <td className="pr-2 tabular-nums text-slate-400">{r.caption_score ?? "—"}</td>
                    <td className="pr-2 text-slate-500">{fmt(r.scored_at)}</td>
                    <td className="pr-2 tabular-nums text-slate-400">{r.accuracy_score ?? "—"}</td>
                    <td>{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-cyan-400 hover:underline">↗</a> : null}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="border-t border-slate-800/50 bg-slate-900/40">
                      <td colSpan={14} className="px-3 py-2">
                        <div className="grid gap-3 sm:grid-cols-3 text-[11px]">
                          <div><p className="font-semibold text-emerald-300">Strengths</p><ul className="mt-1 space-y-0.5 text-slate-300">{(r.strengths ?? []).map((s, i) => <li key={i}>✓ {s}</li>)}</ul></div>
                          <div><p className="font-semibold text-amber-300">Weaknesses</p><ul className="mt-1 space-y-0.5 text-slate-300">{(r.weaknesses ?? []).map((s, i) => <li key={i}>• {s}</li>)}</ul></div>
                          <div><p className="font-semibold text-cyan-300">Fixes</p><ul className="mt-1 space-y-0.5 text-slate-300">{(r.suggested_fixes ?? []).map((s, i) => <li key={i}>→ {s}</li>)}</ul></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
