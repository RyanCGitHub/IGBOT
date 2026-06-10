"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Campaign, ConnectedAccount, PerformanceReview, PerformanceRecommendation } from "@/lib/supabase";

// ─── Category styling ───────────────────────────────────────────────────────────

const CATEGORY_BADGE: Record<string, string> = {
  "Best theme":    "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
  "Weak theme":    "bg-rose-500/10 text-rose-300 ring-rose-400/20",
  "Next angle":    "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-400/20",
  "Caption/hook":  "bg-blue-500/10 text-blue-300 ring-blue-400/20",
  "Timing":        "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  "Campaign idea": "bg-violet-500/10 text-violet-300 ring-violet-400/20",
};

// ─── Recommendation card ────────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  campaignId,
  campaigns,
  isSaving,
  isSaved,
  onSave,
}: {
  rec: PerformanceRecommendation;
  campaignId: number | null;
  campaigns: Campaign[];
  isSaving: boolean;
  isSaved: boolean;
  onSave: (targetCampaignId: number) => void;
}) {
  // When no campaign filter is set, let the user pick one inline before saving.
  const [pickCampaign, setPickCampaign] = useState<number | null>(null);
  const badge = CATEGORY_BADGE[rec.category] ?? "bg-slate-700/60 text-slate-300 ring-slate-500/20";

  function handleSaveClick() {
    const target = campaignId ?? pickCampaign;
    if (target == null) return;
    onSave(target);
  }

  return (
    <div className="rounded-2xl bg-slate-950/80 p-4 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ring-1 ${badge}`}>
            {rec.category}
          </span>
          <p className="mt-2 text-sm font-semibold text-white">{rec.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{rec.detail}</p>
        </div>
      </div>

      {rec.idea && (
        <div className="mt-3 rounded-xl border border-fuchsia-500/20 bg-slate-900/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-400">Suggested content idea</p>
          <dl className="mt-1.5 space-y-1 text-xs">
            <div><dt className="text-slate-500">Hook</dt><dd className="text-slate-200">{rec.idea.title}</dd></div>
            {rec.idea.caption_angle && <div><dt className="text-slate-500">Caption angle</dt><dd className="text-slate-300">{rec.idea.caption_angle}</dd></div>}
            {rec.idea.visual_concept && <div><dt className="text-slate-500">Visual</dt><dd className="text-slate-300">{rec.idea.visual_concept}</dd></div>}
            {rec.idea.cta && <div><dt className="text-slate-500">CTA</dt><dd className="text-slate-300">{rec.idea.cta}</dd></div>}
            {rec.idea.hashtags && <div><dt className="text-slate-500">Hashtags</dt><dd className="text-fuchsia-300/80">{rec.idea.hashtags}</dd></div>}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {campaignId == null && (
              <select
                value={pickCampaign ?? ""}
                onChange={e => setPickCampaign(e.target.value ? Number(e.target.value) : null)}
                disabled={isSaving || isSaved}
                className="rounded-2xl bg-slate-800/80 px-3 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
              >
                <option value="">Choose a campaign…</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={isSaving || isSaved || (campaignId == null && pickCampaign == null)}
              title={campaignId == null && pickCampaign == null ? "Choose a campaign first" : ""}
              className="rounded-2xl bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isSaved ? "✓ Saved as idea" : isSaving ? "Saving…" : "Save as Content Idea"}
            </button>
            {campaignId == null && pickCampaign == null && (
              <span className="text-[10px] text-amber-400">Choose a campaign to save this idea.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PerformanceReview ──────────────────────────────────────────────────────────

export default function PerformanceReviewSection() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);

  // Filters
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  // Review
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<PerformanceReview | null>(null);

  // Save-as-idea state (keyed by recommendation index)
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIdxs, setSavedIdxs] = useState<Set<number>>(new Set());

  useEffect(() => {
    apiFetch("/api/campaigns").then(r => r.json()).then(d => { if (d.success) setCampaigns(d.campaigns as Campaign[]); }).catch(() => {});
    apiFetch("/api/meta/accounts").then(r => r.json()).then(d => { if (d.success) setAccounts(d.accounts as ConnectedAccount[]); }).catch(() => {});
  }, []);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    setReview(null);
    setSavedIdxs(new Set());
    try {
      const res = await apiFetch("/api/performance-review/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId ?? undefined,
          account_id: accountId ?? undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Generation failed.");
      setReview(data.review as PerformanceReview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveIdea(idx: number, rec: PerformanceRecommendation, targetCampaignId: number) {
    if (!rec.idea) return;
    setSavingIdx(idx);
    try {
      const res = await apiFetch("/api/content-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: targetCampaignId,
          title: rec.idea.title,
          caption_angle: rec.idea.caption_angle,
          visual_concept: rec.idea.visual_concept,
          cta: rec.idea.cta,
          hashtags: rec.idea.hashtags,
          source_prompt: `From performance review: ${rec.category} — ${rec.title}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Save failed."); return; }
      setSavedIdxs(prev => new Set(prev).add(idx));
    } finally {
      setSavingIdx(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Performance Review</h2>
          <p className="mt-1 text-sm text-slate-400">
            AI analysis of your published posts. Recommendations are advisory and not saved —
            optionally save an actionable one as a content idea. Nothing is published or scheduled.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          AI-Powered
        </span>
      </div>

      {/* Filters */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Campaign <span className="text-slate-500">(optional)</span></label>
          <select
            value={campaignId ?? ""}
            onChange={e => setCampaignId(e.target.value ? Number(e.target.value) : null)}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
          >
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Account <span className="text-slate-500">(optional)</span></label>
          <select
            value={accountId ?? ""}
            onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
          >
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Start date <span className="text-slate-500">(optional)</span></label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">End date <span className="text-slate-500">(optional)</span></label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate || undefined}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Notes <span className="text-slate-500">(optional)</span></label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          disabled={isGenerating}
          placeholder="e.g. we want more saves, focus on product posts…"
          className="resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="rounded-3xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Analyzing…
            </span>
          ) : "Generate Recommendations"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
      )}

      {/* Review output */}
      {review && (
        <div className="mt-6 space-y-4">
          {/* Summary */}
          <div className="rounded-2xl bg-slate-950/80 p-4 ring-1 ring-white/5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">{review.posts_analyzed} posts analyzed</span>
              {review.limited && (
                <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/20">
                  Limited data — interpret cautiously
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-200">{review.summary}</p>
            {review.metrics_note && <p className="mt-1.5 text-xs text-slate-500">{review.metrics_note}</p>}
          </div>

          {/* Recommendations */}
          {review.recommendations.length === 0 ? (
            <p className="rounded-2xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
              No recommendations to show. Publish and sync more posts for a richer review.
            </p>
          ) : (
            <div className="space-y-3">
              {review.recommendations.map((rec, i) => (
                <RecommendationCard
                  key={i}
                  rec={rec}
                  campaignId={campaignId}
                  campaigns={campaigns}
                  isSaving={savingIdx === i}
                  isSaved={savedIdxs.has(i)}
                  onSave={(target) => handleSaveIdea(i, rec, target)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
