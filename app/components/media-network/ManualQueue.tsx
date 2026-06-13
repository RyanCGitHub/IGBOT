"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ContentPackage } from "@/lib/media-network/types";

// Manual Queue: packages the owner finishes by hand in the Instagram app (to add
// a trending song — the API can't attach IG's licensed audio). Each card offers
// a downloadable image + silent 9:16 Reel and a one-tap caption copy, then a
// "Mark as posted" once it's live.

type QueueItem = ContentPackage & {
  media_public_url: string | null;
  manual_video_public_url: string | null;
};

export default function ManualQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/media-network/packages?manual_only=true");
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to load the manual queue.");
      // Show only the ones still awaiting a hand-post.
      setItems((data.packages as QueueItem[]).filter(p => p.status === "ready"));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function setStatus(id: number, status: "published" | "archived") {
    await apiFetch("/api/media-network/packages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await refresh();
  }

  async function copyCaption(item: QueueItem) {
    const text = [item.caption, item.hashtags].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(c => (c === item.id ? null : c)), 1800);
    } catch {
      setError("Couldn't copy — long-press the caption text to copy it manually.");
    }
  }

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-slate-800/60" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Finish these by hand in the app. <span className="text-violet-300">For music:</span> open Instagram → <b>Reel</b> → upload the <b>↓ Reel</b> video (fills the screen, no cropping) → add your song → paste caption.
        The <b>↓ Image</b> is only for a silent feed photo.
      </p>
      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          Nothing waiting. Hit <span className="text-violet-300">🎵 Music post</span> on a story in the News Desk to prep one here.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(item => (
            <div key={item.id} className="flex gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-3">
              {item.media_public_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.media_public_url} alt="" className="h-32 w-[102px] shrink-0 rounded-lg object-cover" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="line-clamp-2 text-sm font-medium text-slate-200">{item.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.caption}</p>

                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {item.manual_video_public_url ? (
                    <a
                      href={item.manual_video_public_url}
                      download
                      className="rounded-lg bg-violet-500/90 px-2.5 py-1 text-[11px] font-semibold text-slate-950 transition hover:bg-violet-400"
                    >
                      ↓ Reel
                    </a>
                  ) : (
                    <span className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-500">no video</span>
                  )}
                  {item.media_public_url && (
                    <a
                      href={item.media_public_url}
                      download
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700"
                    >
                      ↓ Image
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => copyCaption(item)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700"
                  >
                    {copiedId === item.id ? "Copied ✓" : "Copy caption"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(item.id, "published")}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    Mark posted
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(item.id, "archived")}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
