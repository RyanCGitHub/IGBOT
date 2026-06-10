"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Campaign, ConnectedAccount } from "@/lib/supabase";

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

// ─── Create / edit form ─────────────────────────────────────────────────────────

type FormValues = {
  name: string;
  description: string;
  account_id: number | null;
  content_style: string;
};

const EMPTY_FORM: FormValues = { name: "", description: "", account_id: null, content_style: "" };

function CampaignForm({
  initial,
  accounts,
  submitLabel,
  onSubmit,
  onCancel,
  isBusy,
}: {
  initial: FormValues;
  accounts: ConnectedAccount[];
  submitLabel: string;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
  isBusy: boolean;
}) {
  const [values, setValues] = useState<FormValues>(initial);

  const canSubmit = values.name.trim().length > 0 && !isBusy;

  return (
    <div className="space-y-3 rounded-3xl border border-fuchsia-500/20 bg-slate-950/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">Name *</label>
          <input
            type="text"
            value={values.name}
            onChange={e => setValues(v => ({ ...v, name: e.target.value }))}
            placeholder="Summer Launch"
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">Target account (optional)</label>
          <select
            value={values.account_id ?? ""}
            onChange={e => setValues(v => ({ ...v, account_id: e.target.value ? Number(e.target.value) : null }))}
            className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
          >
            <option value="">No specific account</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>@{a.account_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-400">Description / theme (optional)</label>
        <textarea
          value={values.description}
          onChange={e => setValues(v => ({ ...v, description: e.target.value }))}
          rows={2}
          placeholder="Bold product highlights, community-first tone…"
          className="resize-none rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-400">Content style / niche (optional)</label>
        <input
          type="text"
          value={values.content_style}
          onChange={e => setValues(v => ({ ...v, content_style: e.target.value }))}
          placeholder="Streetwear · motivational · UGC"
          className="rounded-2xl bg-slate-800/80 px-4 py-2.5 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(values)}
          disabled={!canSubmit}
          className="rounded-3xl bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Campaigns ──────────────────────────────────────────────────────────────────

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/campaigns");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to load campaigns.");
      setCampaigns(data.campaigns as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  useEffect(() => {
    apiFetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => { if (d.success) setAccounts(d.accounts as ConnectedAccount[]); })
      .catch(() => {});
  }, []);

  const accountName = (id: number | null) =>
    id == null ? null : accounts.find(a => a.id === id)?.account_name ?? `account ${id}`;

  async function handleCreate(values: FormValues) {
    setIsCreating(true);
    try {
      const res = await apiFetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          account_id: values.account_id,
          content_style: values.content_style.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Create failed."); return; }
      setShowCreate(false);
      await fetchCampaigns();
    } finally {
      setIsCreating(false);
    }
  }

  async function handleEdit(id: number, values: FormValues) {
    setIsSavingEdit(true);
    try {
      const res = await apiFetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description.trim() || null,
          account_id: values.account_id,
          content_style: values.content_style.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Update failed."); return; }
      setEditingId(null);
      await fetchCampaigns();
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (
      !confirm(
        `Delete campaign "${name}"?\n\n` +
        "• Posts assigned to this campaign are NOT deleted.\n" +
        "• They simply become unassigned (campaign cleared).\n\n" +
        "This cannot be undone."
      )
    ) return;
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/campaigns/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Delete failed."); return; }
      setCampaigns(prev => prev.filter(c => c.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Campaigns</h2>
          <p className="mt-1 text-sm text-slate-400">
            Group posts into campaigns. Optional — posts work fine without one. Deleting a
            campaign never deletes posts; they just become unassigned.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
            {isLoading ? "…" : `${campaigns.length}`}
          </span>
          <button
            type="button"
            onClick={() => setShowCreate(s => !s)}
            className="rounded-3xl bg-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400"
          >
            {showCreate ? "Close" : "New Campaign"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mt-5">
          <CampaignForm
            initial={EMPTY_FORM}
            accounts={accounts}
            submitLabel="Create Campaign"
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isBusy={isCreating}
          />
        </div>
      )}

      {/* List */}
      <div className="mt-6 space-y-3">
        {isLoading ? (
          [1, 2].map(n => <div key={n} className="h-20 animate-pulse rounded-3xl bg-slate-800/60" />)
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
        ) : campaigns.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            No campaigns yet. Click New Campaign to create one.
          </p>
        ) : (
          campaigns.map(c => (
            <div key={c.id} className="rounded-3xl bg-slate-950/80 p-4 ring-1 ring-white/5">
              {editingId === c.id ? (
                <CampaignForm
                  initial={{
                    name: c.name,
                    description: c.description ?? "",
                    account_id: c.account_id,
                    content_style: c.content_style ?? "",
                  }}
                  accounts={accounts}
                  submitLabel="Save Changes"
                  onSubmit={values => handleEdit(c.id, values)}
                  onCancel={() => setEditingId(null)}
                  isBusy={isSavingEdit}
                />
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{c.name}</p>
                      {accountName(c.account_id) && (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 ring-1 ring-white/10">
                          @{accountName(c.account_id)}
                        </span>
                      )}
                      {c.content_style && (
                        <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] text-fuchsia-300 ring-1 ring-fuchsia-400/20">
                          {c.content_style}
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-300">{c.description}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-600">Created {formatRelative(c.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id, c.name)}
                      disabled={deletingId === c.id}
                      className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-rose-500/70 hover:bg-rose-500/20 disabled:opacity-40"
                    >
                      {deletingId === c.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
