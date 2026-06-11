"use client";

// Neon accent palette — used sparingly for the value, never the whole card.
export type StatAccent = "cyan" | "magenta" | "purple" | "gold" | "blue" | "slate";

const ACCENT_TEXT: Record<StatAccent, string> = {
  cyan:    "text-cyan-600",
  magenta: "text-fuchsia-600",
  purple:  "text-purple-600",
  gold:    "text-amber-500",
  blue:    "text-blue-600",
  slate:   "text-slate-900",
};

const ACCENT_DOT: Record<StatAccent, string> = {
  cyan:    "bg-cyan-400",
  magenta: "bg-fuchsia-400",
  purple:  "bg-purple-400",
  gold:    "bg-amber-400",
  blue:    "bg-blue-400",
  slate:   "bg-slate-300",
};

export default function StatCard({
  label,
  value,
  accent = "slate",
  hint,
  unavailable = false,
}: {
  label: string;
  value: string | number;
  accent?: StatAccent;
  hint?: string;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${unavailable ? "bg-slate-200" : ACCENT_DOT[accent]}`} />
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      {unavailable ? (
        <p className="mt-2 text-sm font-medium text-slate-400">Unavailable</p>
      ) : (
        <p className={`mt-1.5 text-3xl font-bold tracking-tight ${ACCENT_TEXT[accent]}`}>{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
