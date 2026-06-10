"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { IgPost, IgPostStatus } from "@/lib/supabase";

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Status display ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<IgPostStatus, string> = {
  draft:                "text-slate-300   bg-slate-700/60      ring-slate-500/20",
  ready:                "text-blue-300    bg-blue-500/10       ring-blue-400/20",
  publishing:           "text-amber-300   bg-amber-500/10      ring-amber-400/20",
  published:            "text-emerald-300 bg-emerald-500/10    ring-emerald-400/20",
  failed:               "text-rose-300    bg-rose-500/10       ring-rose-400/20",
  scheduled:            "text-violet-300  bg-violet-500/10     ring-violet-400/20",
  deleted_on_instagram: "text-orange-300  bg-orange-500/10     ring-orange-400/20",
  deleted_by_dashboard: "text-red-300     bg-red-500/10        ring-red-400/20",
  republishing:         "text-amber-300   bg-amber-500/10      ring-amber-400/20",
  republished:          "text-teal-300    bg-teal-500/10       ring-teal-400/20",
  archived:             "text-slate-400   bg-slate-800/60      ring-slate-600/20",
};

const STATUS_LABEL: Record<IgPostStatus, string> = {
  draft:                "Draft",
  ready:                "Ready",
  publishing:           "Publishing…",
  published:            "Published",
  failed:               "Failed",
  scheduled:            "Scheduled",
  deleted_on_instagram: "Deleted on Instagram",
  deleted_by_dashboard: "Deleted by Dashboard",
  republishing:         "Republishing…",
  republished:          "Republished",
  archived:             "Archived",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type LogEntry = {
  step: string;
  status: "success" | "error" | "info";
  detail: string;
  timestamp: string;
};

type SyncAllResult = {
  checked: number;
  stillPublished: number;
  deletedCount: number;
  errorCount: number;
};

// ─── PostRow ──────────────────────────────────────────────────────────────────

function PostRow({
  post,
  onPublish,
  onDeleteRow,
  onDeleteInstagram,
  onMarkManuallyDeleted,
  onArchive,
  onUnarchive,
  onSaveCaption,
  onSync,
  isPublishing,
  isDeletingRow,
  isDeletingInstagram,
  isMarkingManual,
  isArchiving,
  isUnarchiving,
  isSyncing,
  publishError,
  deleteInstagramError,
  syncError,
}: {
  post: IgPost;
  onPublish: (id: number) => void;
  onDeleteRow: (id: number) => void;
  onDeleteInstagram: (id: number) => void;
  onMarkManuallyDeleted: (id: number) => void;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
  onSaveCaption: (id: number, caption: string) => void;
  onSync: (id: number) => void;
  isPublishing: boolean;
  isDeletingRow: boolean;
  isDeletingInstagram: boolean;
  isMarkingManual: boolean;
  isArchiving: boolean;
  isUnarchiving: boolean;
  isSyncing: boolean;
  publishError: string | null;
  deleteInstagramError: string | null;
  syncError: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editCaption, setEditCaption] = useState(post.caption);
  const [isSaving, setIsSaving] = useState(false);

  async function saveCaption() {
    setIsSaving(true);
    try {
      await onSaveCaption(post.id, editCaption);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  const canPublish = post.status === "draft" || post.status === "ready" || post.status === "failed";
  const canRepublish = post.status === "deleted_on_instagram" || post.status === "deleted_by_dashboard";
  const canDeleteFromInstagram = post.status === "published" || post.status === "republished";
  const canSync = post.status === "published" || post.status === "republished";
  const canArchive = post.status !== "archived" && post.status !== "publishing" && post.status !== "republishing";
  const isInProgress = post.status === "publishing" || post.status === "republishing";
  const isDeletedState = post.status === "deleted_on_instagram" || post.status === "deleted_by_dashboard";
  const isArchived = post.status === "archived";

  const rowRing = isArchived
    ? "ring-slate-600/20"
    : isDeletedState
    ? "ring-orange-500/20"
    : "ring-white/5";

  return (
    <div className={`rounded-3xl bg-slate-950/80 ring-1 ${rowRing} ${isArchived ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-4 p-4">
        {/* Thumbnail */}
        <div className="shrink-0">
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image_url}
              alt="Post image"
              className={`h-16 w-16 rounded-xl object-cover ring-1 ring-white/10 ${isArchived ? "grayscale" : ""}`}
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-800 ring-1 ring-white/10">
              <svg className="h-5 w-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
              </svg>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editCaption}
                onChange={e => setEditCaption(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl bg-slate-800/80 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 outline-none focus:ring-fuchsia-500/40"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveCaption}
                  disabled={isSaving}
                  className="rounded-2xl bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsEditing(false); setEditCaption(post.caption); }}
                  className="rounded-2xl bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="line-clamp-2 text-sm leading-6 text-slate-200">{post.caption}</p>
          )}

          {/* Meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{formatRelative(post.created_at)}</span>
            {post.permalink && !isDeletedState && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-fuchsia-400 hover:text-fuchsia-300"
              >
                View on Instagram ↗
              </a>
            )}
            {post.media_id && (
              <span className="font-mono">media: {post.media_id}</span>
            )}
            {post.status === "deleted_on_instagram" && post.deleted_detected_at && (
              <span className="text-orange-400">
                Detected deleted: {formatDate(post.deleted_detected_at)}
              </span>
            )}
            {post.status === "deleted_by_dashboard" && post.deleted_at && (
              <span className="text-red-400">
                Deleted: {formatDate(post.deleted_at)}
              </span>
            )}
            {isArchived && post.archived_at && (
              <span>Archived: {formatDate(post.archived_at)}</span>
            )}
            {canSync && post.last_instagram_sync_at && (
              <span>Synced {formatRelative(post.last_instagram_sync_at)}</span>
            )}
            {post.republished_from_media_id && (
              <span className="text-teal-500">
                Republished · original: {post.original_media_id ?? "unknown"}
              </span>
            )}
          </div>

          {/* Error / warning messages — suppress stored errors on archived posts */}
          {publishError && (
            <p className="mt-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
              {publishError}
            </p>
          )}
          {post.error_message && post.status === "failed" && (
            <p className="mt-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
              {post.error_message}
            </p>
          )}
          {deleteInstagramError && (
            <p className="mt-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
              {deleteInstagramError}
            </p>
          )}
          {syncError && (
            <p className="mt-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-xs text-orange-300">
              Sync: {syncError}
            </p>
          )}
          {post.sync_error_message && !syncError && !isArchived && (
            <p className="mt-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-xs text-orange-300/70">
              Last sync error: {post.sync_error_message}
            </p>
          )}
          {post.sync_error_message && !syncError && isArchived && (
            <p className="mt-1.5 text-xs text-slate-600">
              Previous error: {post.sync_error_message}
            </p>
          )}
        </div>

        {/* Status badge + action buttons */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ring-1 ${STATUS_STYLES[post.status]}`}>
            {STATUS_LABEL[post.status]}
          </span>

          <div className="flex flex-col gap-1.5">
            {/* Edit caption */}
            {!isEditing && !isInProgress && !isArchived && post.status !== "published" && post.status !== "republished" && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                Edit
              </button>
            )}

            {/* Publish */}
            {canPublish && (
              post.image_url ? (
                <button
                  type="button"
                  onClick={() => onPublish(post.id)}
                  disabled={isPublishing}
                  className="rounded-2xl bg-fuchsia-500 px-3 py-1 text-xs font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-50"
                >
                  {isPublishing
                    ? <Spinner label="Publishing…" />
                    : post.status === "failed" ? "Retry" : "Publish"}
                </button>
              ) : (
                <span className="text-[10px] text-slate-600">No image</span>
              )
            )}

            {/* Republish */}
            {canRepublish && (
              <button
                type="button"
                onClick={() => onPublish(post.id)}
                disabled={isPublishing}
                className="rounded-2xl bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
              >
                {isPublishing ? <Spinner label="Republishing…" /> : "Republish"}
              </button>
            )}

            {/* Check Status (published / republished) */}
            {canSync && (
              <button
                type="button"
                onClick={() => onSync(post.id)}
                disabled={isSyncing}
                className="rounded-2xl bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50"
              >
                {isSyncing ? <Spinner label="Checking…" /> : "Check Status"}
              </button>
            )}

            {/* Delete from Instagram + manual fallback */}
            {canDeleteFromInstagram && (
              <>
                <button
                  type="button"
                  onClick={() => onDeleteInstagram(post.id)}
                  disabled={isDeletingInstagram}
                  className="rounded-2xl bg-red-900/40 px-3 py-1 text-xs text-red-300 hover:bg-red-800/60 disabled:opacity-50"
                >
                  {isDeletingInstagram ? <Spinner label="Deleting…" /> : "Delete from IG"}
                </button>
                <p className="text-right text-[10px] leading-tight text-slate-600">
                  Meta may block this.{"\n"}Delete in IG first if so.
                </p>
                <button
                  type="button"
                  onClick={() => onMarkManuallyDeleted(post.id)}
                  disabled={isMarkingManual}
                  className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-orange-400 hover:bg-orange-500/20 disabled:opacity-40"
                >
                  {isMarkingManual ? "…" : "I deleted it manually"}
                </button>
              </>
            )}

            {/* Hide from Dashboard (archive) */}
            {canArchive && (
              <button
                type="button"
                onClick={() => onArchive(post.id)}
                disabled={isArchiving}
                title="Hides this post from the dashboard. Does not affect Instagram."
                className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-slate-400 hover:bg-slate-700 disabled:opacity-40"
              >
                {isArchiving ? "…" : "Hide from Dashboard"}
              </button>
            )}

            {/* Restore to Library (unarchive) */}
            {isArchived && (
              <button
                type="button"
                onClick={() => onUnarchive(post.id)}
                disabled={isUnarchiving}
                className="rounded-2xl bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-40"
              >
                {isUnarchiving ? "…" : "Restore to Library"}
              </button>
            )}

            {/* Hard-delete row (always available, for permanent cleanup) */}
            <button
              type="button"
              onClick={() => onDeleteRow(post.id)}
              disabled={isDeletingRow || isPublishing || isInProgress}
              className="rounded-2xl bg-slate-800 px-3 py-1 text-xs text-rose-500/70 hover:bg-rose-500/20 disabled:opacity-40"
            >
              {isDeletingRow ? "…" : "Remove"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </span>
  );
}

// ─── PostLibrary ──────────────────────────────────────────────────────────────

export default function PostLibrary() {
  const [posts, setPosts]         = useState<IgPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [publishingId, setPublishingId]               = useState<number | null>(null);
  const [publishErrors, setPublishErrors]             = useState<Record<number, string>>({});
  const [deletingRowId, setDeletingRowId]             = useState<number | null>(null);
  const [deletingInstagramId, setDeletingInstagramId] = useState<number | null>(null);
  const [deleteInstagramErrors, setDeleteInstagramErrors] = useState<Record<number, string>>({});
  const [markManualId, setMarkManualId]               = useState<number | null>(null);
  const [archivingId, setArchivingId]                 = useState<number | null>(null);
  const [unarchivingId, setUnarchivingId]             = useState<number | null>(null);
  const [syncingId, setSyncingId]                     = useState<number | null>(null);
  const [syncErrors, setSyncErrors]                   = useState<Record<number, string>>({});
  const [isSyncingAll, setIsSyncingAll]               = useState(false);
  const [syncAllResult, setSyncAllResult]             = useState<SyncAllResult | null>(null);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/ig-posts");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to load posts.");
      setPosts(data.posts as IgPost[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ── Publish / Republish ───────────────────────────────────────────────────
  async function handlePublish(id: number) {
    setPublishingId(id);
    setPublishErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const res = await apiFetch(`/api/ig-posts/${id}/publish`, { method: "POST" });
      const data = await res.json() as { success: boolean; error?: string; logs?: LogEntry[] };
      if (!res.ok || !data.success) {
        setPublishErrors(prev => ({ ...prev, [id]: data.error ?? "Publish failed." }));
      } else {
        await fetchPosts();
      }
    } catch (e) {
      setPublishErrors(prev => ({ ...prev, [id]: e instanceof Error ? e.message : "Publish failed." }));
    } finally {
      setPublishingId(null);
    }
  }

  // ── Delete row (hard delete from DB) ─────────────────────────────────────
  async function handleDeleteRow(id: number) {
    if (!confirm("Permanently remove this post from the dashboard? This cannot be undone.")) return;
    setDeletingRowId(id);
    try {
      const res = await apiFetch(`/api/ig-posts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error ?? "Delete failed.");
      } else {
        setPosts(prev => prev.filter(p => p.id !== id));
      }
    } finally {
      setDeletingRowId(null);
    }
  }

  // ── Delete from Instagram ─────────────────────────────────────────────────
  async function handleDeleteInstagram(id: number) {
    const post = posts.find(p => p.id === id);
    const label = post?.media_id ? `media ID ${post.media_id}` : "this post";
    if (
      !confirm(
        `Delete ${label} from Instagram?\n\n` +
        "• The Instagram post will be permanently deleted.\n" +
        "• Your dashboard row will be kept so you can republish later.\n\n" +
        "This cannot be undone."
      )
    ) return;

    setDeletingInstagramId(id);
    setDeleteInstagramErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const res = await apiFetch(`/api/ig-posts/${id}/delete-instagram`, { method: "POST" });
      const data = await res.json() as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        setDeleteInstagramErrors(prev => ({ ...prev, [id]: data.error ?? "Delete failed." }));
      } else {
        await fetchPosts();
      }
    } catch (e) {
      setDeleteInstagramErrors(prev => ({
        ...prev,
        [id]: e instanceof Error ? e.message : "Delete from Instagram failed.",
      }));
    } finally {
      setDeletingInstagramId(null);
    }
  }

  // ── Mark manually deleted (no Instagram API call) ────────────────────────
  async function handleMarkManuallyDeleted(id: number) {
    if (
      !confirm(
        "Mark this post as deleted on Instagram?\n\n" +
        "• Only use this if you already deleted it inside Instagram.\n" +
        "• The dashboard row will be kept and Republish will become available.\n" +
        "• No Instagram API call is made."
      )
    ) return;

    setMarkManualId(id);
    try {
      const now = new Date().toISOString();
      const res = await apiFetch(`/api/ig-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "deleted_on_instagram",
          deleted_detected_at: now,
          deleted_at: null,
          sync_error_message: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error ?? "Failed to update post status.");
      } else {
        await fetchPosts();
      }
    } finally {
      setMarkManualId(null);
    }
  }

  // ── Archive (hide from dashboard — no Instagram API call) ────────────────
  async function handleArchive(id: number) {
    const post = posts.find(p => p.id === id);
    if (!post) return;
    setArchivingId(id);
    try {
      const now = new Date().toISOString();
      const res = await apiFetch(`/api/ig-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "archived",
          previous_status: post.status,
          archived_at: now,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error ?? "Archive failed.");
      } else {
        await fetchPosts();
      }
    } finally {
      setArchivingId(null);
    }
  }

  // ── Unarchive (restore — no Instagram API call) ───────────────────────────
  async function handleUnarchive(id: number) {
    const post = posts.find(p => p.id === id);
    if (!post) return;
    setUnarchivingId(id);
    try {
      const restoredStatus = post.previous_status ?? (post.media_id ? "published" : "draft");
      const res = await apiFetch(`/api/ig-posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: restoredStatus,
          previous_status: null,
          archived_at: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error ?? "Restore failed.");
      } else {
        await fetchPosts();
      }
    } finally {
      setUnarchivingId(null);
    }
  }

  // ── Save caption ──────────────────────────────────────────────────────────
  async function handleSaveCaption(id: number, caption: string) {
    const res = await apiFetch(`/api/ig-posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? "Save failed.");
    setPosts(prev => prev.map(p => p.id === id ? { ...p, caption } : p));
  }

  // ── Single sync ───────────────────────────────────────────────────────────
  async function handleSync(id: number) {
    setSyncingId(id);
    setSyncErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const res = await apiFetch(`/api/ig-posts/${id}/sync`, { method: "POST" });
      const data = await res.json() as { success: boolean; result?: string; error?: string };
      if (!res.ok || !data.success) {
        setSyncErrors(prev => ({ ...prev, [id]: data.error ?? "Sync failed." }));
      } else {
        await fetchPosts();
      }
    } catch (e) {
      setSyncErrors(prev => ({ ...prev, [id]: e instanceof Error ? e.message : "Sync failed." }));
    } finally {
      setSyncingId(null);
    }
  }

  // ── Bulk sync ─────────────────────────────────────────────────────────────
  async function handleSyncAll() {
    setIsSyncingAll(true);
    setSyncAllResult(null);
    try {
      const res = await apiFetch("/api/ig-posts/sync-published", { method: "POST" });
      const data = await res.json() as { success: boolean; error?: string } & Partial<SyncAllResult>;
      if (!res.ok || !data.success) {
        alert(data.error ?? "Bulk sync failed.");
      } else {
        setSyncAllResult({
          checked: data.checked ?? 0,
          stillPublished: data.stillPublished ?? 0,
          deletedCount: data.deletedCount ?? 0,
          errorCount: data.errorCount ?? 0,
        });
        await fetchPosts();
      }
    } finally {
      setIsSyncingAll(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const visiblePosts = showArchived
    ? posts
    : posts.filter(p => p.status !== "archived");

  const archivedCount = posts.filter(p => p.status === "archived").length;
  const publishedOrRepublished = posts.filter(
    p => p.status === "published" || p.status === "republished"
  ).length;

  const counts = {
    total:     visiblePosts.length,
    draft:     visiblePosts.filter(p => p.status === "draft").length,
    published: visiblePosts.filter(p => p.status === "published" || p.status === "republished").length,
    deleted:   visiblePosts.filter(p => p.status === "deleted_on_instagram" || p.status === "deleted_by_dashboard").length,
    failed:    visiblePosts.filter(p => p.status === "failed").length,
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Post Library</h2>
          <p className="mt-1 text-sm text-slate-400">
            Drafts, published posts, and deletion history. Archive to hide, or delete from Instagram.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
            {isLoading ? "…" : `${counts.total} posts`}
          </span>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived(v => !v)}
              className={`rounded-3xl px-3 py-1.5 text-xs font-semibold transition ${
                showArchived
                  ? "bg-slate-600 text-slate-100 hover:bg-slate-500"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {showArchived ? `Hide hidden posts (${archivedCount})` : `Show hidden posts (${archivedCount})`}
            </button>
          )}
          {publishedOrRepublished > 0 && (
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={isSyncingAll || isLoading}
              className="rounded-3xl bg-teal-700/60 px-3 py-1.5 text-xs font-semibold text-teal-200 transition hover:bg-teal-600/60 disabled:opacity-50"
            >
              {isSyncingAll ? <Spinner label="Syncing…" /> : "Sync Published Posts"}
            </button>
          )}
          <button
            type="button"
            onClick={fetchPosts}
            disabled={isLoading}
            className="rounded-3xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-600 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Sync-all result banner */}
      {syncAllResult && (
        <div className="mt-3 rounded-2xl bg-teal-500/10 px-4 py-2.5 text-xs text-teal-200 ring-1 ring-teal-400/20">
          Sync complete — {syncAllResult.checked} checked · {syncAllResult.stillPublished} still live
          {syncAllResult.deletedCount > 0 && ` · ${syncAllResult.deletedCount} deleted`}
          {syncAllResult.errorCount > 0 && ` · ${syncAllResult.errorCount} error${syncAllResult.errorCount !== 1 ? "s" : ""}`}
        </div>
      )}

      {/* Stats pills */}
      {!isLoading && visiblePosts.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {counts.draft > 0 && (
            <span className="rounded-full bg-slate-700/60 px-3 py-1 text-xs text-slate-300 ring-1 ring-slate-500/20">
              {counts.draft} draft{counts.draft !== 1 ? "s" : ""}
            </span>
          )}
          {counts.published > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 ring-1 ring-emerald-400/20">
              {counts.published} published
            </span>
          )}
          {counts.deleted > 0 && (
            <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs text-orange-300 ring-1 ring-orange-400/20">
              {counts.deleted} deleted
            </span>
          )}
          {counts.failed > 0 && (
            <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs text-rose-300 ring-1 ring-rose-400/20">
              {counts.failed} failed
            </span>
          )}
        </div>
      )}

      {/* Post list */}
      <div className="mt-6 space-y-3">
        {isLoading ? (
          [1, 2, 3].map(n => (
            <div key={n} className="h-24 animate-pulse rounded-3xl bg-slate-800/60" />
          ))
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : visiblePosts.length === 0 ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            No posts yet. Use Create Post above to add your first post.
          </p>
        ) : (
          visiblePosts.map(post => (
            <PostRow
              key={post.id}
              post={post}
              onPublish={handlePublish}
              onDeleteRow={handleDeleteRow}
              onDeleteInstagram={handleDeleteInstagram}
              onMarkManuallyDeleted={handleMarkManuallyDeleted}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onSaveCaption={handleSaveCaption}
              onSync={handleSync}
              isPublishing={publishingId === post.id}
              isDeletingRow={deletingRowId === post.id}
              isDeletingInstagram={deletingInstagramId === post.id}
              isMarkingManual={markManualId === post.id}
              isArchiving={archivingId === post.id}
              isUnarchiving={unarchivingId === post.id}
              isSyncing={syncingId === post.id}
              publishError={publishErrors[post.id] ?? null}
              deleteInstagramError={deleteInstagramErrors[post.id] ?? null}
              syncError={syncErrors[post.id] ?? null}
            />
          ))
        )}
      </div>
    </section>
  );
}
