"use client";

import { useState, useEffect, useCallback } from "react";
import type { SavedCaption } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import AnalyticsOverview from "@/app/components/dashboard/AnalyticsOverview";

import InstagramConnection from "@/app/components/InstagramConnection";
import AIPersonas from "@/app/components/AIPersonas";
import ApprovalQueue from "@/app/components/ApprovalQueue";
import Campaigns from "@/app/components/Campaigns";
import ContentPlanner from "@/app/components/ContentPlanner";
import SchedulingAssistant from "@/app/components/SchedulingAssistant";
import PerformanceReview from "@/app/components/PerformanceReview";
import LearningEngine from "@/app/components/LearningEngine";
import ReelsAutopilot from "@/app/components/ReelsAutopilot";
import CreatePost from "@/app/components/CreatePost";
import PostLibrary from "@/app/components/PostLibrary";
import Analytics from "@/app/components/Analytics";

// Legacy tools — kept, relocated behind the Advanced / Legacy Tools accordion.
import ContentLibrary from "@/app/components/ContentLibrary";
import TestPublish from "@/app/components/TestPublish";
import PublishHistory from "@/app/components/PublishHistory";

export default function Home() {
  // ── Legacy caption generator (relocated to Advanced / Legacy Tools) ─────────
  const [prompt, setPrompt] = useState(
    "Write a bold caption for a new collection launch that highlights community and style."
  );
  const [generatedCaption, setGeneratedCaption] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [savedCaptions, setSavedCaptions] = useState<SavedCaption[]>([]);
  const [isLoadingCaptions, setIsLoadingCaptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchSavedCaptions = useCallback(async () => {
    setIsLoadingCaptions(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/captions");
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to load saved captions.");
      setSavedCaptions(data.captions as SavedCaption[]);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoadingCaptions(false);
    }
  }, []);

  useEffect(() => { fetchSavedCaptions(); }, [fetchSavedCaptions]);

  async function handleGenerateCaption() {
    setGenerateError(null);
    setSavedSuccess(false);
    setIsGenerating(true);
    try {
      const response = await apiFetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || "Unable to generate caption.");
      setGeneratedCaption(typeof data.caption === "string" ? data.caption : String(data.caption ?? "No caption returned."));
    } catch (caught) {
      setGenerateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveCaption() {
    setSaveError(null);
    setSavedSuccess(false);
    setIsSaving(true);
    try {
      const res = await apiFetch("/api/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, caption: generatedCaption }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Failed to save caption.");
      setSavedSuccess(true);
      await fetchSavedCaptions();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  return (
    <DashboardShell>
      {/* 1. Connection / status */}
      <InstagramConnection />

      {/* 2. AI Personas — per-account in-character profiles */}
      <AIPersonas />

      {/* 3. Top analytics overview — real numbers from stored data */}
      <AnalyticsOverview />

      {/* 3. Command center */}
      <ApprovalQueue />

      {/* 4. Reels autopilot — the autonomous video pipeline */}
      <SectionCard title="Reels Autopilot" subtitle="Idea → video → audio → caption → publish → learn, fully automatic" collapsible defaultOpen>
        <ReelsAutopilot />
      </SectionCard>

      {/* 5. Campaigns */}
      <Campaigns />

      {/* 5. AI workflow — collapsible */}
      <SectionCard title="Content Planner" subtitle="Generate campaign content ideas with AI" collapsible defaultOpen={false}>
        <ContentPlanner />
      </SectionCard>

      <SectionCard title="Scheduling Assistant" subtitle="Suggest posting times and assign them to ready drafts" collapsible defaultOpen={false}>
        <SchedulingAssistant />
      </SectionCard>

      <SectionCard title="Performance Review" subtitle="AI analysis of published performance" collapsible defaultOpen={false}>
        <PerformanceReview />
      </SectionCard>

      <SectionCard title="Learning Engine" subtitle="What's working by attribute — from stored insights" collapsible defaultOpen={false}>
        <LearningEngine />
      </SectionCard>

      {/* 6. Manual entry — collapsible */}
      <SectionCard title="Create Post (manual)" subtitle="Upload an image and build a post by hand" collapsible defaultOpen={false}>
        <CreatePost />
      </SectionCard>

      {/* 7. Management */}
      <PostLibrary />

      {/* 8. Analytics detail — manual per-post Sync Insights only */}
      <Analytics />

      {/* 9. Advanced / Legacy Tools */}
      <SectionCard
        title="Advanced / Legacy Tools"
        subtitle="Older tools kept for reference — superseded by Content Planner and the approval flow"
        collapsible
        defaultOpen={false}
      >
        <div className="space-y-6">
          {/* Legacy: simple caption generator (/api/generate-caption + /api/captions) */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-sm font-semibold text-slate-800">Post Generator (legacy)</h3>
            <p className="mt-0.5 text-xs text-slate-500">Quick caption generator. Prefer Content Planner for campaign-aware ideas.</p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-300"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateCaption}
                disabled={isGenerating}
                className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50"
              >
                {isGenerating ? "Generating…" : "Generate Caption"}
              </button>
              <button
                type="button"
                onClick={handleSaveCaption}
                disabled={isSaving || !generatedCaption}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save Caption"}
              </button>
              {savedSuccess && <span className="text-sm text-emerald-600">Saved!</span>}
            </div>
            {generateError && <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{generateError}</p>}
            {saveError && <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{saveError}</p>}
            {generatedCaption && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Generated caption</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{generatedCaption}</p>
              </div>
            )}
          </div>

          {/* Legacy: saved captions list */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Saved Captions (legacy)</h3>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-500">
                {isLoadingCaptions ? "…" : `${savedCaptions.length} saved`}
              </span>
            </div>
            <div className="mt-3">
              {isLoadingCaptions ? (
                <div className="h-16 animate-pulse rounded-xl bg-slate-200/60" />
              ) : loadError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{loadError}</p>
              ) : savedCaptions.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">No saved captions yet.</p>
              ) : (
                <div className="space-y-2">
                  {savedCaptions.map(item => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs text-slate-400">{item.prompt}</p>
                        <span className="shrink-0 text-[11px] text-slate-400">{formatRelativeTime(item.created_at)}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-slate-700">{item.caption}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Legacy dev tools + content library (unchanged components) */}
          <TestPublish />
          <PublishHistory />
          <ContentLibrary />
        </div>
      </SectionCard>
    </DashboardShell>
  );
}
