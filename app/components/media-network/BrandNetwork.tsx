"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { MediaBrand, BrandType } from "@/lib/media-network/types";
import { NEWS_SUB_NICHES, CLIP_SUB_NICHES } from "@/lib/media-network/types";

// Brand Network: create and manage media brands. Compact by design — the
// create form is hidden behind one button; cards stay scannable.

type Account = { id: number; account_name: string };

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";
const labelCls = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

export default function BrandNetwork() {
  const [brands, setBrands] = useState<MediaBrand[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    brand_name: "",
    brand_type: "news_media" as BrandType,
    instagram_handle: "",
    connected_account_id: "",
    niche: "",
    sub_niche: "",
    city_or_region: "",
    content_format_preference: "mixed",
    risk_level: "medium",
  });

  const refresh = useCallback(async () => {
    try {
      const [brandsRes, accountsRes] = await Promise.all([
        apiFetch("/api/media-network/brands"),
        apiFetch("/api/reels/settings"),
      ]);
      const brandsData = await brandsRes.json();
      const accountsData = await accountsRes.json();
      if (!brandsRes.ok || brandsData.success === false) throw new Error(brandsData.error || "Failed to load brands.");
      setBrands(brandsData.brands as MediaBrand[]);
      if (accountsRes.ok && accountsData.success !== false) {
        setAccounts((accountsData.accounts as Account[]).map(a => ({ id: a.id, account_name: a.account_name })));
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createBrand() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/media-network/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          connected_account_id: form.connected_account_id ? Number(form.connected_account_id) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to create brand.");
      setShowForm(false);
      setForm(f => ({ ...f, brand_name: "", instagram_handle: "", niche: "", sub_niche: "", city_or_region: "" }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function patchBrand(id: number, patch: Record<string, unknown>) {
    const res = await apiFetch("/api/media-network/brands", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) setError(data.error || "Update failed.");
    await refresh();
  }

  const subNiches = form.brand_type === "news_media" ? NEWS_SUB_NICHES : CLIP_SUB_NICHES;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{brands.length} brand{brands.length === 1 ? "" : "s"}</p>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          {showForm ? "Close" : "+ New Brand"}
        </button>
      </div>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

      {showForm && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className={labelCls}>Brand name *</p>
              <input className={inputCls} value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} placeholder="LA Street Report" />
            </div>
            <div>
              <p className={labelCls}>Type *</p>
              <select className={inputCls} value={form.brand_type} onChange={e => setForm(f => ({ ...f, brand_type: e.target.value as BrandType, sub_niche: "" }))}>
                <option value="news_media">News / Media</option>
                <option value="streamer_clips">Streamer Clips</option>
              </select>
            </div>
            <div>
              <p className={labelCls}>IG handle</p>
              <input className={inputCls} value={form.instagram_handle} onChange={e => setForm(f => ({ ...f, instagram_handle: e.target.value }))} placeholder="@handle" />
            </div>
            <div>
              <p className={labelCls}>Connected account</p>
              <select className={inputCls} value={form.connected_account_id} onChange={e => setForm(f => ({ ...f, connected_account_id: e.target.value }))}>
                <option value="">— connect later —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Sub-niche</p>
              <select className={inputCls} value={form.sub_niche} onChange={e => setForm(f => ({ ...f, sub_niche: e.target.value }))}>
                <option value="">— pick —</option>
                {subNiches.map(n => <option key={n} value={n}>{n.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>City / region</p>
              <input className={inputCls} value={form.city_or_region} onChange={e => setForm(f => ({ ...f, city_or_region: e.target.value }))} placeholder="Los Angeles" />
            </div>
            <div>
              <p className={labelCls}>Niche (free text)</p>
              <input className={inputCls} value={form.niche} onChange={e => setForm(f => ({ ...f, niche: e.target.value }))} placeholder="LA street culture & hip-hop news" />
            </div>
            <div>
              <p className={labelCls}>Format</p>
              <select className={inputCls} value={form.content_format_preference} onChange={e => setForm(f => ({ ...f, content_format_preference: e.target.value }))}>
                <option value="mixed">Mixed</option>
                <option value="reels">Reels</option>
                <option value="carousel">Carousels</option>
                <option value="image">Images</option>
              </select>
            </div>
            <div>
              <p className={labelCls}>Risk level</p>
              <select className={inputCls} value={form.risk_level} onChange={e => setForm(f => ({ ...f, risk_level: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={createBrand}
            className="mt-4 rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create Brand"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : brands.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          No brands yet — create your first News or Clips brand above.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {brands.map(brand => (
            <div key={brand.id} className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">{brand.brand_name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {brand.instagram_handle || "no handle"} · {brand.brand_type === "news_media" ? "News" : "Clips"}
                    {brand.sub_niche ? ` · ${brand.sub_niche.replace(/_/g, " ")}` : ""}
                    {brand.city_or_region ? ` · ${brand.city_or_region}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                  brand.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : brand.status === "paused" ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-slate-600 bg-slate-800 text-slate-400"
                }`}>
                  {brand.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                <span>{brand.content_format_preference}</span>
                <span>·</span>
                <span>{brand.posting_frequency_goal}/day goal</span>
                <span>·</span>
                <span>risk {brand.risk_level}</span>
                <span className="ml-auto">
                  <button
                    type="button"
                    onClick={() => patchBrand(brand.id, { status: brand.status === "active" ? "paused" : "active" })}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 font-medium text-slate-300 transition hover:bg-slate-700"
                  >
                    {brand.status === "active" ? "Pause" : "Activate"}
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
