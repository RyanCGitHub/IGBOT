"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Persona, ConnectedAccount } from "@/lib/supabase";

// ─── Form values ────────────────────────────────────────────────────────────────

type FormValues = {
  name: string;
  handle_display: string;
  persona_type: string;
  bio: string;
  voice_and_tone: string;
  visual_style: string;
  content_pillars: string; // comma-separated in the form
  audience_description: string;
  hashtag_strategy: string;
  ai_disclosure_enabled: boolean;
  ai_disclosure_text: string;
};

const EMPTY: FormValues = {
  name: "", handle_display: "", persona_type: "virtual_influencer", bio: "",
  voice_and_tone: "", visual_style: "", content_pillars: "", audience_description: "",
  hashtag_strategy: "", ai_disclosure_enabled: true, ai_disclosure_text: "AI-generated content 🤖",
};

function fromPersona(p: Persona): FormValues {
  return {
    name: p.name ?? "",
    handle_display: p.handle_display ?? "",
    persona_type: p.persona_type ?? "",
    bio: p.bio ?? "",
    voice_and_tone: p.voice_and_tone ?? "",
    visual_style: p.visual_style ?? "",
    content_pillars: Array.isArray(p.content_pillars) ? p.content_pillars.join(", ") : "",
    audience_description: p.audience_description ?? "",
    hashtag_strategy: p.hashtag_strategy ?? "",
    ai_disclosure_enabled: p.ai_disclosure_enabled,
    ai_disclosure_text: p.ai_disclosure_text ?? "",
  };
}

function toPayload(v: FormValues) {
  return {
    name: v.name.trim(),
    handle_display: v.handle_display.trim() || null,
    persona_type: v.persona_type.trim() || null,
    bio: v.bio.trim() || null,
    voice_and_tone: v.voice_and_tone.trim() || null,
    visual_style: v.visual_style.trim() || null,
    content_pillars: v.content_pillars.split(",").map(s => s.trim()).filter(Boolean),
    audience_description: v.audience_description.trim() || null,
    hashtag_strategy: v.hashtag_strategy.trim() || null,
    ai_disclosure_enabled: v.ai_disclosure_enabled,
    ai_disclosure_text: v.ai_disclosure_text.trim() || undefined,
  };
}

// ─── Persona form ───────────────────────────────────────────────────────────────

