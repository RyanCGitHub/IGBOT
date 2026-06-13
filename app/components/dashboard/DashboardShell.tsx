"use client";

import type { ReactNode } from "react";
import BackgroundWaves from "@/app/components/dashboard/BackgroundWaves";

// Dark "mission control" shell (owner redesign 2026-06-12): analytics-first,
// deep navy with neon accents, everything operational tucked out of sight.
// The background waves flow while a reel is producing and freeze when idle.
export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* ambient glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(56,189,248,0.10),transparent),radial-gradient(40%_30%_at_85%_20%,rgba(217,70,239,0.08),transparent)]" />
      <BackgroundWaves />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:px-8 lg:px-12">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-7 py-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-fuchsia-600 text-sm font-bold text-white shadow-[0_0_18px_rgba(56,189,248,0.35)]">
              FW
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">
                Reels Command Center
              </h1>
              <p className="text-sm text-slate-400">
                Analytics & production — the machine runs itself.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/analytics"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              Analytics →
            </a>
            <a
              href="/viral-checker"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              Viral Checker →
            </a>
            <a
              href="/media-network"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
            >
              Media Network →
            </a>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Live
            </span>
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}
