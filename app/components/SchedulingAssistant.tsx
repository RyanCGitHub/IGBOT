"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Campaign, ConnectedAccount, IgPost, ScheduleSuggestion } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function todayLocalDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Why a draft can or cannot be scheduled yet.
function draftBlockers(post: IgPost): string[] {
  const missing: string[] = [];
  if (!post.image_url) missing.push("image");
  if (!post.caption?.trim()) missing.push("caption");
  if (post.account_id == null) missing.push("account");
  return missing;
}

// ─── SchedulingAssistant ────────────────────────────────────────────────────────

export default function SchedulingAssistant() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [drafts, setDrafts] = useState<IgPost[]>([]);

  // Form
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(() => todayLocalDate(0));
  const [endDate, setEndDate] = useState(() => todayLocalDate(7));
  const [count, setCount] = useState(5);
  const [notes, setNotes] = useState("");

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ScheduleSuggestion[]>([]);

  // Assignment
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null); // recommended_at
  const [assigningKey, setAssigningKey] = useState<string | null>(null); // `${recommended_at}:${draftId}`
  const [banner, setBanner] = useState<string | null>(null);

  const fetchDrafts = useCallback(async () => {
    const res = await apiFetch("/api/ig-posts");
    const data = await res.json();
    if (res.ok && data.success) {
      setDrafts((data.posts as IgPost[]).filter(p => p.status === "draft"));
    }
  }, []);

  useEffect(() => {
    apiFetch("/api/campaigns").then(r => r.json()).then(d => { if (d.success) setCampaigns(d.campaigns as Campaign[]); }).catch(() => {});
    apiFetch("/api/meta/accounts").then(r => r.json()).then(d => { if (d.success) setAccounts(d.accounts as ConnectedAccount[]); }).catch(() => {});
    fetchDrafts();
  }, [fetchDrafts]);

  async function handleGenerate() {
    setIsGenerating(true);
    setGenerateError(null);
    setSuggestions([]);
    setSelectedSuggestion(null);
    setBanner(null);
    try {
      const res = await apiFetch("/api/schedule-suggestions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId ?? undefined,
          account_id: accountId ?? undefined,
          start_date: startDate,
          end_date: endDate,
          count,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Generation failed.");
      setSuggestions(data.suggestions as ScheduleSuggestion[]);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAssign(recommendedAt: string, draft: IgPost) {
    const key = `${recommendedAt}:${draft.id}`;
    setAssigningKey(key);
    setBanner(null);
    try {
      const res = await apiFetch(`/api/ig-posts/${draft.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: recommendedAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Scheduling failed."); return; }
      setBanner(`Draft #${draft.id} scheduled for ${formatWhen(recommendedAt)}. See the Upcoming Queue / Post Library below — nothing was published.`);
      setSelectedSuggestion(null);
      await fetchDrafts(); // the draft is no longer a draft; drops off the eligible list
    } finally {
      setAssigningKey(null);
    }
  }

  const eligibleDrafts = drafts.filter(d => draftBlockers(d).length === 0);
  const blockedDrafts = drafts.filter(d => draftBlockers(d).length > 0);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Scheduling Assistant</h2>
          <p className="mt-1 text-sm text-slate-400">
            Generate suggested posting times, then assign one to a ready draft. Suggestions are
            advisory and never saved; assigning schedules the existing draft — it never publishes.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          AI-Powered
        </span>
      </div>

      {/* Controls */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Campaign <span className="text-slate-500">(optional)</span></label>
          <select
            value={campaignId ?? ""}
            onChange={e => setCampaignId(e.target.value ? Number(e.target.value) : null)}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
          >
            <option value="">No specific campaign</option>
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
            <option value="">Any account</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            min={todayLocalDate(0)}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-300">Number of suggestions</label>
          <select
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            disabled={isGenerating}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40 disabled:opacity-50"
          >
            {[3, 5, 7, 10, 14].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Notes <span className="text-slate-500">(optional)</span></label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          disabled={isGenerating}
          placeholder="e.g. skew toward evenings, avoid weekends…"
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
              Generating suggestions…
            </span>
          ) : "Generate Schedule Suggestions"}
        </button>
      </div>

      {generateError && (
        <p className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{generateError}</p>
      )}
      {banner && (
        <p className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{banner}</p>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-sm font-medium text-slate-300">
            Suggested Times <span className="text-slate-500">— advisory, not saved. Pick one, then assign a draft.</span>
          </p>
          <div className="space-y-3">
            {suggestions.map(s => {
              const isSelected = selectedSuggestion === s.recommended_at;
              return (
                <div
                  key={s.recommended_at}
                  className={`rounded-2xl p-4 ring-1 transition ${isSelected ? "bg-fuchsia-500/5 ring-fuchsia-400/40" : "bg-slate-950/80 ring-white/5"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{formatWhen(s.recommended_at)}</p>
                      {s.theme && <p className="mt-1 text-xs text-fuchsia-300">{s.theme}</p>}
                      {s.reason && <p className="mt-1 text-xs text-slate-400">{s.reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSuggestion(isSelected ? null : s.recommended_at)}
                      className={`shrink-0 rounded-2xl px-3 py-1 text-xs font-semibold transition ${
                        isSelected ? "bg-fuchsia-500 text-white hover:bg-fuchsia-400" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      {isSelected ? "Picking draft…" : "Use this time"}
                    </button>
                  </div>

                  {/* Draft picker for the selected suggestion */}
                  {isSelected && (
                    <div className="mt-3 border-t border-white/5 pt-3">
                      <p className="mb-2 text-xs font-medium text-slate-400">Assign this time to a ready draft:</p>
                      {eligibleDrafts.length === 0 ? (
                        <p className="rounded-xl bg-slate-900/60 px-3 py-2 text-xs text-slate-500">
                          No ready drafts. A draft needs an image, caption, and account before it can be scheduled —
                          complete one in the Post Library (Edit) or Content Planner first.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {eligibleDrafts.map(d => {
                            const key = `${s.recommended_at}:${d.id}`;
                            return (
                              <div key={d.id} className="flex items-center gap-3 rounded-xl bg-slate-900/60 p-2 ring-1 ring-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {d.image_url && <img src={d.image_url} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-white/10" />}
                                <p className="min-w-0 flex-1 line-clamp-1 text-xs text-slate-300">{d.caption}</p>
                                <button
                                  type="button"
                                  onClick={() => handleAssign(s.recommended_at, d)}
                                  disabled={assigningKey === key}
                                  className="shrink-0 rounded-2xl bg-fuchsia-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50"
                                >
                                  {assigningKey === key ? "Scheduling…" : "Assign to Draft"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Drafts not yet eligible */}
      {blockedDrafts.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-slate-300">
            Drafts not ready to schedule <span className="text-slate-500">({blockedDrafts.length})</span>
          </p>
          <div className="space-y-2">
            {blockedDrafts.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/80 p-3 ring-1 ring-white/5">
                <p className="min-w-0 flex-1 line-clamp-1 text-xs text-slate-400">
                  #{d.id} {d.caption ? `· ${d.caption}` : ""}
                </p>
                <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 ring-1 ring-amber-400/20">
                  Needs {draftBlockers(d).join(" + ")}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Complete these in the Post Library (Edit) — add the missing image / caption / account — then they become assignable here.
          </p>
        </div>
      )}
    </section>
  );
}
