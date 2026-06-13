"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Performance Lab: what's working across the network. All numbers flow from
// the existing insights system via performance_tags (refreshed nightly by the
// measure cron at ~11:30 PM PT).

type GroupStat = { key: string; posts: number; avgEngagement: number | null; totalReach: number; totalLikes: number };
type Perf = {
  totalTagged: number;
  byBrand: GroupStat[];
  byFormat: GroupStat[];
  byStreamer: GroupStat[];
  byMomentType: GroupStat[];
  byTopic: GroupStat[];
  byCity: GroupStat[];
  byHourUtc: GroupStat[];
};

function hourLabel(utcHourKey: string): string {
  const d = new Date();
  d.setUTCHours(Number(utcHourKey), 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric" }); // viewer-local (PT for the owner)
}

function Board({ title, stats, labelFn }: { title: string; stats: GroupStat[]; labelFn?: (k: string) => string }) {
  if (stats.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <div className="mt-2 space-y-1.5">
        {stats.slice(0, 5).map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className={`w-4 font-bold ${i === 0 ? "text-amber-300" : "text-slate-500"}`}>{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-slate-300">{labelFn ? labelFn(s.key) : s.key.replace(/_/g, " ")}</span>
            <span className="tabular-nums text-slate-500">{s.posts} post{s.posts === 1 ? "" : "s"}</span>
            <span className="w-16 text-right tabular-nums text-cyan-300">
              {s.avgEngagement != null ? `${(s.avgEngagement * 100).toFixed(1)}%` : `${s.totalLikes}♥`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PerformanceLab() {
  const [perf, setPerf] = useState<Perf | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/media-network/performance");
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to load performance data.");
      setPerf(data as Perf);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-slate-800/60" />;
  if (error) return <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>;
  if (!perf || perf.totalTagged === 0) {
    return (
      <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
        No published packages with insights yet. The lab fills itself as posts publish and the nightly
        measure run (~11:30 PM PT) attaches their numbers.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {perf.totalTagged} published package{perf.totalTagged === 1 ? "" : "s"} measured · engagement = (likes+comments+saves+shares) / reach · refreshed nightly ~11:30 PM PT
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Board title="🏆 Best brand" stats={perf.byBrand} />
        <Board title="🎞 Best format" stats={perf.byFormat} />
        <Board title="🎮 Best streamer" stats={perf.byStreamer} />
        <Board title="⚡ Best moment type" stats={perf.byMomentType} />
        <Board title="🗞 Best topic" stats={perf.byTopic} />
        <Board title="📍 Best city/region" stats={perf.byCity} />
        <Board title="🕐 Best posting hour" stats={perf.byHourUtc} labelFn={hourLabel} />
      </div>
    </div>
  );
}
