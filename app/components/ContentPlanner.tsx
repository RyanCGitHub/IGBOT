"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Campaign, ContentIdea, GeneratedIdea } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Generated (unsaved) idea card ──────────────────────────────────────────────

function GeneratedIdeaCard({
  idea,
  isSaving,
  isSaved,
  onSave,
}: {
  idea: GeneratedIdea;
  isSaving: boolean;
  isSaved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="rounded-2xl border border-fuchsia-500/20 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white">{idea.title}</p>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || isSaved}
          className="shrink-0 rounded-2xl bg-fuchsia-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isSaved ? "✓ Saved" : isSaving ? "Saving…" : "Save Idea"}
        </button>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        {idea.caption_angle && (
          <div><dt className="text-slate-500">Caption angle</dt><dd className="text-slate-300">{idea.caption_angle}</dd></div>
        )}
        {idea.visual_concept && (
          <div><dt className="text-slate-500">Visual</dt><dd className="text-slate-300">{idea.visual_concept}</dd></div>
        )}
        {idea.cta && (
          <div><dt className="text-slate-500">CTA</dt><dd className="text-slate-300">{idea.cta}</dd></div>
        )}
        {idea.hashtags && (
          <div><dt className="text-slate-500">Hashtags</dt><dd className="text-fuchsia-300/80">{idea.hashtags}</dd></div>
        )}
      </dl>
    </div>
  );
}

// ─── Saved idea card ────────────────────────────────────────────────────────────

