"use client";

import { useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Types matching what the API returns
type LogEntry = {
  step: string;
  status: "success" | "error" | "info";
  detail: string;
  request?: { url: string; method?: string; body?: unknown };
  response?: { status: number; body: unknown };
  timestamp: string;
};

type PublishOutcome =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "publishing" }
  | { phase: "success"; mediaId: string; permalink?: string; jobId?: number; logs: LogEntry[] }
  | { phase: "error"; error: string; logs?: LogEntry[] };

const STATUS_ICON: Record<LogEntry["status"], string> = {
  success: "✓",
  error: "✗",
  info: "·",
};
const STATUS_COLOR: Record<LogEntry["status"], string> = {
  success: "text-emerald-400",
  error: "text-rose-400",
  info: "text-slate-400",
};

// ─── LogRow ───────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = entry.request?.body !== undefined || entry.response?.body !== undefined;

  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded(e => !e)}
        className={`flex w-full items-start gap-2 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={`mt-px shrink-0 font-bold ${STATUS_COLOR[entry.status]}`}>
          {STATUS_ICON[entry.status]}
        </span>
        <span className="text-slate-300">{entry.detail}</span>
        <span className="ml-auto shrink-0 text-slate-600">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        {hasDetail && (
          <span className="shrink-0 text-slate-600">{expanded ? "▲" : "▼"}</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-1 rounded-xl bg-slate-950/60 p-3 ring-1 ring-white/5">
          {entry.request?.body !== undefined && (
            <div>
              <span className="text-slate-500">Request body:</span>
              <pre className="mt-1 overflow-x-auto text-slate-300">
                {JSON.stringify(entry.request.body, null, 2)}
              </pre>
            </div>
          )}
          {entry.response?.body !== undefined && (
            <div>
              <span className="text-slate-500">
                Response ({entry.response.status}):
              </span>
              <pre className="mt-1 overflow-x-auto text-slate-300">
                {JSON.stringify(entry.response.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TestPublish ──────────────────────────────────────────────────────────────

export default function TestPublish() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome>({ phase: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setOutcome({ phase: "idle" });
  }, [previewUrl]);

  async function handleGenerateCaption() {
    if (!caption.trim() && !selectedFile) {
      setCaptionError("Enter a prompt or select an image first.");
      return;
    }
    setCaptionError(null);
    setIsGeneratingCaption(true);
    try {
      const prompt = caption.trim() || "Write an engaging Instagram caption for this photo.";
      const res = await apiFetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to generate caption.");
      setCaption(typeof data.caption === "string" ? data.caption : "");
    } catch (e) {
      setCaptionError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGeneratingCaption(false);
    }
  }

  async function handlePublish() {
    if (!selectedFile) return;
    if (!caption.trim()) return;

    // Step 1: upload image
    setOutcome({ phase: "uploading" });
    const formData = new FormData();
    formData.append("file", selectedFile);

    let imageUrl: string;
    let imagePath: string;
    try {
      const uploadRes = await apiFetch("/api/instagram/upload", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.success) {
        setOutcome({ phase: "error", error: uploadData.error ?? "Upload failed." });
        return;
      }
      imageUrl = uploadData.imageUrl as string;
      imagePath = uploadData.path as string;
    } catch (e) {
      setOutcome({ phase: "error", error: e instanceof Error ? e.message : "Upload failed." });
      return;
    }

    // Step 2: publish via IG Graph API
    setOutcome({ phase: "publishing" });
    try {
      const publishRes = await apiFetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, image_storage_path: imagePath, caption }),
      });
      const publishData = await publishRes.json();

      if (!publishRes.ok || !publishData.success) {
        setOutcome({
          phase: "error",
          error: publishData.error ?? "Publish failed.",
          logs: publishData.logs as LogEntry[] | undefined,
        });
        return;
      }

      setOutcome({
        phase: "success",
        mediaId: publishData.mediaId as string,
        permalink: publishData.permalink as string | undefined,
        jobId: publishData.jobId as number | undefined,
        logs: publishData.logs as LogEntry[],
      });
    } catch (e) {
      setOutcome({ phase: "error", error: e instanceof Error ? e.message : "Publish failed." });
    }
  }

  const isWorking = outcome.phase === "uploading" || outcome.phase === "publishing";
  const canPublish = !!selectedFile && !!caption.trim() && !isWorking;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Test Publish</h2>
          <p className="mt-1 text-sm text-slate-400">
            Upload a JPEG and publish to Instagram. Full API log shown below.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          Graph API
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Image upload */}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">Image (JPEG only, max 8 MB)</p>
          {previewUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Preview"
                className="h-48 w-full rounded-2xl object-cover ring-1 ring-white/10"
              />
              <button
                type="button"
                onClick={() => handleFileChange(null)}
                className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-rose-600 hover:text-white"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-48 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 text-slate-500 transition hover:border-fuchsia-500/60 hover:text-slate-300"
            >
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16v-4m0 0V8m0 4H8m4 0h4M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5M16 6l-4-4-4 4m4-4v13" />
              </svg>
              <span className="mt-2 text-sm">Click to select JPEG</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg"
            className="hidden"
            onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Caption */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-slate-300">Caption</p>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Write a caption or generate one with AI…"
            rows={5}
            className="w-full resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
          />
          <button
            type="button"
            onClick={handleGenerateCaption}
            disabled={isGeneratingCaption}
            className="self-start rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-wait disabled:opacity-50"
          >
            {isGeneratingCaption ? "Generating…" : "Generate AI Caption"}
          </button>
          {captionError && (
            <p className="text-xs text-rose-400">{captionError}</p>
          )}
        </div>
      </div>

      {/* Publish button */}
      <div className="mt-6">
        <button
          type="button"
          onClick={handlePublish}
          disabled={!canPublish}
          className="rounded-3xl bg-fuchsia-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isWorking ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {outcome.phase === "uploading" ? "Uploading image…" : "Publishing to Instagram… (up to 60s)"}
            </span>
          ) : (
            "Upload & Publish to Instagram"
          )}
        </button>
      </div>

      {/* Outcome */}
      {outcome.phase === "success" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-300">Published successfully!</p>
            <p className="mt-1 text-xs text-emerald-200/70">Media ID: {outcome.mediaId}</p>
            {outcome.permalink && (
              <a
                href={outcome.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-300 underline underline-offset-2"
              >
                View on Instagram ↗
              </a>
            )}
            {outcome.jobId && (
              <p className="mt-1 text-xs text-slate-500">Job ID: {outcome.jobId}</p>
            )}
          </div>
          <PublishLog logs={outcome.logs} />
        </div>
      )}

      {outcome.phase === "error" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-sm font-semibold text-rose-300">Publish failed</p>
            <p className="mt-1 text-sm text-rose-200">{outcome.error}</p>
            {outcome.error.toLowerCase().includes("permission") && (
              <p className="mt-2 text-xs text-slate-400">
                Tip: Re-connect your Instagram account via the Instagram Connection section — the stored token may not have publishing permissions.
              </p>
            )}
          </div>
          {outcome.logs && <PublishLog logs={outcome.logs} />}
        </div>
      )}
    </section>
  );
}

// ─── PublishLog ───────────────────────────────────────────────────────────────

function PublishLog({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) return null;
  return (
    <div className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        API Log
      </p>
      <div className="space-y-2">
        {logs.map((entry, i) => (
          <LogRow key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
