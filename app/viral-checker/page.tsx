"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { supabase } from "@/lib/supabase";
import PublishGate from "@/app/components/viral/PublishGate";
import ViralAccuracy from "@/app/components/viral/ViralAccuracy";
import PredictedVsActual from "@/app/components/viral/PredictedVsActual";

// Viral Potential Checker (V1): upload a photo/reel, add caption/hashtags/audio,
// pick the account + lane, get a 0–100 rubric-weighted AI score with a
// dimension breakdown and concrete fixes. Scoring lives server-side
// (/api/viral-score); this is the cockpit.

type Account = { id: number; account_name: string };
type SubKey =
  | "hook_score" | "retention_score" | "shareability_score" | "topic_strength_score"
  | "visual_clarity_score" | "caption_score" | "audio_hashtag_fit_score";

type Result = {
  review_id: number | null;
  viral_score: number;
  confidence_score: number;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  suggested_fixes: string[];
} & Record<SubKey, number>;

const LANES = [
  { id: "news_media", label: "News / Media" },
  { id: "streamer_clips", label: "Streamer Clips" },
  { id: "avatar_reels", label: "Avatar Reels (Finn)" },
  { id: "general", label: "General" },
];

const SUB_LABELS: { key: SubKey; label: string }[] = [
  { key: "hook_score", label: "Hook" },
  { key: "retention_score", label: "Retention" },
  { key: "shareability_score", label: "Shareability" },
  { key: "topic_strength_score", label: "Topic strength" },
  { key: "visual_clarity_score", label: "Visual clarity" },
  { key: "caption_score", label: "Caption" },
  { key: "audio_hashtag_fit_score", label: "Audio / hashtag fit" },
];

const inputCls = "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-cyan-500/40";
const labelCls = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

function scoreColor(s: number): string {
  if (s >= 80) return "#34d399";
  if (s >= 65) return "#a3e635";
  if (s >= 50) return "#fbbf24";
  if (s >= 35) return "#fb923c";
  return "#fb7185";
}

function Gauge({ score, verdict, confidence }: { score: number; verdict: string; confidence: number }) {
  const r = 70, c = 2 * Math.PI * r, color = scoreColor(score);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#1e293b" strokeWidth="14" />
          <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold tabular-nums" style={{ color }}>{score}</span>
          <span className="text-[11px] text-slate-500">/ 100</span>
        </div>
      </div>
      <p className="text-sm font-semibold" style={{ color }}>{verdict}</p>
      <p className="text-[11px] text-slate-500">Confidence {confidence}%</p>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">{value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: scoreColor(value) }} />
      </div>
    </div>
  );
}

