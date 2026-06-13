"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Pre-publish gate control: every post (reels, news, clips) is scored right
// before publishing. This panel turns the BLOCK on/off, sets the threshold, and
// shows whatever's currently held for review with a one-click override.

type Held = {
  kind: "ig_post" | "reel";
  id: number;
  caption: string | null;
  image_url: string | null;
  viral_score: number | null;
  verdict: string | null;
  weaknesses: string[];
};

export default function PublishGate() {
  const [enabled, setEnabled] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [held, setHeld] = useState<Held[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/viral-gate");
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setEnabled(!!data.config.enabled);
        setMinScore(Number(data.config.min_score) || 0);
        setHeld(data.held as Held[]);
      }
    } catch { /* panel is non-critical */ }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 60_000); return () => clearInterval(t); }, [refresh]);

  async function saveConfig(next: { enabled?: boolean; min_score?: number }) {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/viral-gate", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Save failed.");
      setEnabled(!!data.config.enabled);
      setMinScore(Number(data.config.min_score) || 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function override(item: Held) {
    await apiFetch("/api/viral-gate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "override", kind: item.kind, id: item.id }),
    });
    await refresh();
  }

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Pre-publish gate</h2>
          <p className="text-xs text-slate-400">Every post is scored before it publishes. Turn on to also <b>hold</b> low scorers for review.</p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => saveConfig({ enabled: !enabled })}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
            enabled ? "bg-emerald-500/90 text-slate-950 hover:bg-emerald-400" : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {enabled ? "Gate ON — blocking" : "Gate OFF — recording only"}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">Min score to publish</span>
        <input
          type="range" min={0} max={100} step={5} value={minScore}
          disabled={!enabled || saving}
          onChange={e => setMinScore(Number(e.target.value))}
          onMouseUp={() => saveConfig({ min_score: minScore })}
          onTouchEnd={() => saveConfig({ min_score: minScore })}
          className="flex-1 accent-cyan-400 disabled:opacity-40"
        />
        <span className="w-10 text-right text-sm font-bold tabular-nums text-cyan-300">{minScore}</span>
      </div>
      {!enabled && <p className="mt-1 text-[11px] text-slate-500">Gate is off, so nothing is blocked yet — scores are still recorded on every post. Turn it on once you have performance data.</p>}
      {error && <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{error}</p>}

      {held.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-amber-300">Held for review ({held.length})</p>
          <div className="mt-2 space-y-2">
            {held.map(h => (
              <div key={`${h.kind}-${h.id}`} className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                {h.image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={h.image_url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-300">
                    <span className="font-semibold text-amber-300">{h.viral_score ?? "—"}</span>
                    <span className="ml-1 text-slate-500">{h.kind === "reel" ? "Reel" : "Post"} · {h.verdict ?? ""}</span>
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{h.weaknesses[0] ?? h.caption ?? ""}</p>
                </div>
                <button
                  type="button"
                  onClick={() => override(h)}
                  className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Publish anyway
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
