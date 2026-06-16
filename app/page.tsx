"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import ReelsAutopilot from "@/app/components/ReelsAutopilot";
import { apiFetch } from "@/lib/api-fetch";

// Dashboard — a clean overview: the headline numbers, quick actions, and what's
// in production. Everything else lives behind the nav.

type Overview = {
  totals: { views: number; reach: number; likes: number; comments: number };
  posts_tracked: number;
  last_sync_at: string | null;
};

const fmt = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const ptTime = (s: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "not yet";

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-100">{value}</p>
    </div>
  );
}

const ACTIONS = [
  { href: "/create", label: "Create a post", icon: "✏️" },
  { href: "/scheduled", label: "Scheduled", icon: "📅" },
  { href: "/published", label: "Published", icon: "✅" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
  { href: "/personas", label: "Personas", icon: "🧑‍🎤" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Home() {
  const [ov, setOv] = useState<Overview | null>(null);

  useEffect(() => {
    apiFetch("/api/analytics/overview")
      .then(r => r.json())
      .then(d => { if (d.success !== false) setOv(d as Overview); })
      .catch(() => {});
  }, []);

  return (
    <DashboardShell>
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Views" value={fmt(ov?.totals.views)} />
        <Kpi label="Reach" value={fmt(ov?.totals.reach)} />
        <Kpi label="Likes" value={fmt(ov?.totals.likes)} />
        <Kpi label="Comments" value={fmt(ov?.totals.comments)} />
        <Kpi label="Posts tracked" value={ov?.posts_tracked ?? 0} />
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Synced from Instagram · last update {ptTime(ov?.last_sync_at ?? null)} · <a href="/analytics" className="text-cyan-400 hover:underline">full analytics →</a>
      </p>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ACTIONS.map(a => (
          <a key={a.href} href={a.href} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-5 text-center transition hover:border-cyan-500/40 hover:bg-slate-800">
            <span className="text-2xl">{a.icon}</span>
            <span className="text-sm font-medium text-slate-200">{a.label}</span>
          </a>
        ))}
      </div>

      {/* What's in production */}
      <SectionCard title="In production" subtitle="Reels being produced right now, and the autopilot switch.">
        <ReelsAutopilot />
      </SectionCard>
    </DashboardShell>
  );
}
