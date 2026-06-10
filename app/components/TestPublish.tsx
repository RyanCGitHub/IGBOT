"use client";

import { useState, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ImageAnalysis } from "@/app/api/instagram/analyze/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalyzeResult = {
  analysis: ImageAnalysis;
  caption: string;
  debug: { model: string; imageSentToAI: boolean; imageSizeBytes: number; mediaType: string };
};

type NormalizationMeta = {
  originalWidth: number;
  originalHeight: number;
  originalAspectRatio: string;
  finalWidth: number;
  finalHeight: number;
  finalAspectRatio: string;
  wasResized: boolean;
  wasCropped: boolean;
  wasPadded: boolean;
  wasConverted: boolean;
  originalFormat: string;
  finalFormat: string;
  targetShape: "portrait_4_5" | "landscape_1_91" | "preserved";
};

type UploadResult = {
  imageUrl: string;
  path: string;
  normalization: NormalizationMeta;
};

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortType(mime: string): string {
  return mime.replace("image/", "").toUpperCase();
}

function shapeLabel(shape: NormalizationMeta["targetShape"]): string {
  if (shape === "portrait_4_5") return "Portrait (4:5)";
  if (shape === "landscape_1_91") return "Landscape (1.91:1)";
  return "Preserved";
}

const LOG_ICON: Record<LogEntry["status"], string> = { success: "✓", error: "✗", info: "·" };
const LOG_COLOR: Record<LogEntry["status"], string> = {
  success: "text-emerald-400",
  error: "text-rose-400",
  info: "text-slate-400",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasExpandable = entry.request?.body !== undefined || entry.response?.body !== undefined;

  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => hasExpandable && setExpanded(e => !e)}
        className={`flex w-full items-start gap-2 text-left ${hasExpandable ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={`mt-px shrink-0 font-bold ${LOG_COLOR[entry.status]}`}>{LOG_ICON[entry.status]}</span>
        <span className="text-slate-300">{entry.detail}</span>
        <span className="ml-auto shrink-0 text-slate-600">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        {hasExpandable && <span className="shrink-0 text-slate-600">{expanded ? "▲" : "▼"}</span>}
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-1 rounded-xl bg-slate-950/60 p-3 ring-1 ring-white/5">
          {entry.request?.body !== undefined && (
            <div>
              <span className="text-slate-500">Request:</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-300">
                {JSON.stringify(entry.request.body, null, 2)}
              </pre>
            </div>
          )}
          {entry.response?.body !== undefined && (
            <div>
              <span className="text-slate-500">Response ({entry.response.status}):</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-300">
                {JSON.stringify(entry.response.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PublishLog({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) return null;
  return (
    <div className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Instagram API Log</p>
      <div className="space-y-2">
        {logs.map((entry, i) => <LogRow key={i} entry={entry} />)}
      </div>
    </div>
  );
}

// Shows the processed image side-by-side with transformation summary
function InstagramPreview({
  processedUrl,
  meta,
}: {
  processedUrl: string;
  meta: NormalizationMeta;
}) {
  const changed = meta.wasResized || meta.wasCropped || meta.wasPadded || meta.wasConverted;
  const tags: string[] = [];
  if (meta.wasCropped) tags.push("cropped");
  if (meta.wasPadded) tags.push("blurred pad");
  if (meta.wasResized && !meta.wasCropped && !meta.wasPadded) tags.push("resized");
  if (meta.wasConverted) tags.push("PNG → JPEG");

  return (
    <div className="rounded-3xl border border-fuchsia-500/20 bg-slate-950/60 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-400">
        Ready for Instagram
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Processed image preview */}
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={processedUrl}
            alt="Processed for Instagram"
            className="h-40 w-auto rounded-2xl object-contain ring-1 ring-fuchsia-400/20"
          />
        </div>
        {/* Transformation summary */}
        <div className="min-w-0 flex-1 font-mono text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-300">
            <span className="text-slate-500">original</span>
            <span>{meta.originalWidth} × {meta.originalHeight} ({meta.originalAspectRatio})</span>
            <span className="text-slate-500">output</span>
            <span>{meta.finalWidth} × {meta.finalHeight} ({meta.finalAspectRatio})</span>
            <span className="text-slate-500">shape</span>
            <span>{shapeLabel(meta.targetShape)}</span>
            <span className="text-slate-500">format</span>
            <span>
              {meta.wasConverted
                ? `${shortType(meta.originalFormat)} → ${shortType(meta.finalFormat)}`
                : shortType(meta.finalFormat)}
            </span>
          </div>
          {changed && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map(t => (
                <span key={t} className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300 ring-1 ring-fuchsia-400/20">
                  {t}
                </span>
              ))}
            </div>
          )}
          {!changed && (
            <p className="mt-2 text-slate-500">No transformation — already Instagram-safe.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DebugPanel({
  file,
  analyzeResult,
  uploadResult,
}: {
  file: File | null;
  analyzeResult: AnalyzeResult | null;
  uploadResult: UploadResult | null;
}) {
  const [open, setOpen] = useState(false);

  // Auto-open when analysis result arrives
  const prevAnalysisRef = useRef<AnalyzeResult | null>(null);
  if (analyzeResult && analyzeResult !== prevAnalysisRef.current) {
    prevAnalysisRef.current = analyzeResult;
    if (!open) setOpen(true);
  }

  return (
    <div className="rounded-3xl bg-slate-950/60 ring-1 ring-white/5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300"
      >
        <span>Debug / Dev Panel</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-white/5 px-5 py-4 font-mono text-xs">

          {/* File info */}
          <section>
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">Selected File</p>
            {file ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>name: <span className="text-slate-200">{file.name}</span></p>
                <p>type: <span className="text-slate-200">{file.type}</span></p>
                <p>size: <span className="text-slate-200">{formatBytes(file.size)}</span></p>
              </div>
            ) : (
              <p className="mt-1 text-slate-600">No file selected</p>
            )}
          </section>

          {/* Normalization */}
          <section className="mt-4">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">Image Normalization</p>
            {uploadResult ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>originalDimensions: <span className="text-slate-200">{uploadResult.normalization.originalWidth} × {uploadResult.normalization.originalHeight}</span></p>
                <p>originalAspectRatio: <span className="text-slate-200">{uploadResult.normalization.originalAspectRatio}</span></p>
                <p>finalDimensions: <span className="text-slate-200">{uploadResult.normalization.finalWidth} × {uploadResult.normalization.finalHeight}</span></p>
                <p>finalAspectRatio: <span className="text-slate-200">{uploadResult.normalization.finalAspectRatio}</span></p>
                <p>targetShape: <span className="text-slate-200">{uploadResult.normalization.targetShape}</span></p>
                <p>wasResized: <span className={uploadResult.normalization.wasResized ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasResized)}</span></p>
                <p>wasCropped: <span className={uploadResult.normalization.wasCropped ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasCropped)}</span></p>
                <p>wasPadded: <span className={uploadResult.normalization.wasPadded ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasPadded)}</span></p>
                <p>wasConverted: <span className={uploadResult.normalization.wasConverted ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasConverted)}</span>
                  {uploadResult.normalization.wasConverted && <span className="text-slate-500"> (PNG → JPEG via sharp)</span>}
                </p>
                <p>originalFormat: <span className="text-slate-200">{uploadResult.normalization.originalFormat}</span></p>
                <p>finalFormat: <span className="text-slate-200">{uploadResult.normalization.finalFormat}</span></p>
              </div>
            ) : (
              <p className="mt-1 text-slate-600">Not yet uploaded — click &ldquo;Upload & Publish&rdquo;</p>
            )}
          </section>

          {/* AI analysis */}
          <section className="mt-4">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">AI Analysis</p>
            {analyzeResult ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>imageSentToAI: <span className="text-emerald-400">true</span></p>
                <p>model: <span className="text-slate-200">{analyzeResult.debug.model}</span></p>
                <p>mediaType: <span className="text-slate-200">{analyzeResult.debug.mediaType}</span></p>
                <p>imageSize: <span className="text-slate-200">{formatBytes(analyzeResult.debug.imageSizeBytes)}</span></p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-fuchsia-400">analysis JSON (click to expand)</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-300">
                    {JSON.stringify(analyzeResult.analysis, null, 2)}
                  </pre>
                </details>
                <details className="mt-1">
                  <summary className="cursor-pointer text-fuchsia-400">generated caption (click to expand)</summary>
                  <pre className="mt-1 whitespace-pre-wrap text-slate-300">{analyzeResult.caption}</pre>
                </details>
              </div>
            ) : (
              <p className="mt-1 text-slate-600">Not yet analyzed — click &ldquo;Generate AI Caption&rdquo;</p>
            )}
          </section>

        </div>
      )}
    </div>
  );
}

// ─── TestPublish ──────────────────────────────────────────────────────────────

export default function TestPublish() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null);
  const [caption, setCaption]           = useState("");

  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]     = useState(false);
  const [analyzeError, setAnalyzeError]   = useState<string | null>(null);

  const [uploadResult, setUploadResult]   = useState<UploadResult | null>(null);
  const [outcome, setOutcome]             = useState<PublishOutcome>({ phase: "idle" });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAnalyzeResult(null);
    setAnalyzeError(null);
    setUploadResult(null);
    setOutcome({ phase: "idle" });

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, [previewUrl]);

  async function handleGenerateCaption() {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);

      const res = await apiFetch("/api/instagram/analyze", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.error ?? "Image analysis failed.");

      const result = data as AnalyzeResult & { success: true };
      setAnalyzeResult(result);
      setCaption(result.caption);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handlePublish() {
    if (!selectedFile || !caption.trim()) return;

    // Step 1: upload + normalize (PNG→JPEG, crop/pad, resize)
    setOutcome({ phase: "uploading" });
    const fd = new FormData();
    fd.append("file", selectedFile);

    let uploadData: UploadResult;
    try {
      const res = await apiFetch("/api/instagram/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setOutcome({ phase: "error", error: data.error ?? "Upload failed." });
        return;
      }
      uploadData = { imageUrl: data.imageUrl as string, path: data.path as string, normalization: data.normalization as NormalizationMeta };
      setUploadResult(uploadData);
    } catch (e) {
      setOutcome({ phase: "error", error: e instanceof Error ? e.message : "Upload failed." });
      return;
    }

    // Step 2: publish via Instagram Graph API
    setOutcome({ phase: "publishing" });
    try {
      const res = await apiFetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: uploadData.imageUrl, image_storage_path: uploadData.path, caption }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setOutcome({ phase: "error", error: data.error ?? "Publish failed.", logs: data.logs });
        return;
      }

      setOutcome({
        phase: "success",
        mediaId: data.mediaId as string,
        permalink: data.permalink as string | undefined,
        jobId: data.jobId as number | undefined,
        logs: data.logs as LogEntry[],
      });
    } catch (e) {
      setOutcome({ phase: "error", error: e instanceof Error ? e.message : "Publish failed." });
    }
  }

  const isWorking  = outcome.phase === "uploading" || outcome.phase === "publishing";
  const canAnalyze = !!selectedFile && !isAnalyzing && !isWorking;
  const canPublish = !!selectedFile && !!caption.trim() && !isWorking;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Test Publish</h2>
          <p className="mt-1 text-sm text-slate-400">
            Upload a JPG or PNG — AI analyzes the image, normalizes it for Instagram, then publishes.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          Vision + Graph API
        </span>
      </div>

      {/* Upload + Caption grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">

        {/* Image upload */}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">
            Image <span className="text-slate-500">(JPG / JPEG / PNG · max 8 MB)</span>
          </p>

          {previewUrl && selectedFile ? (
            <div className="space-y-2">
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
                {analyzeResult && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-emerald-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/20">
                    ✓ Analyzed by AI
                  </span>
                )}
                {outcome.phase === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/60">
                    <span className="flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-xs text-slate-200">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Normalizing…
                    </span>
                  </div>
                )}
              </div>
              <p className="font-mono text-xs text-slate-500">
                {selectedFile.name} · {shortType(selectedFile.type)} · {formatBytes(selectedFile.size)}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-48 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 text-slate-500 transition hover:border-fuchsia-500/60 hover:text-slate-300"
            >
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="mt-2 text-sm">Click to select image</span>
              <span className="mt-1 text-xs text-slate-600">JPG · JPEG · PNG</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png"
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
            placeholder={selectedFile ? "Click \"Generate AI Caption\" or write your own…" : "Select an image first…"}
            rows={6}
            className="w-full resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateCaption}
              disabled={!canAnalyze}
              className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              title={!selectedFile ? "Select an image first" : ""}
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Analyzing image…
                </span>
              ) : (
                "Generate AI Caption"
              )}
            </button>
            {analyzeResult && !isAnalyzing && (
              <span className="text-xs text-emerald-400">✓ Image analyzed</span>
            )}
          </div>

          {analyzeError && (
            <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {analyzeError}
            </p>
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
              {outcome.phase === "uploading" ? "Processing & uploading image…" : "Publishing to Instagram… (up to 60s)"}
            </span>
          ) : (
            "Upload & Publish to Instagram"
          )}
        </button>
        {!selectedFile && (
          <p className="mt-2 text-xs text-slate-600">Select an image and enter a caption to publish.</p>
        )}
      </div>

      {/* Instagram preview — shown once the upload step completes */}
      {uploadResult && (
        <div className="mt-6">
          <InstagramPreview
            processedUrl={uploadResult.imageUrl}
            meta={uploadResult.normalization}
          />
        </div>
      )}

      {/* Debug panel */}
      <div className="mt-6">
        <DebugPanel file={selectedFile} analyzeResult={analyzeResult} uploadResult={uploadResult} />
      </div>

      {/* Outcome */}
      {outcome.phase === "success" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-300">Published successfully!</p>
            <p className="mt-1 font-mono text-xs text-emerald-200/70">Media ID: {outcome.mediaId}</p>
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
              <p className="mt-1 font-mono text-xs text-slate-500">Job ID: {outcome.jobId}</p>
            )}
          </div>
          <PublishLog logs={outcome.logs} />
        </div>
      )}

      {outcome.phase === "error" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-sm font-semibold text-rose-300">Failed</p>
            <p className="mt-1 text-sm text-rose-200">{outcome.error}</p>
            {(outcome.error.toLowerCase().includes("permission") || outcome.error.toLowerCase().includes("scope")) && (
              <p className="mt-2 text-xs text-slate-400">
                Tip: The stored token may be missing publishing permissions. Re-connect your Instagram account.
              </p>
            )}
          </div>
          {outcome.logs && <PublishLog logs={outcome.logs} />}
        </div>
      )}
    </section>
  );
}
