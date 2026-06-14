"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { supabase } from "@/lib/supabase";
import type { ClipAsset, MediaBrand, ContentSource, ClipRightsStatus } from "@/lib/media-network/types";

// Clip Desk: assisted upload (browser → storage via signed URL — the system
// never downloads from platforms), metadata + rights, then one click
// generates the package. Rights chips mirror the compliance engine.

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";
const labelCls = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

function rightsChip(status: ClipRightsStatus): string {
  switch (status) {
    case "owned":
    case "permissioned":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "fan_page_use":
    case "commentary_only":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "needs_review":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "blocked":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }
}

const BUCKET = "instagram-media";

export default function ClipDesk() {
  const [clips, setClips] = useState<ClipAsset[]>([]);
  const [brands, setBrands] = useState<MediaBrand[]>([]);
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function scanTwitch() {
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/stream-watch", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Scan failed.");
      const s = data.summary;
      if (!s.configured) setError("Twitch isn't configured — add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Vercel.");
      else setNotice(`Scanned ${s.sources_checked} streamer(s), ${s.clips_seen} clips — ${s.candidates_created} new candidate(s) added (ranked by view velocity).`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScanning(false);
    }
  }
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    media_brand_id: "",
    source_id: "",
    clip_title: "",
    original_clip_url: "",
    streamer_name: "",
    streamer_platform: "twitch",
    game_or_category: "",
    clip_moment_type: "funny",
    clip_summary: "",
    transcript: "",
    rights_status: "needs_review" as ClipRightsStatus,
  });

  const refresh = useCallback(async () => {
    try {
      const [clipsRes, brandsRes, sourcesRes] = await Promise.all([
        apiFetch("/api/media-network/clip-assets"),
        apiFetch("/api/media-network/brands"),
        apiFetch("/api/media-network/sources"),
      ]);
      const clipsData = await clipsRes.json();
      const brandsData = await brandsRes.json();
      const sourcesData = await sourcesRes.json();
      if (!clipsRes.ok || clipsData.success === false) throw new Error(clipsData.error || "Failed to load clips.");
      setClips((clipsData.clips as ClipAsset[]).filter(c => c.status !== "used" && c.status !== "rejected"));
      if (brandsRes.ok && brandsData.success !== false) setBrands(brandsData.brands as MediaBrand[]);
      if (sourcesRes.ok && sourcesData.success !== false) setSources(sourcesData.sources as ContentSource[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function addClip() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Pick the clip video file — uploads are how clips enter the system (no platform downloads)."); return; }
    if (!form.media_brand_id) { setError("Pick a brand."); return; }
    if (!form.clip_title.trim()) { setError("Add a clip title."); return; }

    setUploading(true);
    setError(null);
    try {
      // 1) Mint a signed upload URL, 2) browser uploads straight to storage.
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const urlRes = await apiFetch("/api/media-network/clip-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_brand_id: Number(form.media_brand_id), file_ext: ext }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || urlData.success === false) throw new Error(urlData.error || "Could not get upload URL.");

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(urlData.path as string, urlData.token as string, file);
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 3) Read duration locally for the record.
      const duration = await new Promise<number | null>(resolve => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null);
        v.onerror = () => resolve(null);
        v.src = URL.createObjectURL(file);
      });

      // 4) Register the asset.
      const res = await apiFetch("/api/media-network/clip-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          media_brand_id: Number(form.media_brand_id),
          source_id: form.source_id ? Number(form.source_id) : null,
          uploaded_file_url: urlData.publicUrl,
          duration_seconds: duration,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to register clip.");

      setShowForm(false);
      setForm(f => ({ ...f, clip_title: "", original_clip_url: "", clip_summary: "", transcript: "" }));
      if (fileRef.current) fileRef.current.value = "";
      setNotice("Clip uploaded and registered.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
    }
  }

  async function patchClip(id: number, patch: Record<string, unknown>) {
    await apiFetch("/api/media-network/clip-assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    await refresh();
  }

  async function generatePackage(clip: ClipAsset) {
    setBusyId(clip.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch("/api/media-network/generate-clip-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_asset_id: clip.id }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Generation failed.");
      setNotice(`Package created for "${clip.clip_title.slice(0, 50)}" — review it in the Packages tab.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(null);
    }
  }

  const brandName = (id: number) => brands.find(b => b.id === id)?.brand_name ?? `Brand ${id}`;
  const clipBrandSources = sources.filter(s => String(s.media_brand_id) === form.media_brand_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {clips.length} clip{clips.length === 1 ? "" : "s"} in the desk — upload only what you have rights to use
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={scanTwitch}
            disabled={scanning}
            title="Poll Twitch for trending clips from your registered streamers"
            className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "📡 Scan Twitch"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(s => !s)}
            className="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            {showForm ? "Close" : "+ Upload Clip"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

      {showForm && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className={labelCls}>Clip file *</p>
              <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className={`${inputCls} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-xs file:text-slate-200`} />
            </div>
            <div>
              <p className={labelCls}>Brand *</p>
              <select className={inputCls} value={form.media_brand_id} onChange={e => setForm(f => ({ ...f, media_brand_id: e.target.value, source_id: "" }))}>
                <option value="">— pick brand —</option>
                {brands.filter(b => b.brand_type === "streamer_clips").map(b => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Source (registered)</p>
              <select className={inputCls} value={form.source_id} onChange={e => setForm(f => ({ ...f, source_id: e.target.value }))}>
                <option value="">— optional —</option>
                {clipBrandSources.map(s => <option key={s.id} value={s.id}>{s.source_name} ({s.permission_status})</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Clip title *</p>
              <input className={inputCls} value={form.clip_title} onChange={e => setForm(f => ({ ...f, clip_title: e.target.value }))} />
            </div>
            <div>
              <p className={labelCls}>Streamer name</p>
              <input className={inputCls} value={form.streamer_name} onChange={e => setForm(f => ({ ...f, streamer_name: e.target.value }))} />
            </div>
            <div>
              <p className={labelCls}>Platform</p>
              <select className={inputCls} value={form.streamer_platform} onChange={e => setForm(f => ({ ...f, streamer_platform: e.target.value }))}>
                {["twitch", "kick", "youtube", "other"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Moment type</p>
              <select className={inputCls} value={form.clip_moment_type} onChange={e => setForm(f => ({ ...f, clip_moment_type: e.target.value }))}>
                {["funny", "argument", "reaction", "fail", "drama", "challenge", "highlight", "wholesome", "newsworthy"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <p className={labelCls}>Rights status *</p>
              <select className={inputCls} value={form.rights_status} onChange={e => setForm(f => ({ ...f, rights_status: e.target.value as ClipRightsStatus }))}>
                <option value="owned">owned</option>
                <option value="permissioned">permissioned</option>
                <option value="fan_page_use">fan page use (medium risk)</option>
                <option value="commentary_only">commentary only</option>
                <option value="needs_review">needs review (blocks generation)</option>
              </select>
            </div>
            <div>
              <p className={labelCls}>Original clip URL (reference)</p>
              <input className={inputCls} value={form.original_clip_url} onChange={e => setForm(f => ({ ...f, original_clip_url: e.target.value }))} placeholder="https://clips.twitch.tv/…" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <p className={labelCls}>What happens in the clip</p>
              <textarea className={`${inputCls} resize-none`} rows={2} value={form.clip_summary} onChange={e => setForm(f => ({ ...f, clip_summary: e.target.value }))} />
            </div>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={addClip}
            className="mt-4 rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload & Register"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
      ) : clips.length === 0 ? (
        <p className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
          No clips in the desk. Upload a clip you have rights to — Stream Watch (Phase 8) will feed this automatically later.
        </p>
      ) : (
        <div className="space-y-2">
          {clips.map(clip => (
            <div key={clip.id} className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">{clip.clip_title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {clip.streamer_name ?? "unknown streamer"} · {clip.streamer_platform ?? "?"} · {clip.clip_moment_type ?? "?"}
                    {clip.duration_seconds ? ` · ${clip.duration_seconds}s` : ""}
                    {" · "}{brandName(clip.media_brand_id)}
                    {clip.uploaded_file_url && (
                      <> · <a href={clip.uploaded_file_url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">video ↗</a></>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${rightsChip(clip.rights_status)}`}>
                  {clip.rights_status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={clip.rights_status}
                  onChange={e => patchClip(clip.id, { rights_status: e.target.value })}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                >
                  {["owned", "permissioned", "fan_page_use", "commentary_only", "needs_review", "blocked"].map(r => (
                    <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => patchClip(clip.id, { status: "rejected" })}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-slate-700"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busyId === clip.id || clip.rights_status === "needs_review" || clip.rights_status === "blocked"}
                  onClick={() => generatePackage(clip)}
                  className="ml-auto rounded-lg bg-fuchsia-500/90 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-fuchsia-400 disabled:opacity-40"
                >
                  {busyId === clip.id ? "Generating…" : "Generate Package →"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
