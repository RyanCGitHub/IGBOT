"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ContentSource, MediaBrand, SourceType, PermissionStatus } from "@/lib/media-network/types";

// Source Manager: every piece of content traces back to a registered source
// with an explicit permission status. The chips here drive the compliance
// engine — unknown/blocked sources can never reach a published post.

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";
const labelCls = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

function permissionChip(status: PermissionStatus): string {
  switch (status) {
    case "owned":
    case "permissioned":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "user_submitted":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "public_reference_only":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "unknown":
    case "blocked":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }
}

export default function SourceManager() {
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [brands, setBrands] = useState<MediaBrand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    media_brand_id: "",
    source_type: "twitch" as SourceType,
    source_name: "",
    source_url: "",
    creator_or_publisher_name: "",
    platform_handle: "",
    permission_status: "unknown" as PermissionStatus,
    permission_evidence: "",
    allowed_usage_notes: "",
    takedown_contact: "",
  });

  const refresh = useCallback(async () => {
    try {
      const [sourcesRes, brandsRes] = await Promise.all([
        apiFetch("/api/media-network/sources"),
        apiFetch("/api/media-network/brands"),
      ]);
      const sourcesData = await sourcesRes.json();
      const brandsData = await brandsRes.json();
      if (!sourcesRes.ok || sourcesData.success === false) throw new Error(sourcesData.error || "Failed to load sources.");
      setSources(sourcesData.sources as ContentSource[]);
      if (brandsRes.ok && brandsData.success !== false) setBrands(brandsData.brands as MediaBrand[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createSource() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/media-network/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, media_brand_id: Number(form.media_brand_id) }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to create source.");
      setShowForm(false);
      setForm(f => ({ ...f, source_name: "", source_url: "", creator_or_publisher_name: "", platform_handle: "", permission_evidence: "", allowed_usage_notes: "", takedown_contact: "" }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(source: ContentSource) {
    await apiFetch("/api/media-network/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
    });
    await refresh();
  }

  const brandName = (id: number) => brands.find(b => b.id === id)?.brand_name ?? `Brand ${id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {sources.length} source{sources.length === 1 ? "" : "s"} — permission status gates publishing
        </p>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          {showForm ? "Close" : "+ New Source"}
        </button>
      </div>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

      {showForm && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className={labelCls}>Brand *</p>
              <select className={inputCls} value={form.media_brand_id} onChange={e => setForm(f => ({ ...f, media_brand_id: e.target.value }))}>
                <option value="">— pick brand —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Platform *</p>
              <select className={inputCls} value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value as SourceType }))}>
                {["twitch", "kick", "youtube", "instagram", "tiktok", "x", "website", "rss", "manual", "user_submission", "other"].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={labelCls}>Source name *</p>
              <input className={inputCls} value={form.source_name} onChange={e => setForm(f => ({ ...f, source_name: e.target.value }))} placeholder="StreamerName / Outlet" />
            </div>
            <div>
              <p className={labelCls}>Creator / publisher</p>
              <input className={inputCls} value={form.creator_or_publisher_name} onChange={e => setForm(f => ({ ...f, creator_or_publisher_name: e.target.value }))} />
            </div>
            <div>
              <p className={labelCls}>Handle</p>
              <input className={inputCls} value={form.platform_handle} onChange={e => setForm(f => ({ ...f, platform_handle: e.target.value }))} placeholder="@handle" />
            </div>
            <div>
              <p className={labelCls}>URL</p>
              <input className={inputCls} value={form.source_url} onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))} placeholder="https://…" />
            </div>
            <div>
              <p className={labelCls}>Permission status *</p>
              <select className={inputCls} value={form.permission_status} onChange={e => setForm(f => ({ ...f, permission_status: e.target.value as PermissionStatus }))}>
                <option value="owned">owned — safe to publish</option>
                <option value="permissioned">permissioned — safe to publish</option>
                <option value="user_submitted">user submitted — review required</option>
                <option value="public_reference_only">public reference — summarize only</option>
                <option value="unknown">unknown — publishing blocked</option>
                <option value="blocked">blocked — all use blocked</option>
              </select>
            </div>
            <div>
              <p className={labelCls}>Permission evidence (link/DM)</p>
              <input className={inputCls} value={form.permission_evidence} onChange={e => setForm(f => ({ ...f, permission_evidence: e.target.value }))} placeholder="Link to 'clips welcome' post / DM screenshot" />
            </div>
            <div>
              <p className={labelCls}>Takedown contact</p>
              <input className={inputCls} value={form.takedown_contact} onChange={e => setForm(f => ({ ...f, takedown_contact: e.target.value }))} placeholder="email / DM" />
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={createSource}
            className="mt-4 rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add Source"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : sources.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          No sources registered. Every clip and story must trace to a source with a permission status.
        </p>
      ) : (
        <div className="space-y-2">
          {sources.map(source => (
            <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">
                  {source.source_name}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {source.source_type} · {brandName(source.media_brand_id)}
                    {source.platform_handle ? ` · ${source.platform_handle}` : ""}
                  </span>
                </p>
                {source.permission_evidence && (
                  <p className="truncate text-[11px] text-emerald-400/80">evidence: {source.permission_evidence}</p>
                )}
              </div>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${permissionChip(source.permission_status)}`}>
                {source.permission_status.replace(/_/g, " ")}
              </span>
              <button
                type="button"
                onClick={() => toggleActive(source)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                  source.is_active
                    ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "border-slate-700 bg-slate-800/40 text-slate-500 hover:bg-slate-800"
                }`}
              >
                {source.is_active ? "Active" : "Inactive"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