function PersonaForm({
  initial,
  onSubmit,
  onCancel,
  isBusy,
}: {
  initial: FormValues;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
  isBusy: boolean;
}) {
  const [v, setV] = useState<FormValues>(initial);
  const [desc, setDesc] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);

  function set<K extends keyof FormValues>(k: K, val: FormValues[K]) {
    setV(prev => ({ ...prev, [k]: val }));
  }

  async function handleAiDraft() {
    if (!desc.trim()) return;
    setIsDrafting(true);
    try {
      const res = await apiFetch("/api/personas/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "AI draft failed."); return; }
      const d = data.draft as Record<string, unknown>;
      setV(prev => ({
        ...prev,
        name: (d.name as string) || prev.name,
        handle_display: (d.handle_display as string) || prev.handle_display,
        persona_type: (d.persona_type as string) || prev.persona_type,
        bio: (d.bio as string) || prev.bio,
        voice_and_tone: (d.voice_and_tone as string) || prev.voice_and_tone,
        visual_style: (d.visual_style as string) || prev.visual_style,
        content_pillars: Array.isArray(d.content_pillars) ? (d.content_pillars as string[]).join(", ") : prev.content_pillars,
        audience_description: (d.audience_description as string) || prev.audience_description,
        hashtag_strategy: (d.hashtag_strategy as string) || prev.hashtag_strategy,
      }));
    } finally {
      setIsDrafting(false);
    }
  }

  const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-fuchsia-300";
  const area = `${input} resize-none`;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {/* AI draft helper */}
      <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/60 p-3">
        <p className="text-xs font-semibold text-fuchsia-700">AI draft my persona</p>
        <p className="mt-0.5 text-[11px] text-slate-500">Describe the persona in a sentence; AI fills the fields (you can edit before saving).</p>
        <div className="mt-2 flex gap-2">
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="e.g. upbeat AI fitness coach for busy professionals"
            className={input}
          />
          <button type="button" onClick={handleAiDraft} disabled={isDrafting || !desc.trim()}
            className="shrink-0 rounded-xl bg-fuchsia-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50">
            {isDrafting ? "Drafting…" : "Draft"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-medium text-slate-500">Name *</span>
          <input value={v.name} onChange={e => set("name", e.target.value)} className={`mt-1 ${input}`} /></label>
        <label className="block"><span className="text-xs font-medium text-slate-500">Handle</span>
          <input value={v.handle_display} onChange={e => set("handle_display", e.target.value)} className={`mt-1 ${input}`} /></label>
      </div>

      <label className="block"><span className="text-xs font-medium text-slate-500">Persona type</span>
        <select value={v.persona_type} onChange={e => set("persona_type", e.target.value)} className={`mt-1 ${input}`}>
          <option value="virtual_influencer">Virtual influencer</option>
          <option value="brand_voice">Brand voice</option>
          <option value="niche_expert">Niche expert</option>
        </select>
      </label>

      <label className="block"><span className="text-xs font-medium text-slate-500">Bio / backstory</span>
        <textarea value={v.bio} onChange={e => set("bio", e.target.value)} rows={2} className={`mt-1 ${area}`} /></label>
      <label className="block"><span className="text-xs font-medium text-slate-500">Voice &amp; tone</span>
        <textarea value={v.voice_and_tone} onChange={e => set("voice_and_tone", e.target.value)} rows={2} className={`mt-1 ${area}`} /></label>
      <label className="block"><span className="text-xs font-medium text-slate-500">Visual style <span className="text-slate-400">(also used for AI image prompts later)</span></span>
        <textarea value={v.visual_style} onChange={e => set("visual_style", e.target.value)} rows={3} className={`mt-1 ${area}`} /></label>
      <label className="block"><span className="text-xs font-medium text-slate-500">Content pillars <span className="text-slate-400">(comma-separated)</span></span>
        <input value={v.content_pillars} onChange={e => set("content_pillars", e.target.value)} className={`mt-1 ${input}`} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="text-xs font-medium text-slate-500">Audience</span>
          <textarea value={v.audience_description} onChange={e => set("audience_description", e.target.value)} rows={2} className={`mt-1 ${area}`} /></label>
        <label className="block"><span className="text-xs font-medium text-slate-500">Hashtag strategy</span>
          <textarea value={v.hashtag_strategy} onChange={e => set("hashtag_strategy", e.target.value)} rows={2} className={`mt-1 ${area}`} /></label>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={v.ai_disclosure_enabled} onChange={e => set("ai_disclosure_enabled", e.target.checked)} />
          AI disclosure label
        </label>
        <input value={v.ai_disclosure_text} onChange={e => set("ai_disclosure_text", e.target.value)}
          disabled={!v.ai_disclosure_enabled}
          className={`flex-1 ${input} disabled:opacity-50`} />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => onSubmit(v)} disabled={isBusy || !v.name.trim()}
          className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50">
          {isBusy ? "Saving…" : "Save Persona"}
        </button>
        <button type="button" onClick={onCancel} disabled={isBusy}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── AIPersonas ─────────────────────────────────────────────────────────────────

export default function AIPersonas() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<number | null>(null);
  const [busyAccount, setBusyAccount] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsRes, personasRes] = await Promise.all([
        apiFetch("/api/meta/accounts"),
        apiFetch("/api/personas"),
      ]);
      const accountsData = await accountsRes.json();
      if (!accountsRes.ok || !accountsData.success) throw new Error(accountsData.error ?? "Failed to load accounts.");
      setAccounts(accountsData.accounts as ConnectedAccount[]);
      const personasData = await personasRes.json();
      if (personasData.success) setPersonas(personasData.personas as Persona[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const personaFor = (accountId: number) => personas.find(p => p.account_id === accountId);

  async function handleSave(accountId: number, values: FormValues) {
    setBusyAccount(accountId);
    try {
      const existing = personaFor(accountId);
      const payload = toPayload(values);
      const res = existing
        ? await apiFetch(`/api/personas/${existing.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          })
        : await apiFetch("/api/personas", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accountId, ...payload }),
          });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Save failed."); return; }
      setEditingAccount(null);
      await fetchAll();
    } finally {
      setBusyAccount(null);
    }
  }

  async function handleDelete(persona: Persona) {
    if (!confirm(`Delete persona "${persona.name}"? AI generation for this account will revert to default behavior.`)) return;
    setBusyAccount(persona.account_id);
    try {
      const res = await apiFetch(`/api/personas/${persona.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Delete failed."); return; }
      await fetchAll();
    } finally {
      setBusyAccount(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">AI Personas</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Give each connected account an in-character AI persona. Generation stays consistent with the
            persona&apos;s voice and themes; with no persona, generation behaves as before.
          </p>
        </div>
        <button type="button" onClick={fetchAll} disabled={isLoading}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
          {isLoading ? "…" : "Refresh"}
        </button>
      </div>

      {/* Compliance note */}
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Compliance: enable Instagram&apos;s <strong>AI Creator label</strong> on the account in the Instagram app —
        the API can&apos;t toggle it. This app only appends your disclosure text to captions.
      </p>

      <div className="mt-5 space-y-3">
        {isLoading ? (
          [1, 2].map(n => <div key={n} className="h-20 animate-pulse rounded-xl bg-slate-100" />)
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">{error}</div>
        ) : accounts.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            No connected accounts. Connect an Instagram account first.
          </p>
        ) : (
          accounts.map(acc => {
            const persona = personaFor(acc.id);
            const isEditing = editingAccount === acc.id;
            return (
              <div key={acc.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">@{acc.account_name}</p>
                    {persona ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Persona: <span className="font-medium text-slate-700">{persona.name}</span>
                        {persona.persona_type ? ` · ${persona.persona_type}` : ""}
                        {persona.ai_disclosure_enabled ? " · disclosure on" : ""}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-slate-400">No persona — generation uses default behavior.</p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => setEditingAccount(acc.id)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                        {persona ? "Edit" : "Create persona"}
                      </button>
                      {persona && (
                        <button type="button" onClick={() => handleDelete(persona)} disabled={busyAccount === acc.id}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 disabled:opacity-50">
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-3">
                    <PersonaForm
                      initial={persona ? fromPersona(persona) : EMPTY}
                      onSubmit={v => handleSave(acc.id, v)}
                      onCancel={() => setEditingAccount(null)}
                      isBusy={busyAccount === acc.id}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
