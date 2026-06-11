"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, ContentIdea, Campaign, ConnectedAccount } from "@/lib/supabase";
import DraftEditor from "@/app/components/DraftEditor";

// ─── Readiness model ────────────────────────────────────────────────────────────

type Readiness =
  | "idea_ready"        // content idea not yet drafted
  | "draft_incomplete"  // draft missing image/caption/account
  | "draft_ready"       // draft has image + caption + account
  | "scheduled"         // scheduled post awaiting publish
  | "failed";           // failed post needing retry

const READINESS_LABEL: Record<Readiness, string> = {
  idea_ready: "Idea — ready for draft",
  draft_incomplete: "Draft — incomplete",
  draft_ready: "Draft — ready to schedule",
  scheduled: "Scheduled",
  failed: "Failed",
};

const READINESS_BADGE: Record<Readiness, string> = {
  idea_ready: "bg-sky-50 text-sky-700 ring-sky-200",
  draft_incomplete: "bg-amber-50 text-amber-700 ring-amber-200",
  draft_ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  scheduled: "bg-violet-50 text-violet-700 ring-violet-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

const NEXT_ACTION: Record<Readiness, string> = {
  idea_ready: "Create a draft from this idea",
  draft_incomplete: "Add the missing pieces, then schedule or publish",
  draft_ready: "Schedule or publish this draft",
  scheduled: "Waiting for the scheduler — manage in Post Library / Upcoming Queue",
  failed: "Retry publishing",
};

// A unified queue item — backed by either a content idea or an ig_post.
type QueueItem = {
  key: string;
  readiness: Readiness;
  campaignId: number | null;
  accountId: number | null;
  preview: string;
  missing: string[];
  idea?: ContentIdea;
  post?: IgPost;
};

function draftMissing(post: IgPost): string[] {
  const m: string[] = [];
  if (!post.image_url) m.push("image");
  if (!post.caption?.trim()) m.push("caption");
  if (post.account_id == null) m.push("account");
  return m;
}

// ─── Item row ───────────────────────────────────────────────────────────────────

function QueueRow({
  item,
  campaignName,
  accountName,
  accounts,
  campaigns,
  isBusy,
  isEditing,
  onCreateDraft,
  onEdit,
  onCloseEdit,
  onRetry,
  onUnschedule,
  onRefresh,
}: {
  item: QueueItem;
  campaignName: string | undefined;
  accountName: string | undefined;
  accounts: ConnectedAccount[];
  campaigns: Campaign[];
  isBusy: boolean;
  isEditing: boolean;
  onCreateDraft: () => void;
  onEdit: () => void;
  onCloseEdit: () => void;
  onRetry: () => void;
  onUnschedule: () => void;
  onRefresh: () => void;
}) {
  // A draft being edited swaps the row for the shared DraftEditor (still dark —
  // its own restyle is a later Part 4 section; wrapped in a light container).
  if (isEditing && item.post) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <DraftEditor
          post={item.post}
          accounts={accounts}
          campaigns={campaigns}
          onClose={onCloseEdit}
          onSaved={onRefresh}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ring-1 ${READINESS_BADGE[item.readiness]}`}>
              {READINESS_LABEL[item.readiness]}
            </span>
            {campaignName && (
              <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] text-fuchsia-700 ring-1 ring-fuchsia-200">{campaignName}</span>
            )}
            {accountName && (
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />@{accountName}
              </span>
            )}
          </div>

          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-700">{item.preview}</p>

          {item.missing.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-600">Missing: {item.missing.join(" + ")}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">Next: {NEXT_ACTION[item.readiness]}</p>
        </div>

        {/* Actions — one explicit click each */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {item.readiness === "idea_ready" && (
            <button type="button" onClick={onCreateDraft} disabled={isBusy}
              className="rounded-xl bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50">
              {isBusy ? "Creating…" : "Create Draft"}
            </button>
          )}

          {(item.readiness === "draft_incomplete" || item.readiness === "draft_ready") && (
            <button type="button" onClick={onEdit}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                item.readiness === "draft_ready"
                  ? "bg-fuchsia-500 text-white hover:bg-fuchsia-400"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}>
              {item.readiness === "draft_ready" ? "Schedule / Publish" : "Edit Draft"}
            </button>
          )}

          {item.readiness === "failed" && (
            <button type="button" onClick={onRetry} disabled={isBusy}
              className="rounded-xl bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:opacity-50">
              {isBusy ? "Publishing…" : "Retry Publish"}
            </button>
          )}

          {item.readiness === "scheduled" && (
            <>
              <button type="button" onClick={onUnschedule} disabled={isBusy}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                {isBusy ? "…" : "Unschedule"}
              </button>
              <span className="text-right text-[10px] text-slate-400">Reschedule in Post Library / Upcoming Queue</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ApprovalQueue ──────────────────────────────────────────────────────────────

export default function ApprovalQueue() {
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [campaignFilter, setCampaignFilter] = useState<number | "all">("all");
  const [accountFilter, setAccountFilter] = useState<number | "all">("all");
  const [readinessFilter, setReadinessFilter] = useState<Readiness | "all">("all");

  // Action state
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [postsRes, ideasRes, campaignsRes, accountsRes] = await Promise.all([
        apiFetch("/api/ig-posts"),
        apiFetch("/api/content-ideas"),
        apiFetch("/api/campaigns"),
        apiFetch("/api/meta/accounts"),
      ]);
      const postsData = await postsRes.json();
      if (!postsRes.ok || !postsData.success) throw new Error(postsData.error ?? "Failed to load posts.");
      setPosts(postsData.posts as IgPost[]);

      const ideasData = await ideasRes.json();
      if (ideasData.success) setIdeas(ideasData.ideas as ContentIdea[]);
      const campaignsData = await campaignsRes.json();
      if (campaignsData.success) setCampaigns(campaignsData.campaigns as Campaign[]);
      const accountsData = await accountsRes.json();
      if (accountsData.success) setAccounts(accountsData.accounts as ConnectedAccount[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Compute queue items (published excluded) ────────────────────────────────
  const items: QueueItem[] = [];

  for (const idea of ideas) {
    if (idea.converted_post_id == null) {
      items.push({
        key: `idea-${idea.id}`,
        readiness: "idea_ready",
        campaignId: idea.campaign_id,
        accountId: null,
        preview: idea.title,
        missing: [],
        idea,
      });
    }
  }

  for (const post of posts) {
    if (post.status === "draft") {
      const missing = draftMissing(post);
      items.push({
        key: `post-${post.id}`,
        readiness: missing.length > 0 ? "draft_incomplete" : "draft_ready",
        campaignId: post.campaign_id,
        accountId: post.account_id,
        preview: post.caption?.trim() || "(no caption yet)",
        missing,
        post,
      });
    } else if (post.status === "scheduled") {
      items.push({
        key: `post-${post.id}`,
        readiness: "scheduled",
        campaignId: post.campaign_id,
        accountId: post.account_id,
        preview: post.caption?.trim() || "(no caption)",
        missing: [],
        post,
      });
    } else if (post.status === "failed") {
      items.push({
        key: `post-${post.id}`,
        readiness: "failed",
        campaignId: post.campaign_id,
        accountId: post.account_id,
        preview: post.caption?.trim() || "(no caption)",
        missing: [],
        post,
      });
    }
    // published / republished / archived / deleted_* are intentionally excluded
  }

  // ── Apply filters ───────────────────────────────────────────────────────────
  const filtered = items.filter(it => {
    if (campaignFilter !== "all" && it.campaignId !== campaignFilter) return false;
    if (accountFilter !== "all" && it.accountId !== accountFilter) return false;
    if (readinessFilter !== "all" && it.readiness !== readinessFilter) return false;
    return true;
  });

  const counts = {
    idea_ready: items.filter(i => i.readiness === "idea_ready").length,
    draft_incomplete: items.filter(i => i.readiness === "draft_incomplete").length,
    draft_ready: items.filter(i => i.readiness === "draft_ready").length,
    scheduled: items.filter(i => i.readiness === "scheduled").length,
    failed: items.filter(i => i.readiness === "failed").length,
  };

  const campaignName = (id: number | null) => (id == null ? undefined : campaigns.find(c => c.id === id)?.name);
  const accountName = (id: number | null) => (id == null ? undefined : accounts.find(a => a.id === id)?.account_name);

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleCreateDraft(ideaId: number, key: string) {
    setBusyKey(key);
    try {
      const res = await apiFetch(`/api/content-ideas/${ideaId}/create-draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Create draft failed."); return; }
      await fetchAll();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRetry(postId: number, key: string) {
    setBusyKey(key);
    try {
      const res = await apiFetch(`/api/ig-posts/${postId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Publish failed."); return; }
      await fetchAll();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnschedule(postId: number, key: string) {
    setBusyKey(key);
    try {
      const res = await apiFetch(`/api/ig-posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft", scheduled_at: null, timezone: null, schedule_error_message: null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { alert(data.error ?? "Unschedule failed."); return; }
      await fetchAll();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Approval Queue</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everything awaiting action in one place — ideas, drafts, scheduled, and failed posts.
            Each action is a single explicit click; nothing publishes or schedules on its own.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {isLoading ? "…" : `${filtered.length} items`}
          </span>
          <button type="button" onClick={fetchAll} disabled={isLoading}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            Refresh
          </button>
        </div>
      </div>

      {/* Stat pills */}
      {!isLoading && !error && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
          {counts.idea_ready > 0 && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700 ring-1 ring-sky-200">{counts.idea_ready} ideas</span>}
          {counts.draft_incomplete > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 ring-1 ring-amber-200">{counts.draft_incomplete} incomplete</span>}
          {counts.draft_ready > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">{counts.draft_ready} ready</span>}
          {counts.scheduled > 0 && <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700 ring-1 ring-violet-200">{counts.scheduled} scheduled</span>}
          {counts.failed > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700 ring-1 ring-rose-200">{counts.failed} failed</span>}
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        {campaigns.length > 0 && (
          <select value={String(campaignFilter)} onChange={e => setCampaignFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none transition hover:bg-slate-50 focus:ring-2 focus:ring-fuchsia-300">
            <option value="all">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {accounts.length > 0 && (
          <select value={String(accountFilter)} onChange={e => setAccountFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none transition hover:bg-slate-50 focus:ring-2 focus:ring-fuchsia-300">
            <option value="all">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.account_name}</option>)}
          </select>
        )}
        <select value={readinessFilter} onChange={e => setReadinessFilter(e.target.value as Readiness | "all")}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none transition hover:bg-slate-50 focus:ring-2 focus:ring-fuchsia-300">
          <option value="all">All states</option>
          <option value="idea_ready">Idea — ready for draft</option>
          <option value="draft_incomplete">Draft — incomplete</option>
          <option value="draft_ready">Draft — ready</option>
          <option value="scheduled">Scheduled</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* List */}
      <div className="mt-6 space-y-3">
        {isLoading ? (
          [1, 2, 3].map(n => <div key={n} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">{error}</div>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
            Nothing awaiting action. Saved ideas, drafts, scheduled, and failed posts will appear here.
          </p>
        ) : (
          filtered.map(item => (
            <QueueRow
              key={item.key}
              item={item}
              campaignName={campaignName(item.campaignId)}
              accountName={accountName(item.accountId)}
              accounts={accounts}
              campaigns={campaigns}
              isBusy={busyKey === item.key}
              isEditing={editingKey === item.key}
              onCreateDraft={() => item.idea && handleCreateDraft(item.idea.id, item.key)}
              onEdit={() => setEditingKey(item.key)}
              onCloseEdit={() => setEditingKey(null)}
              onRetry={() => item.post && handleRetry(item.post.id, item.key)}
              onUnschedule={() => item.post && handleUnschedule(item.post.id, item.key)}
              onRefresh={() => { setEditingKey(null); fetchAll(); }}
            />
          ))
        )}
      </div>
    </section>
  );
}
