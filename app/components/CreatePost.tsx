"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { ImageAnalysis } from "@/app/api/instagram/analyze/route";
import type { CaptionOption, ConnectedAccount, IgPost } from "@/lib/supabase";
import type { NormalizationMeta } from "@/lib/image-normalize";

// ─── Local types ──────────────────────────────────────────────────────────────

type UploadResult = {
  imageUrl: string;
  path: string;
  normalization: NormalizationMeta;
};

type LogEntry = {
  step: string;
  status: "success" | "error" | "info";
  detail: string;
  timestamp: string;
};

type ActionPhase = "idle" | "uploading" | "saving" | "publishing" | "scheduling" | "done_draft" | "done_published" | "done_scheduled" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortType(mime: string): string {
  return mime.replace("image/", "").toUpperCase();
}

function shapeLabel(shape: string): string {
  if (shape === "portrait_4_5") return "Portrait (4:5)";
  if (shape === "landscape_1_91") return "Landscape (1.91:1)";
  return "Preserved";
}

const STYLE_COLORS: Record<string, string> = {
  professional: "border-blue-500/40 ring-blue-500/20",
  casual:       "border-amber-500/40 ring-amber-500/20",
  motivational: "border-emerald-500/40 ring-emerald-500/20",
  cta:          "border-rose-500/40 ring-rose-500/20",
  viral:        "border-fuchsia-500/40 ring-fuchsia-500/20",
};

