"use client";

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// References panel for one Reel: auto-find/regenerate a licensed reference pack,
// preview the discovered assets with their source + license status, lock the
// owner's selection, and remove bad references. Collapsed by default and loads
// lazily on first expand so a long pipeline list stays cheap.

type Asset = {
  id: number;
  source_provider: string;
  source_url: string;
  thumbnail_url: string | null;
  asset_type: "image" | "video";
  license_type: string | null;
  creator_name: string | null;
  source_domain: string | null;
  direct_use_allowed: boolean;
  reference_only: boolean;
  needs_review: boolean;
};

type Pack = {
  id: number;
  topic: string | null;
  generated_search_queries: string[];
  color_palette: string[];
  lighting_summary: string | null;
  camera_summary: string | null;
  environment_summary: string | null;
  texture_notes: string | null;
  realism_notes: string | null;
  hero_asset_id: number | null;
  locked: boolean;
  status: string;
};

type Providers = { pexels: boolean; web: "serpapi" | "google_cse" | null };

const PROVIDER_LABEL: Record<string, string> = {
  pexels: "Pexels", pexels_video: "Pexels video", google_cse: "Google", serpapi: "Web",
};

function licenseChip(a: Asset): { label: string; cls: string } {
  if (a.direct_use_allowed) return { label: "Direct use OK", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  if (a.needs_review) return { label: "Needs review", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
  return { label: "Reference only", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" };
}

export default function ReelReferences({ reelId }: { reelId: number }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pack, setPack] = useState<Pack | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/references/pack?reel_id=${reelId}`);
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to load references.");
      setPack(data.pack);
      setAssets(data.assets ?? []);
      setProviders(data.providers ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [reelId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  }

  async function discover() {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch("/api/references/discover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_id: reelId }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Discovery failed.");
      setPack(data.pack);
      setAssets(data.assets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    if (!pack) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch("/api/references/lock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_id: reelId, locked: !pack.locked }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Lock failed.");
      setPack(data.pack);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(assetId: number) {
    setAssets(prev => prev.filter(a => a.id !== assetId)); // optimistic
    try {
      await apiFetch("/api/references/asset/remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: assetId }),
      });
    } catch { /* best-effort; refresh will reconcile */ }
  }

  const directCount = assets.filter(a => a.direct_use_allowed).length;
  const noProviders = providers && !providers.pexels && providers.web === null;

  return (
    <div className="mt-2 rounded-lg border border-slate-700/60 bg-slate-950/40">
      <button type="button" onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:text-slate-100">
        <span>References{assets.length > 0 ? ` · ${assets.length} (${directCount} direct-use)` : ""}{pack?.locked ? " · 🔒 locked" : ""}</span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800/60 px-3 py-2.5">
          {!loaded ? (
            <div className="h-12 animate-pulse rounded-lg bg-slate-800/50" />
          ) : (
            <>
              {noProviders && (
                <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                  No reference providers configured. Add <code>PEXELS_API_KEY</code> (photos + video) and/or{" "}
                  <code>SERPAPI_KEY</code> or <code>GOOGLE_CSE_KEY</code> + <code>GOOGLE_CSE_CX</code> in Vercel to enable auto-discovery.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={discover} disabled={busy}
                  className="rounded-lg bg-fuchsia-500/90 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50">
                  {busy ? "Searching…" : assets.length > 0 ? "Regenerate references" : "Auto-find references"}
                </button>
                {pack && (
                  <button type="button" onClick={toggleLock} disabled={busy}
                    className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50">
                    {pack.locked ? "Unlock pack" : "Lock selected"}
                  </button>
                )}
                {pack?.topic && <span className="text-[11px] text-slate-500">topic: {pack.topic}</span>}
              </div>

              {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}

              {/* Pack guidance summary */}
              {pack && pack.status === "ready" && (
                <div className="mt-2.5 space-y-1 text-[11px] text-slate-400">
                  {pack.color_palette?.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">palette</span>
                      {pack.color_palette.map((c, i) => (
                        <span key={i} title={c} className="h-3.5 w-3.5 rounded-sm border border-slate-700" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  )}
                  {pack.lighting_summary && <p><span className="text-slate-500">lighting:</span> {pack.lighting_summary}</p>}
                  {pack.camera_summary && <p><span className="text-slate-500">camera:</span> {pack.camera_summary}</p>}
                  {pack.environment_summary && <p><span className="text-slate-500">environment:</span> {pack.environment_summary}</p>}
                  {pack.realism_notes && <p><span className="text-slate-500">realism:</span> {pack.realism_notes}</p>}
                </div>
              )}

              {pack && pack.status === "empty" && (
                <p className="mt-2 text-[11px] text-slate-400">{pack.realism_notes ?? "No references found for this topic."}</p>
              )}

              {/* Asset grid */}
              {assets.length > 0 && (
                <div className="mt-2.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {assets.map(a => {
                    const chip = licenseChip(a);
                    return (
                      <div key={a.id} className={`group relative overflow-hidden rounded-md border ${a.id === pack?.hero_asset_id ? "border-emerald-400 ring-1 ring-emerald-400/50" : "border-slate-700/60"}`}>
                        {a.thumbnail_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={a.thumbnail_url} alt="" className="aspect-[2/3] w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="aspect-[2/3] w-full bg-slate-800" />
                        )}
                        {a.asset_type === "video" && (
                          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-white">▶ video</span>
                        )}
                        {a.id === pack?.hero_asset_id && (
                          <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1 text-[9px] font-semibold text-white">hero</span>
                        )}
                        <button type="button" onClick={() => remove(a.id)} title="Remove reference"
                          className="absolute right-1 bottom-1 hidden rounded bg-black/70 px-1 text-[10px] text-rose-300 group-hover:block">✕</button>
                        <div className="px-1 py-0.5">
                          <span className={`block truncate rounded border px-1 text-[9px] ${chip.cls}`}>{chip.label}</span>
                          <a href={a.source_url} target="_blank" rel="noreferrer" className="block truncate text-[9px] text-slate-500 hover:text-slate-300">
                            {PROVIDER_LABEL[a.source_provider] ?? a.source_provider}{a.creator_name ? ` · ${a.creator_name}` : ""}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="mt-2 text-[9px] text-slate-500">
                References inform lighting, composition, environment & mood. Only “Direct use OK” (license-clear) assets may be composited; reference-only assets are never reposted.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
