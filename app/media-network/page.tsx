"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import BrandNetwork from "@/app/components/media-network/BrandNetwork";
import SourceManager from "@/app/components/media-network/SourceManager";
import NewsDesk from "@/app/components/media-network/NewsDesk";
import ClipDesk from "@/app/components/media-network/ClipDesk";

// Media Network — the newsroom. Owner's no-clutter rule: KPI strip on top,
// ONE desk visible at a time via tabs, everything else stays off-screen.

type Overview = {
  activeBrands: number;
  pendingNews: number;
  pendingClips: number;
  readyPackages: number;
  scheduled: number;
  publishedToday: number;
  needsReview: number;
};

const TABS = [
  { id: "brands", label: "Brand Network" },
  { id: "news", label: "News Desk" },
  { id: "clips", label: "Clip Desk" },
  { id: "sources", label: "Sources" },
  { id: "packages", label: "Packages" },
  { id: "performance", label: "Performance" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Kpi({ label, value, accent = "text-slate-100" }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/40 px-4 py-10 text-center">
      <p className="text-sm text-slate-400">Lands in {phase} of the build plan.</p>
    </div>
  );
}

export default function MediaNetworkPage() {
  const [tab, setTab] = useState<TabId>("brands");
  const [overview, setOverview] = useState<Overview | null>(null);

  const refreshOverview = useCallback(async () => {
    try {
      const res = await apiFetch("/api/media-network/overview");
      const data = await res.json();
      if (res.ok && data.success !== false) setOverview(data.overview as Overview);
    } catch { /* KPI strip is non-critical */ }
  }, []);

  useEffect(() => {
    refreshOverview();
    const timer = setInterval(refreshOverview, 120_000);
    return () => clearInterval(timer);
  }, [refreshOverview]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(56,189,248,0.10),transparent),radial-gradient(40%_30%_at_85%_20%,rgba(217,70,239,0.08),transparent)]" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:px-8 lg:px-12">
        {/* Header */}
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-7 py-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-500 text-sm font-bold text-white shadow-[0_0_18px_rgba(217,70,239,0.35)]">
              MN
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">Media Network</h1>
              <p className="text-sm text-slate-400">News desks & clip desks — review everything, publish on your word.</p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
          >
            ← Command Center
          </Link>
        </header>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Kpi label="Active brands" value={overview?.activeBrands ?? 0} />
          <Kpi label="Pending news" value={overview?.pendingNews ?? 0} accent="text-sky-300" />
          <Kpi label="Pending clips" value={overview?.pendingClips ?? 0} accent="text-sky-300" />
          <Kpi label="Needs review" value={overview?.needsReview ?? 0} accent="text-amber-300" />
          <Kpi label="Ready" value={overview?.readyPackages ?? 0} accent="text-emerald-300" />
          <Kpi label="Scheduled" value={overview?.scheduled ?? 0} accent="text-fuchsia-300" />
          <Kpi label="Published today" value={overview?.publishedToday ?? 0} accent="text-cyan-300" />
        </div>

        {/* Tabs — one desk at a time */}
        <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-1.5">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "bg-slate-800 text-slate-100 shadow"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Active desk */}
        {tab === "brands" && <BrandNetwork />}
        {tab === "sources" && <SourceManager />}
        {tab === "news" && <NewsDesk />}
        {tab === "clips" && <ClipDesk />}
        {tab === "packages" && <ComingSoon phase="Phase 5 (Content Packages)" />}
        {tab === "performance" && <ComingSoon phase="Phase 7 (Performance Lab)" />}
      </div>
    </main>
  );
}