function SavedIdeaCard({
  idea,
  isCreatingDraft,
  isDeleting,
  onCreateDraft,
  onDelete,
}: {
  idea: ContentIdea;
  isCreatingDraft: boolean;
  isDeleting: boolean;
  onCreateDraft: () => void;
  onDelete: () => void;
}) {
  const converted = idea.converted_post_id != null;
  return (
    <div className="rounded-2xl bg-slate-950/80 p-4 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{idea.title}</p>
            {converted && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300 ring-1 ring-emerald-400/20">
                Drafted
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">Saved {formatRelative(idea.created_at)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={onCreateDraft}
            disabled={isCreatingDraft}
            className="rounded-2xl bg-fuchsia-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50"
          >
            {isCreatingDraft ? "Creating…" : converted ? "Create Another Draft" : "Create Draft"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-rose-500/70 transition hover:bg-rose-500/20 disabled:opacity-40"
          >
            {isDeleting ? "…" : "Delete"}
          </button>
        </div>
      </div>
      <dl className="mt-2 space-y-1.5 text-xs">
        {idea.caption_angle && (
          <div><dt className="text-slate-500">Caption angle</dt><dd className="text-slate-300">{idea.caption_angle}</dd></div>
        )}
        {idea.visual_concept && (
          <div><dt className="text-slate-500">Visual</dt><dd className="text-slate-300">{idea.visual_concept}</dd></div>
        )}
        {idea.cta && (
          <div><dt className="text-slate-500">CTA</dt><dd className="text-slate-300">{idea.cta}</dd></div>
        )}
        {idea.hashtags && (
          <div><dt className="text-slate-500">Hashtags</dt><dd className="text-fuchsia-300/80">{idea.hashtags}</dd></div>
        )}
      </dl>
    </div>
  );
}

// ─── ContentPlanner ─────────────────────────────────────────────────────────────

export default function ContentPlanner() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(5);

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedIdea[]>([]);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIdxs, setSavedIdxs] = useState<Set<number>>(new Set());

  // Saved ideas
  const [savedIdeas, setSavedIdeas] = useState<ContentIdea[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Load campaigns on mount
  useEffect(() => {
    apiFetch("/api/campaigns")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const list = d.campaigns as Campaign[];
          setCampaigns(list);
          if (list.length > 0) setSelectedCampaignId(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const fetchSaved = useCallback(async (campaignId: number) => {
    setIsLoadingSaved(true);
    try {
      const res = await apiFetch(`/api/content-ideas?campaign_id=${campaignId}`);
      const data = await res.json();
      if (res.ok && data.success) setSavedIdeas(data.ideas as ContentIdea[]);
    } finally {
      setIsLoadingSaved(false);
    }
  }, []);

  // Reload saved ideas whenever the campaign changes; clear generation state
  useEffect(() => {
    if (selectedCampaignId == null) { setSavedIdeas([]); return; }
    fetchSaved(selectedCampaignId);
    setGenerated([]);
    setSavedIdxs(new Set());
    setGenerateError(null);
    setBanner(null);
  }, [selectedCampaignId, fetchSaved]);

  async function handleGenerate() {
    if (selectedCampaignId == null) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGenerated([]);
    setSavedIdxs(new Set());
    setBanner(null);
    try {
      const res = await apiFetch("/api/content-ideas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: selectedCampaignId, notes: notes.trim() || undefined, count }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Generation failed.");
      setGenerated(data.ideas as GeneratedIdea[]);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSave(idx: number) {
    if (selectedCampaignId == null) return;
    const idea = generated[idx];
    setSavingIdx(idx);
    try {
      const res = await apiFetch("/api/content-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: selectedCampaignId,
          title: idea.title,
          caption_angle: idea.caption_angle,
          visual_concept: idea.visual_concept,
          cta: idea.cta,
          hashtags: idea.hashtags,
          source_prompt: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Save failed."); return; }
      setSavedIdxs(prev => new Set(prev).add(idx));
      await fetchSaved(selectedCampaignId);
    } finally {
      setSavingIdx(null);
    }
  }

  async function handleCreateDraft(ideaId: number) {
    setCreatingDraftId(ideaId);
    setBanner(null);
    try {
      const res = await apiFetch(`/api/content-ideas/${ideaId}/create-draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Draft creation failed."); return; }
      setBanner(`Draft created (post #${data.post.id}). Find it in Post Library below — nothing was published or scheduled.`);
      if (selectedCampaignId != null) await fetchSaved(selectedCampaignId);
    } finally {
      setCreatingDraftId(null);
    }
  }

  async function handleDelete(ideaId: number) {
    if (!confirm("Delete this saved idea? Any draft already created from it is not affected.")) return;
    setDeletingId(ideaId);
    try {
      const res = await apiFetch(`/api/content-ideas/${ideaId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Delete failed."); return; }
      setSavedIdeas(prev => prev.filter(i => i.id !== ideaId));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Content Planner</h2>
          <p className="mt-1 text-sm text-slate-400">
            Generate AI post ideas for a campaign, save the ones you like, and turn them into
            drafts. Ideas never publish or schedule on their own.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          AI-Powered
        </span>
      </div>

      {campaigns.length === 0 ? (
        <p className="mt-6 rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
          No campaigns yet. Create a campaign in the Campaigns section first.
        </p>
      ) : (
        <>
          {/* Controls */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Campaign</label>
              <select
                value={selectedCampaignId ?? ""}
                onChange={e => setSelectedCampaignId(e.target.value ? Number(e.target.value) : null)}
                disabled={isGenerating}
                className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
              >
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Number of ideas</label>
              <select
                value={count}
                onChange={e => setCount(Number(e.target.value))}
                disabled={isGenerating}
                className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
              >
                {[3, 5, 6, 8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Notes / prompt <span className="text-slate-500">(optional)</span></label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              disabled={isGenerating}
              placeholder="Any angle, product, or theme to steer the ideas…"
              className="resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
            />
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || selectedCampaignId == null}
              className="rounded-3xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Generating ideas…
                </span>
              ) : "Generate Ideas"}
            </button>
          </div>

          {generateError && (
            <p className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {generateError}
            </p>
          )}

          {banner && (
            <p className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {banner}
            </p>
          )}

          {/* Generated (unsaved) ideas */}
          {generated.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-slate-300">
                Generated Ideas <span className="text-slate-500">— not saved yet</span>
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {generated.map((idea, i) => (
                  <GeneratedIdeaCard
                    key={i}
                    idea={idea}
                    isSaving={savingIdx === i}
                    isSaved={savedIdxs.has(i)}
                    onSave={() => handleSave(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Saved ideas */}
          <div className="mt-8">
            <p className="mb-3 text-sm font-medium text-slate-300">
              Saved Ideas <span className="text-slate-500">— for this campaign</span>
            </p>
            {isLoadingSaved ? (
              <div className="space-y-3">
                {[1, 2].map(n => <div key={n} className="h-20 animate-pulse rounded-2xl bg-slate-800/60" />)}
              </div>
            ) : savedIdeas.length === 0 ? (
              <p className="rounded-2xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
                No saved ideas yet. Generate ideas above and click Save Idea.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {savedIdeas.map(idea => (
                  <SavedIdeaCard
                    key={idea.id}
                    idea={idea}
                    isCreatingDraft={creatingDraftId === idea.id}
                    isDeleting={deletingId === idea.id}
                    onCreateDraft={() => handleCreateDraft(idea.id)}
                    onDelete={() => handleDelete(idea.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
