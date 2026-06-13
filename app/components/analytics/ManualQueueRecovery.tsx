"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Manual Queue Recovery: stuck manual posts, medium-confidence Instagram matches
// the hourly sync found (confirm or dismiss), and items already auto-resolved.

type Stuck = { id: number; account: string | null; caption: string; family: string; created_at: string };
type Possible = { manual_package_id: number; instagram_media_id: string; similarity: number; caption: string };
type Resolved = { id: number; account: string | null; caption: string | null; permalink: string | null; thumbnail: string | null; published_at: string | null };
type Data = { stuck: Stuck[]; possible_matches: Possible[]; auto_resolved: Resolved[]; last_sync_at: string | null };

export default function ManualQueueRecovery() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/manual-queue/recovery");
      const d = await res.json();
      if (res.ok && d.success !== false) setData(d as Data);
    } catch { /* */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function confirm(packageId: number, mediaId?: string) {
    setBusy(packageId);
    try {
      await apiFetch("/api/posts/confirm-manual-posted", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId, instagram_media_id: mediaId }),
      });
      await refresh();
    } finally { setBusy(null); }
  }

  if (!data) return null;
  const nothing = data.stuck.length === 0 && data.possible_matches.length === 0 && data.auto_resolved.length === 0;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold text-slate-100">Manual Queue Recovery</h2>
      <p className="text-xs text-slate-400">Stuck manual posts, Instagram matches the sync found, and auto-resolved items.</p>
      {nothing && <p className="mt-3 text-sm text-slate-500">Nothing stuck — manual posts are being matched automatically.</p>}

      {data.possible_matches.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-amber-300">Possible Instagram matches — confirm to start tracking ({data.possible_matches.length})</p>
          <div className="mt-2 space-y-2">
            {data.possible_matches.map((m, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-slate-300">pkg {m.manual_package_id} ↔ media …{m.instagram_media_id.slice(-6)} <span className="text-slate-500">({Math.round(m.similarity * 100)}% match)</span></p>
                  <p className="truncate text-[11px] text-slate-500">{m.caption}</p>
                </div>
                <button type="button" disabled={busy === m.manual_package_id} onClick={() => confirm(m.manual_package_id, m.instagram_media_id)}
                  className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
                  Confirm posted
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.stuck.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-slate-300">Still in manual queue ({data.stuck.length})</p>
          <div className="mt-2 space-y-1.5">
            {data.stuck.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/70 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-slate-400">{s.account ? `@${s.account} · ` : ""}{s.caption.slice(0, 90)}</p>
                </div>
                <button type="button" disabled={busy === s.id} onClick={() => confirm(s.id)}
                  className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50">
                  Mark posted
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.auto_resolved.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-emerald-300">Auto-resolved ({data.auto_resolved.length})</p>
          <div className="mt-2 space-y-1">
            {data.auto_resolved.slice(0, 8).map(r => (
              <div key={r.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="text-emerald-400">✓</span>
                <span className="truncate">{r.account ? `@${r.account} · ` : ""}{r.caption ?? ""}</span>
                {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" className="ml-auto text-cyan-400 hover:underline">↗</a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
