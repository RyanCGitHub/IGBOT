"use client";

import type { ReactNode } from "react";

// Light SaaS dashboard shell: off-white background, max-width container, clean header.
export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 sm:px-8 lg:px-12">
        {/* Header */}
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-7 py-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-sm font-bold text-white shadow-sm">
              IG
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                Instagram Content OS
              </h1>
              <p className="text-sm text-slate-500">
                Plan, approve, schedule, and measure — one command center.
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Manual approval mode
          </span>
        </header>

        {children}
      </div>
    </main>
  );
}
