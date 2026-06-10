"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, ConnectedAccount, Campaign } from "@/lib/supabase";

// Full draft completion editor: caption, image, account, campaign, then
// Save / Publish Now / Schedule. All actions update the EXISTING draft row
// (no duplicate posts) and reuse the existing upload / publish / schedule routes.

export default function DraftEditor({
  post,
  accounts,
  campaigns,
  onClose,
  onSaved,
}: {
  post: IgPost;
  accounts: ConnectedAccount[];
  campaigns: Campaign[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [accountId, setAccountId] = useState<number | null>(post.account_id);
  const [campaignId, setCampaignId] = useState<number | null>(post.campaign_id);
  const [imageUrl, setImageUrl] = useState<string | null>(post.image_url);
  const [imagePath, setImagePath] = useState<string | null>(post.image_storage_path);
  const [normalization, setNormalization] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "publish" | "schedule">(null);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState("");
  const [scheduleTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  const hasImage = !!imageUrl;
  const hasAccount = accountId != null;
  const isWorking = isUploading || busy != null;
  const canPublishOrSchedule = hasImage && hasAccount && !isWorking;

  async function handleUpload(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/api/instagram/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Upload failed.");
      setImageUrl(data.imageUrl as string);
      setImagePath(data.path as string);
      setNormalization((data.normalization as Record<string, unknown>) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUploading(false);
    }
  }

  // PATCH the current editor fields onto the existing draft row.
  async function persist(): Promise<boolean> {
    const body: Record<string, unknown> = {
      caption: caption.trim(),
      account_id: accountId,
      campaign_id: campaignId,
      image_url: imageUrl,
      image_storage_path: imagePath,
    };
    if (normalization) body.normalization_meta = normalization;

    const res = await apiFetch(`/api/ig-posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error ?? "Save failed.");
      return false;
    }
    return true;
  }

  async function handleSave() {
    setBusy("save");
    setError(null);
    try {
      if (await persist()) { onSaved(); onClose(); }
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish() {
    if (!canPublishOrSchedule) return;
    setBusy("publish");
    setError(null);
    try {
      if (!(await persist())) return;
      const res = await apiFetch(`/api/ig-posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error ?? "Publish failed."); return; }
      onSaved();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  async function handleSchedule() {
    if (!canPublishOrSchedule || !scheduleInput) return;
    const d = new Date(scheduleInput);
    if (isNaN(d.getTime())) { setError("Please enter a valid date and time."); return; }
    if (d <= new Date()) { setError("Scheduled time must be in the future."); return; }
    setBusy("schedule");
    setError(null);
    try {
      if (!(await persist())) return;
      const res = await apiFetch(`/api/ig-posts/${post.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: d.toISOString(), timezone: scheduleTz }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error ?? "Schedule failed."); return; }
      onSaved();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-fuchsia-500/20 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-fuchsia-300">Edit draft #{post.id}</p>
        <button
          type="button"
          onClick={onClose}
          disabled={isWorking}
          className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
        >
          Close
        </button>
      </div>

      {/* Image */}
      <div>
        <p className="mb-2 text-xs font-medium text-slate-400">Image</p>
        {imageUrl ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Draft" className="h-28 w-28 rounded-xl object-cover ring-1 ring-white/10" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isWorking}
              className="rounded-2xl bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            >
              {isUploading ? "Uploading…" : "Replace image"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isWorking}
            className="flex h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 text-slate-500 transition hover:border-fuchsia-500/60 hover:text-slate-300 disabled:opacity-40"
          >
            {isUploading ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Uploading…
              </span>
            ) : (
              <>
                <span className="text-sm">Click to upload an image</span>
                <span className="mt-1 text-xs text-slate-600">JPG · JPEG · PNG</span>
              </>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
        />
      </div>

      {/* Caption */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-400">Caption</p>
          <span className={`text-xs ${caption.length > 2000 ? "text-rose-400" : "text-slate-600"}`}>{caption.length} / 2200</span>
        </div>
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          rows={5}
          disabled={isWorking}
          className="w-full resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
        />
      </div>

      {/* Account + campaign */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">Instagram account</label>
          {accounts.length > 0 ? (
            <select
              value={accountId ?? ""}
              onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}
              disabled={isWorking}
              className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
            >
              <option value="">Select account…</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>@{a.account_name}</option>
              ))}
            </select>
          ) : (
            <p className="rounded-2xl bg-slate-950/60 px-4 py-2.5 text-xs text-slate-500 ring-1 ring-white/5">
              No connected account.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">Campaign (optional)</label>
          <select
            value={campaignId ?? ""}
            onChange={e => setCampaignId(e.target.value ? Number(e.target.value) : null)}
            disabled={isWorking}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
          >
            <option value="">No campaign</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Gating message */}
      {!hasImage && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Add an image before publishing or scheduling.
        </p>
      )}
      {hasImage && !hasAccount && (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Select an Instagram account before publishing or scheduling.
        </p>
      )}

      {error && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isWorking}
          className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "save" ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={!canPublishOrSchedule}
          className="rounded-3xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {busy === "publish" ? "Publishing…" : "Publish Now"}
        </button>
        <button
          type="button"
          onClick={() => { setShowSchedule(s => !s); setError(null); }}
          disabled={!canPublishOrSchedule}
          className="rounded-3xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-fuchsia-500/50 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "schedule" ? "Scheduling…" : showSchedule ? "Cancel schedule" : "Schedule Post"}
        </button>
      </div>

      {/* Inline schedule picker */}
      {showSchedule && canPublishOrSchedule && (
        <div className="space-y-2 rounded-2xl border border-fuchsia-500/20 bg-slate-900/60 p-3">
          <label className="text-xs text-slate-400">Date &amp; time <span className="text-slate-600">({scheduleTz})</span></label>
          <input
            type="datetime-local"
            value={scheduleInput}
            onChange={e => setScheduleInput(e.target.value)}
            min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            className="w-full rounded-xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 [color-scheme:dark]"
          />
          <button
            type="button"
            onClick={handleSchedule}
            disabled={!scheduleInput || isWorking}
            className="rounded-2xl bg-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-40"
          >
            Confirm Schedule
          </button>
        </div>
      )}
    </div>
  );
}
