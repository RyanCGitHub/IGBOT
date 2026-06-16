"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import BackgroundWaves from "@/app/components/dashboard/BackgroundWaves";

// The app shell: one consistent header + a 7-area nav so every page has a single
// clear purpose. (Theme stays dark for now; a dedicated pass repaints to white.)
const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/create", label: "Create Post" },
  { href: "/scheduled", label: "Scheduled" },
  { href: "/published", label: "Published" },
  { href: "/analytics", label: "Analytics" },
  { href: "/personas", label: "Personas" },
  { href: "/settings", label: "Settings" },
];

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(56,189,248,0.10),transparent),radial-gradient(40%_30%_at_85%_20%,rgba(217,70,239,0.08),transparent)]" />
      <BackgroundWaves />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-7 py-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-fuchsia-600 text-sm font-bold text-white shadow-[0_0_18px_rgba(56,189,248,0.35)]">
              FW
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">Studio</h1>
              <p className="text-sm text-slate-400">Create, schedule, and track your posts.</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Live
          </span>
        </header>

        <nav className="flex flex-wrap gap-1 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-1.5">
          {NAV.map(item => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  active ? "bg-slate-800 text-slate-100 shadow" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {children}
      </div>
    </main>
  );
}