const STYLE_BADGE: Record<string, string> = {
  professional: "bg-blue-500/15 text-blue-300",
  casual:       "bg-amber-500/15 text-amber-300",
  motivational: "bg-emerald-500/15 text-emerald-300",
  cta:          "bg-rose-500/15 text-rose-300",
  viral:        "bg-fuchsia-500/15 text-fuchsia-300",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CaptionCard({
  option,
  isSelected,
  onSelect,
}: {
  option: CaptionOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const borderClass = isSelected
    ? "border-fuchsia-500/60 ring-fuchsia-500/30 bg-fuchsia-500/5"
    : `border ${STYLE_COLORS[option.style] ?? "border-white/10"} bg-slate-950/60 hover:border-white/20`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-4 text-left ring-1 transition ${borderClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLE_BADGE[option.style] ?? "bg-slate-700 text-slate-300"}`}>
          {option.label}
        </span>
        {isSelected && (
          <span className="text-xs font-semibold text-fuchsia-400">✓ Selected</span>
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-200">{option.caption}</p>
      {option.hashtags && (
        <p className="mt-1 line-clamp-1 text-xs text-slate-500">{option.hashtags}</p>
      )}
    </button>
  );
}

function DebugPanel({
  file,
  analysis,
  analyzeDebug,
  uploadResult,
  publishLogs,
}: {
  file: File | null;
  analysis: ImageAnalysis | null;
  analyzeDebug: { model: string; imageSizeBytes: number; mediaType: string } | null;
  uploadResult: UploadResult | null;
  publishLogs: LogEntry[] | null;
}) {
  const [open, setOpen] = useState(false);
  const prevAnalysis = useRef<ImageAnalysis | null>(null);
  if (analysis && analysis !== prevAnalysis.current) {
    prevAnalysis.current = analysis;
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
        <div className="border-t border-white/5 px-5 py-4 font-mono text-xs space-y-4">

          <section>
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">File</p>
            {file ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>name: <span className="text-slate-200">{file.name}</span></p>
                <p>type: <span className="text-slate-200">{file.type}</span></p>
                <p>size: <span className="text-slate-200">{formatBytes(file.size)}</span></p>
              </div>
            ) : <p className="mt-1 text-slate-600">No file selected</p>}
          </section>

          <section>
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">AI Analysis</p>
            {analysis && analyzeDebug ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>model: <span className="text-slate-200">{analyzeDebug.model}</span></p>
                <p>mediaType: <span className="text-slate-200">{analyzeDebug.mediaType}</span></p>
                <p>imageSize: <span className="text-slate-200">{formatBytes(analyzeDebug.imageSizeBytes)}</span></p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-fuchsia-400">analysis JSON</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-300">{JSON.stringify(analysis, null, 2)}</pre>
                </details>
              </div>
            ) : <p className="mt-1 text-slate-600">Not yet analyzed</p>}
          </section>

          <section>
            <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">Image Normalization</p>
            {uploadResult ? (
              <div className="mt-1 space-y-0.5 text-slate-300">
                <p>original: <span className="text-slate-200">{uploadResult.normalization.originalWidth}×{uploadResult.normalization.originalHeight} ({uploadResult.normalization.originalAspectRatio})</span></p>
                <p>output: <span className="text-slate-200">{uploadResult.normalization.finalWidth}×{uploadResult.normalization.finalHeight} ({uploadResult.normalization.finalAspectRatio})</span></p>
                <p>shape: <span className="text-slate-200">{uploadResult.normalization.targetShape}</span></p>
                <p>cropped: <span className={uploadResult.normalization.wasCropped ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasCropped)}</span></p>
                <p>padded: <span className={uploadResult.normalization.wasPadded ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasPadded)}</span></p>
                <p>converted: <span className={uploadResult.normalization.wasConverted ? "text-amber-400" : "text-slate-400"}>{String(uploadResult.normalization.wasConverted)}</span></p>
                <p>finalFormat: <span className="text-slate-200">{uploadResult.normalization.finalFormat}</span></p>
              </div>
            ) : <p className="mt-1 text-slate-600">Not yet uploaded</p>}
          </section>

          {publishLogs && publishLogs.length > 0 && (
            <section>
              <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-slate-600">Publish Log</p>
              <div className="mt-1 space-y-1 text-slate-300">
                {publishLogs.map((entry, i) => (
                  <p key={i}>
                    <span className={entry.status === "success" ? "text-emerald-400" : entry.status === "error" ? "text-rose-400" : "text-slate-500"}>
                      {entry.status === "success" ? "✓" : entry.status === "error" ? "✗" : "·"}
                    </span>
                    {" "}{entry.detail}
                  </p>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}

// ─── CreatePost ───────────────────────────────────────────────────────────────

export default function CreatePost() {
  // File + preview
  const [file, setFile]           = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileInputRef              = useRef<HTMLInputElement>(null);

  // Analysis
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysis, setAnalysis]         = useState<ImageAnalysis | null>(null);
  const [captionOptions, setCaptionOptions] = useState<CaptionOption[] | null>(null);
  const [analyzeDebug, setAnalyzeDebug] = useState<{ model: string; imageSizeBytes: number; mediaType: string } | null>(null);

  // Caption editing
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [caption, setCaption]         = useState("");

  // Upload result
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Accounts
  const [accounts, setAccounts]           = useState<ConnectedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Save / publish
  const [actionPhase, setActionPhase]         = useState<ActionPhase>("idle");
  const [actionError, setActionError]         = useState<string | null>(null);
  const [savedPost, setSavedPost]             = useState<IgPost | null>(null);
  const [publishedMediaId, setPublishedMediaId] = useState<string | null>(null);
  const [publishedPermalink, setPublishedPermalink] = useState<string | null>(null);
  const [publishLogs, setPublishLogs]         = useState<LogEntry[] | null>(null);
  // Tracks which button triggered the current action — controls which button shows a spinner
  const [pendingAction, setPendingAction]     = useState<"draft" | "publish" | "schedule" | null>(null);
  // Ref guard prevents double-submission before React re-renders
  const isSubmittingRef                       = useRef(false);

  // Scheduling
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleInput, setScheduleInput]           = useState("");
  const [scheduleTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [scheduleError, setScheduleError]           = useState<string | null>(null);

  // Load accounts on mount
  useEffect(() => {
    apiFetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const list = d.accounts as ConnectedAccount[];
          setAccounts(list);
          if (list.length > 0) setSelectedAccountId(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleFileChange = useCallback((f: File | null) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setAnalysis(null);
    setCaptionOptions(null);
    setAnalyzeError(null);
    setAnalyzeDebug(null);
    setSelectedIdx(null);
    setCaption("");
    setUploadResult(null);
    setActionPhase("idle");
    setActionError(null);
    setSavedPost(null);
    setPublishedMediaId(null);
    setPublishedPermalink(null);
    setPublishLogs(null);
    setShowSchedulePicker(false);
    setScheduleInput("");
    setScheduleError(null);
    setPendingAction(null);
    isSubmittingRef.current = false;

    if (!f) { setFile(null); setLocalPreview(null); return; }
    setFile(f);
    setLocalPreview(URL.createObjectURL(f));
  }, [localPreview]);

  async function handleAnalyze() {
    if (!file) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/api/instagram/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Analysis failed.");

      setAnalysis(data.analysis as ImageAnalysis);
      setCaptionOptions(data.captionOptions as CaptionOption[]);
      setAnalyzeDebug(data.debug as { model: string; imageSizeBytes: number; mediaType: string });

      // Auto-select first option
      const options = data.captionOptions as CaptionOption[];
      if (options.length > 0) {
        setSelectedIdx(0);
        setCaption([options[0].caption, options[0].hashtags].filter(Boolean).join("\n\n"));
      }
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSelectOption(idx: number) {
    if (!captionOptions) return;
    const opt = captionOptions[idx];
    setSelectedIdx(idx);
    setCaption([opt.caption, opt.hashtags].filter(Boolean).join("\n\n"));
  }

  async function uploadImage(): Promise<UploadResult | null> {
    if (!file) return null;
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch("/api/instagram/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? "Upload failed.");
    const result: UploadResult = { imageUrl: data.imageUrl, path: data.path, normalization: data.normalization };
    setUploadResult(result);
    return result;
  }

  async function handleSaveDraft() {
    if (!file || !caption.trim() || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setPendingAction("draft");
    setActionPhase("uploading");
    setActionError(null);

    try {
      const uploaded = await uploadImage();
      if (!uploaded) throw new Error("Upload returned no data.");

      setActionPhase("saving");
      const res = await apiFetch("/api/ig-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: caption.trim(),
          image_url: uploaded.imageUrl,
          image_storage_path: uploaded.path,
          image_analysis: analysis ?? undefined,
          caption_options: captionOptions ?? undefined,
          normalization_meta: uploaded.normalization as unknown as Record<string, unknown>,
          account_id: selectedAccountId ?? undefined,
          status: "draft",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Save failed.");

      setSavedPost(data.post as IgPost);
      setActionPhase("done_draft");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setActionPhase("error");
    } finally {
      isSubmittingRef.current = false;
      setPendingAction(null);
    }
  }

  async function handlePublishNow() {
    if (!file || !caption.trim() || isSubmittingRef.current) return;
    if (selectedAccountId == null) return; // guarded by disabled button; defensive
    isSubmittingRef.current = true;
    setPendingAction("publish");
    setActionPhase("uploading");
    setActionError(null);

    try {
      const uploaded = await uploadImage();
      if (!uploaded) throw new Error("Upload returned no data.");

      setActionPhase("saving");
      const createRes = await apiFetch("/api/ig-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: caption.trim(),
          image_url: uploaded.imageUrl,
          image_storage_path: uploaded.path,
          image_analysis: analysis ?? undefined,
          caption_options: captionOptions ?? undefined,
          normalization_meta: uploaded.normalization as unknown as Record<string, unknown>,
          account_id: selectedAccountId,
          status: "ready",
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) throw new Error(createData.error ?? "Save failed.");
      setSavedPost(createData.post as IgPost);

      setActionPhase("publishing");
      const pubRes = await apiFetch(`/api/ig-posts/${(createData.post as IgPost).id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: selectedAccountId }),
      });
      const pubData = await pubRes.json();
      setPublishLogs(pubData.logs as LogEntry[] ?? null);

      if (!pubRes.ok || !pubData.success) throw new Error(pubData.error ?? "Publish failed.");

      setPublishedMediaId(pubData.mediaId as string);
      setPublishedPermalink(pubData.permalink as string | undefined ?? null);
      setActionPhase("done_published");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setActionPhase("error");
    } finally {
      isSubmittingRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleSchedule() {
    if (!file || !caption.trim() || !scheduleInput || isSubmittingRef.current) return;
    if (selectedAccountId == null) return; // guarded by disabled button; defensive

    const scheduledDate = new Date(scheduleInput);
    if (isNaN(scheduledDate.getTime())) {
      setScheduleError("Please enter a valid date and time.");
      return;
    }
    if (scheduledDate <= new Date()) {
      setScheduleError("Scheduled time must be in the future.");
      return;
    }
    isSubmittingRef.current = true;
    setPendingAction("schedule");
    setScheduleError(null);
    setActionPhase("uploading");
    setActionError(null);

    try {
      const uploaded = await uploadImage();
      if (!uploaded) throw new Error("Upload returned no data.");

      setActionPhase("scheduling");
      const res = await apiFetch("/api/ig-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: caption.trim(),
          image_url: uploaded.imageUrl,
          image_storage_path: uploaded.path,
          image_analysis: analysis ?? undefined,
          caption_options: captionOptions ?? undefined,
          normalization_meta: uploaded.normalization as unknown as Record<string, unknown>,
          account_id: selectedAccountId,
          status: "scheduled",
          scheduled_at: scheduledDate.toISOString(),
          timezone: scheduleTz,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Schedule failed.");

      setSavedPost(data.post as IgPost);
      setActionPhase("done_scheduled");
      setShowSchedulePicker(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setActionPhase("error");
    } finally {
      isSubmittingRef.current = false;
      setPendingAction(null);
    }
  }

  function handleReset() {
    handleFileChange(null);
  }

  const isWorking  = ["uploading", "saving", "publishing", "scheduling"].includes(actionPhase);
  const isDone     = actionPhase === "done_draft" || actionPhase === "done_published" || actionPhase === "done_scheduled";
  const canAnalyze = !!file && !isAnalyzing && !isWorking && !isDone;
  const canSave    = !!file && !!caption.trim() && !isWorking && !isDone;
  // Publishing and scheduling require a concrete account; drafts may be saved without one.
  const hasAccount = selectedAccountId != null;
  const canPublishOrSchedule = canSave && hasAccount;

  const phaseLabel: Record<ActionPhase, string> = {
    idle: "",
    uploading: "Processing & uploading image…",
    saving: "Saving post…",
    publishing: "Publishing to Instagram… (up to 60s)",
    scheduling: "Scheduling post…",
    done_draft: "",
    done_published: "",
    done_scheduled: "",
    error: "",
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Create Post</h2>
          <p className="mt-1 text-sm text-slate-400">
            Upload an image, generate AI-powered captions, save as draft or publish to Instagram.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          AI-Powered
        </span>
      </div>

      {/* ── STEP 1: Image upload ────────────────────────────────────────────── */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-slate-300">
          Image <span className="text-slate-500">(JPG · JPEG · PNG · max 8 MB)</span>
        </p>

        {localPreview && file ? (
          <div className="space-y-2">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={localPreview}
                alt="Preview"
                className="h-52 w-full rounded-2xl object-cover ring-1 ring-white/10"
              />
              {!isWorking && !isDone && (
                <button
                  type="button"
                  onClick={() => handleFileChange(null)}
                  className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-rose-600 hover:text-white"
                >
                  Remove
                </button>
              )}
              {analysis && (
                <span className="absolute bottom-2 left-2 rounded-full bg-emerald-900/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/20">
                  ✓ AI analyzed
                </span>
              )}
              {isWorking && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/60">
                  <span className="flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-white/10">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {phaseLabel[actionPhase]}
                  </span>
                </div>
              )}
            </div>
            <p className="font-mono text-xs text-slate-500">
              {file.name} · {shortType(file.type)} · {formatBytes(file.size)}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-52 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 text-slate-500 transition hover:border-fuchsia-500/60 hover:text-slate-300"
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

      {/* Instagram processed preview (after upload) */}
      {uploadResult && (
        <div className="mt-4 rounded-3xl border border-fuchsia-500/20 bg-slate-950/60 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-400">Ready for Instagram</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={uploadResult.imageUrl}
              alt="Instagram-ready"
              className="h-32 w-auto shrink-0 rounded-xl object-contain ring-1 ring-fuchsia-400/20"
            />
            <div className="font-mono text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-300">
                <span className="text-slate-500">original</span>
                <span>{uploadResult.normalization.originalWidth}×{uploadResult.normalization.originalHeight} ({uploadResult.normalization.originalAspectRatio})</span>
                <span className="text-slate-500">output</span>
                <span>{uploadResult.normalization.finalWidth}×{uploadResult.normalization.finalHeight} ({uploadResult.normalization.finalAspectRatio})</span>
                <span className="text-slate-500">shape</span>
                <span>{shapeLabel(uploadResult.normalization.targetShape)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {uploadResult.normalization.wasCropped  && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">cropped</span>}
                {uploadResult.normalization.wasPadded   && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">blurred pad</span>}
                {uploadResult.normalization.wasConverted && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">PNG→JPEG</span>}
                {!uploadResult.normalization.wasCropped && !uploadResult.normalization.wasPadded && !uploadResult.normalization.wasConverted && uploadResult.normalization.wasResized && (
                  <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-400">resized</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Analyze & generate captions ─────────────────────────────── */}
      <div className="mt-6">
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="rounded-3xl bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isAnalyzing ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Analyzing image…
            </span>
          ) : analysis ? "Re-generate Captions" : "Analyze & Generate Captions"}
        </button>
        {!file && <p className="mt-1.5 text-xs text-slate-600">Select an image first.</p>}

        {analyzeError && (
          <p className="mt-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {analyzeError}
          </p>
        )}
      </div>

      {/* ── STEP 3: Caption options ──────────────────────────────────────────── */}
      {captionOptions && captionOptions.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-sm font-medium text-slate-300">
            Caption Options <span className="text-slate-500">— click to select</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {captionOptions.map((opt, i) => (
              <CaptionCard
                key={opt.style}
                option={opt}
                isSelected={selectedIdx === i}
                onSelect={() => handleSelectOption(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 4: Caption textarea ─────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-slate-300">Caption</p>
          <span className={`text-xs ${caption.length > 2000 ? "text-rose-400" : "text-slate-500"}`}>
            {caption.length} / 2200
          </span>
        </div>
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder={file ? (analysis ? "Select a caption above or write your own…" : "Analyze the image first to generate captions…") : "Select an image first…"}
          rows={6}
          disabled={isWorking || isDone}
          className="w-full resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
        />
      </div>

      {/* ── Account selector ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-slate-300">Instagram Account</p>
        {accounts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <select
              value={selectedAccountId ?? ""}
              onChange={e => setSelectedAccountId(Number(e.target.value) || null)}
              disabled={isWorking || isDone}
              className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
            >
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>@{acc.account_name}</option>
              ))}
            </select>
            {(() => {
              const selected = accounts.find(a => a.id === selectedAccountId);
              return selected ? (
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Posting as <span className="font-semibold text-white">@{selected.account_name}</span>
                </p>
              ) : null;
            })()}
          </div>
        ) : (
          <p className="rounded-2xl bg-slate-950/60 px-4 py-2.5 text-sm text-slate-500 ring-1 ring-white/5">
            No connected account — connect one in the Instagram Connection section below.
          </p>
        )}
      </div>

      {/* ── STEP 5: Action buttons ───────────────────────────────────────────── */}
      {!isDone && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!canSave}
            className="rounded-3xl bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "draft" ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {actionPhase === "uploading" ? "Uploading…" : "Saving draft…"}
              </span>
            ) : "Save as Draft"}
          </button>

          <button
            type="button"
            onClick={handlePublishNow}
            disabled={!canPublishOrSchedule}
            className="rounded-3xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            title={accounts.length === 0 ? "Connect an Instagram account first" : !hasAccount ? "Select an Instagram account first" : ""}
          >
            {pendingAction === "publish" ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {actionPhase === "uploading" ? "Uploading…" : actionPhase === "saving" ? "Saving…" : "Publishing… (up to 60s)"}
              </span>
            ) : "Publish Now"}
          </button>

          <button
            type="button"
            onClick={() => { setShowSchedulePicker(s => !s); setScheduleError(null); }}
            disabled={!canPublishOrSchedule}
            className="rounded-3xl border border-slate-600 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-fuchsia-500/50 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={accounts.length === 0 ? "Connect an Instagram account first" : !hasAccount ? "Select an Instagram account first" : ""}
          >
            {pendingAction === "schedule" ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {actionPhase === "uploading" ? "Uploading…" : "Scheduling…"}
              </span>
            ) : showSchedulePicker ? "Cancel" : "Schedule Post"}
          </button>

          {!file && <p className="text-xs text-slate-600">Select an image and enter a caption.</p>}
          {file && caption.trim() && !hasAccount && (
            <p className="w-full text-xs text-amber-400">
              Select an Instagram account before publishing or scheduling.
            </p>
          )}
        </div>
      )}

      {/* ── Inline schedule picker ───────────────────────────────────────────── */}
      {showSchedulePicker && !isDone && (
        <div className="mt-4 rounded-3xl border border-fuchsia-500/20 bg-slate-950/60 p-4 space-y-3">
          <p className="text-sm font-semibold text-fuchsia-300">Schedule Post</p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Date &amp; Time <span className="text-slate-600">({scheduleTz})</span></label>
            <input
              type="datetime-local"
              value={scheduleInput}
              onChange={e => { setScheduleInput(e.target.value); setScheduleError(null); }}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              disabled={isWorking}
              className="w-full rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50 [color-scheme:dark]"
            />
          </div>
          {scheduleError && (
            <p className="text-xs text-rose-400">{scheduleError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSchedule}
              disabled={!scheduleInput || isWorking}
              className="rounded-3xl bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm Schedule
            </button>
            <button
              type="button"
              onClick={() => { setShowSchedulePicker(false); setScheduleInput(""); setScheduleError(null); }}
              disabled={isWorking}
              className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Outcome: Draft saved ─────────────────────────────────────────────── */}
      {actionPhase === "done_draft" && savedPost && (
        <div className="mt-6 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-300">Draft saved!</p>
          <p className="mt-1 font-mono text-xs text-emerald-200/70">Post ID: {savedPost.id}</p>
          <p className="mt-1 text-xs text-slate-400">Find it in the Post Library below — you can publish it from there.</p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-3 rounded-3xl bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-600"
          >
            Create Another Post
          </button>
        </div>
      )}

      {/* ── Outcome: Published ───────────────────────────────────────────────── */}
      {actionPhase === "done_published" && (
        <div className="mt-6 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm font-semibold text-emerald-300">Published to Instagram!</p>
          {publishedMediaId && (
            <p className="mt-1 font-mono text-xs text-emerald-200/70">Media ID: {publishedMediaId}</p>
          )}
          {publishedPermalink && (
            <a
              href={publishedPermalink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-300 underline underline-offset-2"
            >
              View on Instagram ↗
            </a>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-3xl bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-600"
            >
              Create Another Post
            </button>
          </div>
        </div>
      )}

      {/* ── Outcome: Scheduled ──────────────────────────────────────────────── */}
      {actionPhase === "done_scheduled" && savedPost && (
        <div className="mt-6 rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
          <p className="text-sm font-semibold text-fuchsia-300">Post scheduled!</p>
          {savedPost.scheduled_at && (
            <p className="mt-1 text-xs text-slate-300">
              Publishes at:{" "}
              <span className="font-medium text-fuchsia-200">
                {new Date(savedPost.scheduled_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              {savedPost.timezone && <span className="text-slate-500"> ({savedPost.timezone})</span>}
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-fuchsia-200/60">Post ID: {savedPost.id}</p>
          <p className="mt-1 text-xs text-slate-400">You can manage it in the Post Library below.</p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-3 rounded-3xl bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-600"
          >
            Create Another Post
          </button>
        </div>
      )}

      {/* ── Outcome: Error ───────────────────────────────────────────────────── */}
      {actionPhase === "error" && (
        <div className="mt-6 rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4">
          <p className="text-sm font-semibold text-rose-300">Something went wrong</p>
          <p className="mt-1 text-sm text-rose-200">{actionError}</p>
          {(actionError ?? "").toLowerCase().includes("scope") || (actionError ?? "").toLowerCase().includes("permission") ? (
            <p className="mt-2 text-xs text-slate-400">Tip: Re-connect your Instagram account to refresh permissions.</p>
          ) : null}
          <button
            type="button"
            onClick={() => { setActionPhase("idle"); setActionError(null); }}
            className="mt-3 rounded-3xl bg-slate-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-600"
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── Debug panel ─────────────────────────────────────────────────────── */}
      <div className="mt-6">
        <DebugPanel
          file={file}
          analysis={analysis}
          analyzeDebug={analyzeDebug}
          uploadResult={uploadResult}
          publishLogs={publishLogs}
        />
      </div>
    </section>
  );
}
