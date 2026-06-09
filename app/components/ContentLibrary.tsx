"use client";

import { useState, useEffect, useCallback } from "react";
import type { Post, PostStatus } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";

type PostFormState = {
  title: string;
  caption: string;
  hashtags: string;
  status: PostStatus;
};

const EMPTY_FORM: PostFormState = {
  title: "",
  caption: "",
  hashtags: "",
  status: "draft",
};

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: "text-slate-300 bg-slate-700/60 ring-slate-600/40",
  approved: "text-blue-300 bg-blue-500/10 ring-blue-400/20",
  scheduled: "text-amber-300 bg-amber-500/10 ring-amber-400/20",
  posted: "text-emerald-300 bg-emerald-500/10 ring-emerald-400/20",
};

// ─── PostForm ────────────────────────────────────────────────────────────────

type PostFormProps = {
  form: PostFormState;
  onChange: (f: PostFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
  submitLabel: string;
};

function PostForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
  submitLabel,
}: PostFormProps) {
  return (
    <div className="rounded-3xl border border-fuchsia-500/20 bg-slate-950/80 p-5 ring-1 ring-white/5">
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Title"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          className="w-full rounded-2xl bg-slate-800/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
        />
        <textarea
          placeholder="Caption"
          value={form.caption}
          onChange={(e) => onChange({ ...form, caption: e.target.value })}
          rows={4}
          className="w-full resize-none rounded-2xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
        />
        <input
          type="text"
          placeholder="Hashtags  (e.g. #fashion #style #ootd)"
          value={form.hashtags}
          onChange={(e) => onChange({ ...form, hashtags: e.target.value })}
          className="w-full rounded-2xl bg-slate-800/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
        />
        <div className="flex items-center justify-between gap-3">
          <select
            value={form.status}
            onChange={(e) =>
              onChange({ ...form, status: e.target.value as PostStatus })
            }
            className="rounded-2xl bg-slate-800/80 px-4 py-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-fuchsia-500/40"
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="rounded-3xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-600"
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </button>
          </div>
        </div>
        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── PostCard ─────────────────────────────────────────────────────────────────

type PostCardProps = {
  post: Post;
  isStatusUpdating: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: PostStatus) => void;
};

function PostCard({
  post,
  isStatusUpdating,
  onEdit,
  onDelete,
  onStatusChange,
}: PostCardProps) {
  return (
    <div className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{post.title}</p>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
            {post.caption}
          </p>
          {post.hashtags ? (
            <p className="mt-2 text-xs text-fuchsia-400/80">{post.hashtags}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <select
            value={post.status}
            onChange={(e) => onStatusChange(e.target.value as PostStatus)}
            disabled={isStatusUpdating}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] outline-none ring-1 transition disabled:cursor-wait disabled:opacity-50 ${STATUS_STYLES[post.status]}`}
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-2xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-600"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-2xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-rose-600 hover:text-white"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DeleteConfirm ────────────────────────────────────────────────────────────

type DeleteConfirmProps = {
  post: Post;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

function DeleteConfirm({ post, isDeleting, error, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-rose-500/20">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{post.title}</p>
          <p className="mt-1 text-sm text-slate-400">
            Delete this post? This cannot be undone.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-3xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-3xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600"
          >
            Cancel
          </button>
        </div>
      </div>
      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ─── ContentLibrary ───────────────────────────────────────────────────────────

export default function ContentLibrary() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<PostFormState>(EMPTY_FORM);
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<PostFormState>(EMPTY_FORM);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [statusUpdatingId, setStatusUpdatingId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/posts");
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to load posts.");
      setPosts(data.posts as Post[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  async function handleCreate() {
    if (!newForm.title.trim() || !newForm.caption.trim()) {
      setNewError("Title and caption are required.");
      return;
    }
    setIsSubmittingNew(true);
    setNewError(null);
    try {
      const res = await apiFetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to create post.");
      setPosts((prev) => [data.post as Post, ...prev]);
      setIsCreating(false);
      setNewForm(EMPTY_FORM);
    } catch (e) {
      setNewError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmittingNew(false);
    }
  }

  function startEdit(post: Post) {
    setEditingId(post.id);
    setEditForm({
      title: post.title,
      caption: post.caption,
      hashtags: post.hashtags,
      status: post.status,
    });
    setEditError(null);
    setConfirmDeleteId(null);
  }

  async function handleSaveEdit() {
    if (!editForm.title.trim() || !editForm.caption.trim()) {
      setEditError("Title and caption are required.");
      return;
    }
    if (editingId === null) return;
    setIsSubmittingEdit(true);
    setEditError(null);
    try {
      const res = await apiFetch(`/api/posts/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to update post.");
      setPosts((prev) =>
        prev.map((p) => (p.id === editingId ? (data.post as Post) : p))
      );
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  async function handleDelete(id: number) {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await apiFetch(`/api/posts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to delete post.");
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null); // close only on success
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      // keep the confirm dialog open so the user can retry or cancel
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleStatusChange(id: number, status: PostStatus) {
    setStatusUpdatingId(id);
    setStatusError(null);
    try {
      const post = posts.find((p) => p.id === id);
      if (!post) return;
      const res = await apiFetch(`/api/posts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: post.title,
          caption: post.caption,
          hashtags: post.hashtags,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to update status.");
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status } : p))
      );
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
      // status in local state is unchanged — the select reverts visually
    } finally {
      setStatusUpdatingId(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Content Library</h2>
          <p className="mt-1 text-sm text-slate-400">
            Create, edit, and track posts across all stages.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
            {isLoading ? "…" : `${posts.length} posts`}
          </span>
          {!isCreating && (
            <button
              type="button"
              onClick={() => {
                setIsCreating(true);
                setNewForm(EMPTY_FORM);
                setNewError(null);
                setEditingId(null);
                setConfirmDeleteId(null);
              }}
              className="rounded-3xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400"
            >
              New Post
            </button>
          )}
        </div>
      </div>

      {statusError ? (
        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          Status update failed: {statusError}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {isCreating && (
          <PostForm
            form={newForm}
            onChange={setNewForm}
            onSubmit={handleCreate}
            onCancel={() => setIsCreating(false)}
            isSubmitting={isSubmittingNew}
            error={newError}
            submitLabel="Create Post"
          />
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-28 animate-pulse rounded-3xl bg-slate-800/60"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {loadError}
          </div>
        ) : posts.length === 0 && !isCreating ? (
          <p className="rounded-3xl bg-slate-950/80 px-5 py-6 text-sm text-slate-400 ring-1 ring-white/5">
            No posts yet. Click New Post to get started.
          </p>
        ) : (
          posts.map((post) => {
            if (editingId === post.id) {
              return (
                <PostForm
                  key={post.id}
                  form={editForm}
                  onChange={setEditForm}
                  onSubmit={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  isSubmitting={isSubmittingEdit}
                  error={editError}
                  submitLabel="Save Changes"
                />
              );
            }

            if (confirmDeleteId === post.id) {
              return (
                <DeleteConfirm
                  key={post.id}
                  post={post}
                  isDeleting={isDeleting}
                  error={deleteError}
                  onConfirm={() => handleDelete(post.id)}
                  onCancel={() => {
                    setConfirmDeleteId(null);
                    setDeleteError(null);
                  }}
                />
              );
            }

            return (
              <PostCard
                key={post.id}
                post={post}
                isStatusUpdating={statusUpdatingId === post.id}
                onEdit={() => startEdit(post)}
                onDelete={() => {
                  setConfirmDeleteId(post.id);
                  setDeleteError(null);
                  setEditingId(null);
                }}
                onStatusChange={(status) => handleStatusChange(post.id, status)}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
