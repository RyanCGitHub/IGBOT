"use client";

import { useState, useEffect, useCallback } from "react";
import type { PublishJob, PublishJobStatus } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";

const STATUS_STYLES: Record<PublishJobStatus, string> = {
  published:        "text-emerald-300 bg-emerald-500/10 ring-emerald-400/20",
  failed:           "text-rose-300 bg-rose-500/10 ring-rose-400/20",
  pending:          "text-amber-300 bg-amber-500/10 ring-amber-400/20",
  container_created:"text-blue-300 bg-blue-500/10 ring-blue-400/20",
  polling:          "text-blue-300 bg-blue-500/10 ring-blue-400/20",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PublishHistory() {
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/instagram/history");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to load history.");
      setJobs(data.jobs as PublishJob[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Publish History</h2>
          <p className="mt-1 text-sm text-slate-400">
            Every publish attempt with container IDs, media IDs, and status.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
            {isLoading ? "…" : `${jobs.length} records`}
          </span>
          <button
            type="button"
            onClick={fetchHistory}
            disabled={isLoading}
            className="rounded-3xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-600 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          [1, 2, 3].map(n => (
            <div key={n} className="h-20 animate-pulse rounded-3xl bg-slate-800/60" />
          ))
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : jobs.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            No publish attempts yet. Use the Test Publish section above to publish your first post.
          </p>
        ) : (
          jobs.map(job => (
            <div key={job.id} className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-6 text-slate-200">
                    {job.caption}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-slate-500">
                    {job.container_id && (
                      <span>container: {job.container_id}</span>
                    )}
                    {job.media_id && (
                      <span>media: {job.media_id}</span>
                    )}
                    {job.error_message && (
                      <span className="text-rose-400">{job.error_message}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ring-1 ${STATUS_STYLES[job.status]}`}
                  >
                    {job.status}
                  </span>
                  <span className="text-xs text-slate-500">{formatRelative(job.created_at)}</span>
                </div>
              </div>

              {job.permalink && (
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href={job.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-fuchsia-400 underline underline-offset-2 hover:text-fuchsia-300"
                  >
                    View on Instagram ↗
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
