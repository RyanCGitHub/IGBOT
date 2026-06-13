"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ContentPackage, NewsItem, MediaBrand } from "@/lib/media-network/types";

// Auto Queue: what's in flight for auto-publish after the owner approves a
// story. Two stages — "approved, generating next tick" (news_items still
// approved) and "scheduled" (a package + ig_post with a publish time). Cancel
// stops a scheduled post before it goes live.

type ScheduledPkg = ContentPackage & { media_public_url: string | null };

function ptTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }) + " PT";
  } catch { return iso; }
}

export default function AutoQueue() {
  const [scheduled, setScheduled] = useState<ScheduledPkg[]>([]);
  const [approved, setApproved] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [schedRes, itemsRes, brandsRes] = await Promise.all([
        apiFetch("/api/media-network/packages?manual_only=false&status=scheduled"),
        apiFetch("/api/media-network/news-items?status=approved"),
        apiFetch("/api/media-network/brands"),
      ]);
      const schedData = await schedRes.json();
      const itemsData = await itemsRes.json();
      const brandsData = await brandsRes.json();
      if (!schedRes.ok || schedData.success === false) throw new Error(schedData.error || "Failed to load the queue.");

      setScheduled((schedData.packages as ScheduledPkg[]).filter(p => p.package_family === "news_media"));

      // Only count approved items for brands with auto-publish on — those are
      // the ones the cron will pick up.
      const autoBrandIds = new Set(
        ((brandsData.brands as MediaBrand[]) ?? []).filter(b => b.auto_publish).map(b => b.id)
      );
      setApproved(((itemsData.items as NewsItem[]) ?? []).filter(i => autoBrandIds.has(i.media_brand_id)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 45_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function cancel(pkgId: number) {
    if (!window.confirm("Cancel this scheduled post? It won't publish.")) return;
    const res = await apiFetch("/api/media-network/cancel-auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_id: pkgId }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) setError(data.error || "Cancel failed.");
    await refresh();
  }

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-slate-800/60" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Everything lined up for auto-publish. Refreshes itself; cancel a scheduled post anytime before it goes out.
      </p>
      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

      {/* Approved, awaiting the next generation tick */}
      {approved.length > 0 && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Approved · generating shortly ({approved.length})
          </h3>
          <div className="mt-2 space-y-1.5">
            {approved.map(i => (
              <div key={i.id} className="flex items-center gap-2 text-xs text-slate-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                <span className="truncate">{i.headline}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">The auto-pilot runs every ~5 min — these become scheduled posts on the next pass.</p>
        </div>
      )}

      {/* Scheduled with a publish time */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fuchsia-300">
          Scheduled to publish ({scheduled.length})
        </h3>
        {scheduled.length === 0 ? (
          <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
            Nothing scheduled. Approve a story with <span className="text-emerald-300">Approve &amp; Auto-Publish</span> in the News Desk and it shows here.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {scheduled.map(p => (
              <div key={p.id} className="flex gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-3">
                {p.media_public_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.media_public_url} alt="" className="h-28 w-[90px] shrink-0 rounded-lg object-cover" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="line-clamp-2 text-sm font-medium text-slate-200">{p.title}</p>
                  <p className="mt-1 text-[11px] font-semibold text-fuchsia-300">▶ {ptTime(p.suggested_publish_time)}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{p.caption}</p>
                  <div className="mt-auto pt-2">
                    <button
                      type="button"
                      onClick={() => cancel(p.id)}
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/20"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
