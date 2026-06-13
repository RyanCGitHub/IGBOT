"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { NewsItem, MediaBrand, VerificationStatus } from "@/lib/media-network/types";

// News Desk: candidates flow in from the RSS cron (or manual add), get
// verification + sensitivity review, then one click generates a content
// package (caption, carousel, headline graphic). Posting always happens
// later, through Packages → review → draft.

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";
const labelCls = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

function sensChip(level: string): string {
  if (level === "high") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (level === "medium") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-slate-600 bg-slate-800 text-slate-400";
}

export default function NewsDesk() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [brands, setBrands] = useState<MediaBrand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    media_brand_id: "",
    headline: "",
    short_summary: "",
    source_url: "",
    source_name: "",
    city_or_region: "",
    category: "",
  });

  const refresh = useCallback(async () => {
    try {
      const [itemsRes, brandsRes] = await Promise.all([
        apiFetch("/api/media-network/news-items"),
        apiFetch("/api/media-network/brands"),
      ]);
      const itemsData = await itemsRes.json();
      const brandsData = await brandsRes.json();
      if (!itemsRes.ok || itemsData.success === false) throw new Error(itemsData.error || "Failed to load news items.");
      setItems((itemsData.items as NewsItem[]).filter(i => i.status !== "used" && i.status !== "rejected"));
      if (brandsRes.ok && brandsData.success !== false) setBrands(brandsData.brands as MediaBrand[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function addItem() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/media-network/news-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, media_brand_id: Number(form.media_brand_id) }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to add item.");
      if (data.autoFlaggedHigh) setNotice("Item auto-flagged HIGH sensitivity — manual approval required before a package can be generated.");
      setShowForm(false);
      setForm(f => ({ ...f, headline: "", short_summary: "", source_url: "", source_name: "", category: "" }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function patchItem(id: number, patch: Record<string, unknown>) {
    await apiFetch("/api/media-network/news-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await refresh();
  }

  async function generatePackage(item: NewsItem) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/generate-news-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ news_item_id: item.id }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Generation failed.");
      setNotice(`Package created for "${item.headline.slice(0, 60)}…" — review it in the Packages tab.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  // Manual lane: build image + silent 9:16 Reel, park it in the Manual Queue.
  async function prepManual(item: NewsItem) {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/prep-manual-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ news_item_id: item.id }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Prep failed.");
      setNotice(`Prepped for manual posting — open the Manual Queue tab to download the image + Reel and copy the caption, then post in the app with your song.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  const brandName = (id: number) => brands.find(b => b.id === id)?.brand_name ?? `Brand ${id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {items.length} item{items.length === 1 ? "" : "s"} in the desk — RSS sources feed this automatically
        </p>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          {showForm ? "Close" : "+ Add Story"}
        </button>
      </div>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      {showForm && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className={labelCls}>Headline *</p>
              <input className={inputCls} value={form.headline} onChange={e => setForm(f => ({ ...f, headline: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <p className={labelCls}>Summary</p>
              <textarea className={`${inputCls} resize-none`} rows={2} value={form.short_summary} onChange={e => setForm(f => ({ ...f, short_summary: e.target.value }))} />
            </div>
            <div>
              <p className={labelCls}>Brand *</p>
              <select className={inputCls} value={form.media_brand_id} onChange={e => setForm(f => ({ ...f, media_brand_id: e.target.value }))}>
                <option value="">— pick brand —</option>
                {brands.filter(b => b.brand_type === "news_media").map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Source name</p>
              <input className={inputCls} value={form.source_name} onChange={e => setForm(f => ({ ...f, source_name: e.target.value }))} placeholder="ABC7 / X post / tip" />
            </div>
            <div>
              <p className={labelCls}>Source URL</p>
              <input className={inputCls} value={form.source_url} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))} placeholder="https://…" />
            </div>
            <div>
              <p className={labelCls}>Category</p>
              <input className={inputCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="hip-hop / local / celebrity…" />
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={addItem}
            className="mt-4 rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add to Desk"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          The desk is clear. Add a story manually or register RSS sources — the ingest cron fills this automatically.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const brand = brands.find(b => b.id === item.media_brand_id);
            const autoOn = !!brand?.auto_publish;
            const isHigh = item.sensitivity_level === "high";
            return (
            <div key={item.id} className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">{item.headline}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {brandName(item.media_brand_id)}
                    {item.category ? ` · ${item.category}` : ""}
                    {item.source_name ? ` · ${item.source_name}` : ""}
                    {item.source_url && (
                      <> · <a href={item.source_url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">source ↗</a></>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {autoOn && !isHigh && (
                    <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                      auto
                    </span>
                  )}
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sensChip(item.sensitivity_level)}`}>
                    {item.sensitivity_level} sensitivity
                  </span>
                </div>
              </div>

              {item.status === "needs_review" && item.review_note && (
                <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
                  Auto-pilot returned this: {item.review_note}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={item.verification_status}
                  onChange={e => patchItem(item.id, { verification_status: e.target.value as VerificationStatus })}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                >
                  <option value="unverified">unverified</option>
                  <option value="single_source">single source</option>
                  <option value="multi_source">multi source</option>
                  <option value="official_source">official source</option>
                  <option value="rejected">rejected</option>
                </select>
                {isHigh && item.status !== "approved" && (
                  <button
                    type="button"
                    onClick={() => patchItem(item.id, { status: "approved" })}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/20"
                  >
                    Approve high-sensitivity
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => patchItem(item.id, { status: "rejected" })}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-slate-700"
                >
                  Dismiss
                </button>

                <button
                  type="button"
                  disabled={busyId === item.id || (isHigh && item.status !== "approved")}
                  onClick={() => prepManual(item)}
                  title="Build image + silent Reel, then post by hand in the app with a trending song"
                  className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40"
                >
                  {busyId === item.id ? "Prepping…" : "🎵 Music post"}
                </button>

                {autoOn && !isHigh ? (
                  // Single gate: approval hands off to the auto-pilot cron.
                  <button
                    type="button"
                    onClick={async () => {
                      await patchItem(item.id, { status: "approved" });
                      setNotice(`Approved — auto-pilot will generate, schedule (spacing-applied), and publish "${item.headline.slice(0, 50)}…". No further action needed.`);
                    }}
                    className="ml-auto rounded-lg bg-emerald-500/90 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Approve & Auto-Publish →
                  </button>
                ) : (
                  // Manual path: brands with auto-publish off, or high-sensitivity items.
                  <button
                    type="button"
                    disabled={busyId === item.id || (isHigh && item.status !== "approved")}
                    onClick={() => generatePackage(item)}
                    className="ml-auto rounded-lg bg-fuchsia-500/90 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
                  >
                    {busyId === item.id ? "Generating…" : isHigh ? "Generate (manual) →" : "Generate Package →"}
                  </button>
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
