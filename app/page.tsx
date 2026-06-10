"use client";

import { useState, useEffect, useCallback } from "react";
import type { SavedCaption } from "@/lib/supabase";
import ContentLibrary from "@/app/components/ContentLibrary";
import InstagramConnection from "@/app/components/InstagramConnection";
import TestPublish from "@/app/components/TestPublish";
import PublishHistory from "@/app/components/PublishHistory";
import CreatePost from "@/app/components/CreatePost";
import PostLibrary from "@/app/components/PostLibrary";
import Campaigns from "@/app/components/Campaigns";
import ContentPlanner from "@/app/components/ContentPlanner";
import ContentQueue from "@/app/components/ContentQueue";
import SchedulingAssistant from "@/app/components/SchedulingAssistant";
import { apiFetch } from "@/lib/api-fetch";

export default function Home() {
  const [prompt, setPrompt] = useState(
    "Write a bold caption for a new collection launch that highlights community and style."
  );
  const [generatedCaption, setGeneratedCaption] = useState(
    "Fresh launch energy, bold visuals, and a community-first vibe — this post is built to capture attention, drive saves, and spark conversation."
  );
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
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to load saved captions.");
      }
      setSavedCaptions(data.captions as SavedCaption[]);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoadingCaptions(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedCaptions();
  }, [fetchSavedCaptions]);

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
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Unable to generate caption.");
      }

      setGeneratedCaption(
        typeof data.caption === "string"
          ? data.caption
          : String(data.caption ?? "No caption returned.")
      );
    } catch (caught) {
      setGenerateError(
        caught instanceof Error ? caught.message : String(caught)
      );
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
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to save caption.");
      }

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
    <main className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8 sm:px-10 lg:px-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-slate-900/80 px-8 py-8 shadow-2xl shadow-slate-950/20 backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-fuchsia-400/90">IG-BOT</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Instagram Content Operating System
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Manage posting workflows, generate captions, review engagement metrics, and keep every Instagram account connected — all from a single dashboard.
              </p>
            </div>
            <div className="rounded-3xl bg-slate-800/80 px-5 py-4 text-right ring-1 ring-white/10">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Active workspace</p>
              <p className="mt-2 text-xl font-semibold text-white">IG Marketing Team</p>
              <span className="mt-1 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-300/20">
                Live sync enabled
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.8fr_1.2fr]">
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
            <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <h2 className="text-base font-semibold text-white">Content Queue</h2>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
                  12 items
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Drafts</p>
                  <p className="mt-3 text-3xl font-semibold text-white">5</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Scheduled</p>
                  <p className="mt-3 text-3xl font-semibold text-white">4</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Posted</p>
                  <p className="mt-3 text-3xl font-semibold text-white">3</p>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <h2 className="text-base font-semibold text-white">Post Generator</h2>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
                  AI-assisted
                </span>
              </div>
              <div className="mt-6 space-y-4">
                <label className="block text-sm font-medium text-slate-300">Caption prompt</label>
                <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="min-h-[120px] w-full resize-none bg-transparent text-sm leading-6 text-slate-100 outline-none ring-0"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGenerateCaption}
                  disabled={isGenerating}
                  className="inline-flex items-center justify-center rounded-3xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-600"
                >
                  {isGenerating ? "Generating…" : "Generate Caption"}
                </button>
                {generateError ? (
                  <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                    {generateError}
                  </div>
                ) : null}
                <div className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Generated caption</p>
                  <p className="mt-3 text-sm leading-7 text-slate-200">{generatedCaption}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveCaption}
                    disabled={isSaving || !generatedCaption}
                    className="inline-flex items-center justify-center rounded-3xl bg-slate-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    {isSaving ? "Saving…" : "Save Caption"}
                  </button>
                  {savedSuccess ? (
                    <span className="text-sm text-emerald-400">Saved!</span>
                  ) : null}
                </div>
                {saveError ? (
                  <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                    {saveError}
                  </div>
                ) : null}
              </div>
            </article>
          </div>

          <div className="grid gap-6">
            <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <h2 className="text-base font-semibold text-white">Analytics</h2>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
                  Last 7 days
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Followers</p>
                  <p className="mt-3 text-3xl font-semibold text-white">28.4K</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Engagement Rate</p>
                  <p className="mt-3 text-3xl font-semibold text-white">6.8%</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Likes</p>
                  <p className="mt-3 text-3xl font-semibold text-white">14.2K</p>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-5 ring-1 ring-white/5">
                  <p className="text-sm text-slate-400">Comments</p>
                  <p className="mt-3 text-3xl font-semibold text-white">1.1K</p>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
              <div className="flex items-center justify-between text-sm text-slate-400">
                <h2 className="text-base font-semibold text-white">Account Status</h2>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
                  System health
                </span>
              </div>
              <div className="mt-6 space-y-4">
                {[
                  { label: "Instagram Connected", status: "Active", badgeClass: "text-emerald-300 bg-emerald-500/10 ring-emerald-300/20" },
                  { label: "Database Connected", status: "Healthy", badgeClass: "text-emerald-300 bg-emerald-500/10 ring-emerald-300/20" },
                  { label: "Claude API Connected", status: "Ready", badgeClass: "text-emerald-300 bg-emerald-500/10 ring-emerald-300/20" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
                    <p className="text-sm text-slate-300">{item.label}</p>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ring-1 ${item.badgeClass}`}>
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
          <div className="flex items-center justify-between text-slate-300">
            <div>
              <h2 className="text-base font-semibold text-white">Saved Captions</h2>
              <p className="mt-1 text-sm text-slate-400">Recently saved captions from the generator.</p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
              {isLoadingCaptions ? "…" : `${savedCaptions.length} saved`}
            </span>
          </div>

          <div className="mt-6">
            {isLoadingCaptions ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-20 animate-pulse rounded-3xl bg-slate-800/60" />
                ))}
              </div>
            ) : loadError ? (
              <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                {loadError}
              </div>
            ) : savedCaptions.length === 0 ? (
              <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
                No saved captions yet. Generate a caption and click Save Caption.
              </p>
            ) : (
              <div className="space-y-4">
                {savedCaptions.map((item) => (
                  <div key={item.id} className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
                    <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
                      <p className="truncate text-xs text-slate-500">{item.prompt}</p>
                      <span className="shrink-0 rounded-full bg-slate-800 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-200">{item.caption}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <InstagramConnection />

        <Campaigns />

        <ContentPlanner />

        <CreatePost />

        <ContentQueue />

        <SchedulingAssistant />

        <PostLibrary />

        <section className="rounded-3xl border border-white/5 bg-slate-900/40 p-6">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-300">
              Developer Tools (TestPublish + Publish History)
            </summary>
            <div className="mt-6 space-y-6">
              <TestPublish />
              <PublishHistory />
            </div>
          </details>
        </section>

        <ContentLibrary />

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
          <div className="flex items-center justify-between text-slate-300">
            <div>
              <h2 className="text-base font-semibold text-white">Recent Activity</h2>
              <p className="mt-1 text-sm text-slate-400">Latest account actions and workflow updates.</p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
              24 items
            </span>
          </div>
          <div className="mt-6 space-y-4">
            {[
              { time: "2m ago", action: "Caption generated for @brandlaunch", detail: "AI caption ready for approval." },
              { time: "18m ago", action: "New post scheduled", detail: "Product highlight post set for Friday at 10am." },
              { time: "45m ago", action: "Database sync completed", detail: "Subscriber tags updated for campaign launch." },
              { time: "1h ago", action: "Engagement report exported", detail: "Top-performing reel metrics added to analytics." },
            ].map((event) => (
              <div key={`${event.time}-${event.action}`} className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5 transition hover:bg-slate-900/90">
                <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
                  <p>{event.time}</p>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                    Activity
                  </span>
                </div>
                <p className="mt-3 font-semibold text-white">{event.action}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{event.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