export default function ViralCheckerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contentType, setContentType] = useState<"reel" | "photo">("reel");
  const [lane, setLane] = useState("general");
  const [accountId, setAccountId] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [audioNote, setAudioNote] = useState("");

  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await apiFetch("/api/reels/settings");
      const data = await res.json();
      if (res.ok && data.success !== false && Array.isArray(data.accounts)) {
        setAccounts((data.accounts as Account[]).map(a => ({ id: a.id, account_name: a.account_name })));
      }
    } catch { /* account select is optional */ }
  }, []);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    const isVideo = file.type.startsWith("video/");
    setContentType(isVideo ? "reel" : "photo");
    const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
    setUploading(true);
    try {
      const urlRes = await apiFetch("/api/viral-score/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ext: ext }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || urlData.success === false) throw new Error(urlData.error || "Could not start upload.");
      const { error: upErr } = await supabase.storage
        .from("instagram-media")
        .uploadToSignedUrl(urlData.path as string, urlData.token as string, file);
      if (upErr) throw new Error(upErr.message);
      setMediaPath(urlData.path as string);
      setPreviewUrl(urlData.publicUrl as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setMediaPath(null); setPreviewUrl(null);
    } finally {
      setUploading(false);
    }
  }

  async function score() {
    setScoring(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch("/api/viral-score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType, lane,
          account_id: accountId ? Number(accountId) : null,
          media_path: mediaPath, caption, hashtags, audio_note: audioNote,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Scoring failed.");
      setResult(data as Result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScoring(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(56,189,248,0.10),transparent),radial-gradient(40%_30%_at_85%_20%,rgba(217,70,239,0.08),transparent)]" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 sm:px-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-7 py-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-sm font-bold text-white shadow-[0_0_18px_rgba(56,189,248,0.35)]">VP</span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Viral Potential Checker</h1>
              <p className="text-sm text-slate-400">Score a post before it goes out — rubric-weighted AI, tuned per lane.</p>
            </div>
          </div>
          <Link href="/" className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700">← Command Center</Link>
        </header>

        {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

        <PublishGate />

        <ViralAccuracy />

        <PredictedVsActual />

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── Input ── */}
          <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
            <div>
              <p className={labelCls}>Media (photo or reel)</p>
              <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-800/50 px-4 py-6 text-center transition hover:border-cyan-500/50">
                <input type="file" accept="image/*,video/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {uploading ? (
                  <span className="text-sm text-slate-400">Uploading…</span>
                ) : previewUrl ? (
                  contentType === "photo"
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={previewUrl} alt="" className="max-h-44 rounded-lg object-contain" />
                    : <video src={previewUrl} className="max-h-44 rounded-lg" muted controls />
                ) : (
                  <span className="text-sm text-slate-400">Click to upload a photo or reel</span>
                )}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={labelCls}>Type</p>
                <select className={inputCls} value={contentType} onChange={e => setContentType(e.target.value as "reel" | "photo")}>
                  <option value="reel">Reel</option>
                  <option value="photo">Photo post</option>
                </select>
              </div>
              <div>
                <p className={labelCls}>Lane</p>
                <select className={inputCls} value={lane} onChange={e => setLane(e.target.value)}>
                  {LANES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <p className={labelCls}>Target account</p>
              <select className={inputCls} value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">— optional —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
              </select>
            </div>

            <div>
              <p className={labelCls}>Caption</p>
              <textarea className={`${inputCls} resize-none`} rows={4} value={caption} onChange={e => setCaption(e.target.value)} placeholder="Paste the caption…" />
            </div>
            <div>
              <p className={labelCls}>Hashtags</p>
              <input className={inputCls} value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="#tag1 #tag2 #tag3" />
            </div>
            {contentType === "reel" && (
              <div>
                <p className={labelCls}>Audio / music (optional)</p>
                <input className={inputCls} value={audioNote} onChange={e => setAudioNote(e.target.value)} placeholder="e.g. trending sped-up audio, or describe the track" />
              </div>
            )}

            <button
              type="button"
              disabled={scoring || uploading}
              onClick={score}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {scoring ? "Scoring…" : "Score viral potential →"}
            </button>
            <p className="text-[11px] text-slate-500">V1 is a rubric + AI estimate, not a guarantee. It improves as real post performance is logged.</p>
          </div>

          {/* ── Result ── */}
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
            {!result ? (
              <div className="flex h-full min-h-[300px] items-center justify-center text-center text-sm text-slate-500">
                {scoring ? "Analyzing hook, retention, shareability…" : "Upload a post and hit score to see its breakdown."}
              </div>
            ) : (
              <div className="space-y-5">
                <Gauge score={result.viral_score} verdict={result.verdict} confidence={result.confidence_score} />
                <div className="space-y-2.5">
                  {SUB_LABELS.map(s => <Bar key={s.key} label={s.label} value={result[s.key]} />)}
                </div>
                {result.strengths.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">Strengths</p>
                    <ul className="mt-1 space-y-1 text-[12px] text-slate-300">{result.strengths.map((s, i) => <li key={i}>✓ {s}</li>)}</ul>
                  </div>
                )}
                {result.weaknesses.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-300">Weaknesses</p>
                    <ul className="mt-1 space-y-1 text-[12px] text-slate-300">{result.weaknesses.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                  </div>
                )}
                {result.suggested_fixes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-cyan-300">Suggested fixes</p>
                    <ul className="mt-1 space-y-1 text-[12px] text-slate-300">{result.suggested_fixes.map((s, i) => <li key={i}>→ {s}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
