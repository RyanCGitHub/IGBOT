"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ContentPackage } from "@/lib/media-network/types";

// Content Packages — the review hub. Nothing reaches Instagram except
// through this room: edit, approve, Studio-process clips, then Convert to
// Draft (server-side compliance gate).

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";

const STATUS_FILTERS = ["all", "draft", "ready", "scheduled", "published", "idea", "rejected", "archived"] as const;

function statusChip(status: string): string {
  switch (status) {
    case "published": return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
    case "scheduled": return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300";
    case "ready": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "draft": return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "idea": return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    default: return "border-slate-600 bg-slate-800 text-slate-400";
  }
}

export default function ContentPackages() {
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "reel">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editHashtags, setEditHashtags] = useState("");
  const [publishAt, setPublishAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      // manual_only packages live in their own Manual Queue tab — keep this hub clean.
      const res = await apiFetch(`/api/media-network/packages?manual_only=false${filter === "all" ? "" : `&status=${filter}`}`);
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to load packages.");
      setPackages(data.packages as ContentPackage[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  async function patchPackage(id: number, patch: Record<string, unknown>) {
    setBusyId(id);
    try {
      const res = await apiFetch("/api/media-network/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Update failed.");
      setError(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function processInStudio(pkg: ContentPackage) {
    setBusyId(pkg.id);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/process-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Studio failed.");
      setNotice("Studio processing complete — preview the produced clip below.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function convert(pkg: ContentPackage) {
    setBusyId(pkg.id);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/convert-to-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_id: pkg.id,
          ...(publishAt ? { publish_at: new Date(publishAt).toISOString() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Conversion failed.");
      setNotice(
        data.kind === "reel_run"
          ? `Queued as reel — publishes ${new Date(data.scheduled_for).toLocaleString()} (your local time).`
          : `Created ig_posts ${data.status} #${data.ig_post_id}.`
      );
      setPublishAt("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  const mediaUrl = (pkg: ContentPackage) =>
    pkg.processed_media_path
      ? `https://ecdmboqepwxdnocvrmgg.supabase.co/storage/v1/object/public/instagram-media/${pkg.processed_media_path}`
      : null;

  const shown = packages.filter(p =>
    typeFilter === "all" ? true : typeFilter === "reel" ? p.package_type === "breaking_news_reel" : p.package_type !== "breaking_news_reel"
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-1.5">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              filter === s ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-700" />
        {(["all", "image", "reel"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTypeFilter(t)}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${typeFilter === t ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}>
            {t === "all" ? "all types" : t === "reel" ? "Reels" : "Image posts"}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          No packages here. Generate them from the News Desk or Clip Desk.
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map(pkg => {
            const url = mediaUrl(pkg);
            const isClip = pkg.package_family === "streamer_clips";
            const studioDone = Boolean(pkg.processed_media_path?.includes("/studio/"));
            const editing = editId === pkg.id;
            return (
              <div key={pkg.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100">{pkg.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {isClip ? "clip reel" : pkg.package_type.replace(/_/g, " ")} · rights: {pkg.rights_status}
                      {pkg.verification_status ? ` · verification: ${pkg.verification_status}` : ""}
                      {url && <> · <a href={url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">media ↗</a></>}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusChip(pkg.status)}`}>
                    {pkg.status}
                  </span>
                </div>

                {pkg.hook && <p className="mt-2 text-sm text-slate-300">🪝 {pkg.hook}</p>}

                {editing ? (
                  <div className="mt-2 space-y-2">
                    <textarea className={`${inputCls} resize-none`} rows={5} value={editCaption} onChange={e => setEditCaption(e.target.value)} />
                    <input className={inputCls} value={editHashtags} onChange={e => setEditHashtags(e.target.value)} placeholder="#hashtags" />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => { await patchPackage(pkg.id, { caption: editCaption, hashtags: editHashtags }); setEditId(null); }}
                        className="rounded-lg bg-cyan-500/90 px-3 py-1.5 text-[11px] font-semibold text-slate-950"
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  pkg.caption && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-400">{pkg.caption}{pkg.hashtags ? `\n\n${pkg.hashtags}` : ""}</p>
                )}

                {pkg.compliance_notes && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-amber-400/90">Compliance notes</summary>
                    <p className="mt-1 whitespace-pre-line text-[11px] text-amber-300/70">{pkg.compliance_notes}</p>
                  </details>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!editing && ["idea", "draft", "ready"].includes(pkg.status) && (
                    <button
                      type="button"
                      onClick={() => { setEditId(pkg.id); setEditCaption(pkg.caption ?? ""); setEditHashtags(pkg.hashtags ?? ""); }}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                    >
                      Edit
                    </button>
                  )}
                  {isClip && !studioDone && ["idea", "draft", "ready"].includes(pkg.status) && (
                    <button
                      type="button"
                      disabled={busyId === pkg.id}
                      onClick={() => processInStudio(pkg)}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                    >
                      {busyId === pkg.id ? "Processing…" : "🎬 Process in Studio"}
                    </button>
                  )}
                  {pkg.status === "draft" && (
                    <button
                      type="button"
                      disabled={busyId === pkg.id}
                      onClick={() => patchPackage(pkg.id, { status: "ready" })}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      Approve
                    </button>
                  )}
                  {["idea", "draft", "ready"].includes(pkg.status) && (
                    <>
                      <button
                        type="button"
                        onClick={() => patchPackage(pkg.id, { status: "rejected" })}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-700"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => patchPackage(pkg.id, { status: "archived" })}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-700"
                      >
                        Archive
                      </button>
                    </>
                  )}
                  {pkg.status === "ready" && (
                    <span className="ml-auto flex items-center gap-2">
                      <input
                        type="datetime-local"
                        value={publishAt}
                        onChange={e => setPublishAt(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                        title="Publish time (your local time) — leave empty for draft / default slot"
                      />
                      <button
                        type="button"
                        disabled={busyId === pkg.id}
                        onClick={() => convert(pkg)}
                        className="rounded-lg bg-fuchsia-500/90 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-fuchsia-400 disabled:opacity-40"
                      >
                        {busyId === pkg.id ? "Converting…" : "Convert to Draft →"}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
