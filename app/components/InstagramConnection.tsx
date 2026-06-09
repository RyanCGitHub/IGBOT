"use client";

import { useState, useEffect, useCallback } from "react";
import type { ConnectedAccount } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You declined the Instagram connection request.",
  missing_code: "OAuth response was missing an authorization code.",
  state_mismatch: "Security check failed. Please try again.",
  not_configured:
    "META_APP_ID or META_APP_SECRET is not set on the server.",
  token_exchange_failed:
    "Could not exchange the authorization code for an access token.",
  long_lived_token_failed: "Could not upgrade to a long-lived token.",
  pages_fetch_failed: "Could not retrieve your Facebook Pages.",
  no_ig_account:
    "No Instagram Business account was found linked to any of your Facebook Pages. Make sure your IG account is connected to a Page in Meta Business Suite.",
  db_write_failed: "Account info was retrieved but could not be saved.",
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function daysUntilExpiry(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

export default function InstagramConnection() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // Read outcome URL params that Meta redirects back with, then clean the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const instagram = params.get("instagram");
    const reason = params.get("reason") ?? "";

    if (instagram === "connected") {
      setBanner({
        kind: "success",
        text: "Instagram account connected successfully.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (instagram === "error") {
      setBanner({
        kind: "error",
        text:
          ERROR_MESSAGES[reason] ??
          "Instagram connection failed. Please try again.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/meta/accounts");
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to load accounts.");
      setAccounts(data.accounts as ConnectedAccount[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/25">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            Instagram Connection
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Connect your Instagram Business account to enable publishing.
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-[0.25em] text-slate-300">
          Meta OAuth
        </span>
      </div>

      <div className="mt-6 space-y-4">
        {banner ? (
          <div
            className={`rounded-3xl p-4 text-sm ${
              banner.kind === "success"
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {banner.text}
          </div>
        ) : null}

        {isLoading ? (
          <div className="h-20 animate-pulse rounded-3xl bg-slate-800/60" />
        ) : loadError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {loadError}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-center justify-between gap-4 rounded-3xl bg-slate-950/80 px-5 py-5 ring-1 ring-white/5">
            <div>
              <p className="text-sm font-semibold text-white">
                No account connected
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Requires an Instagram Business or Creator account linked to a
                Facebook Page.
              </p>
            </div>
            <a
              href="/api/meta/login"
              className="inline-flex shrink-0 items-center rounded-3xl bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400"
            >
              Connect Instagram
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const days = daysUntilExpiry(account.token_expires_at);
              const expiringSoon = days !== null && days < 7;
              return (
                <div
                  key={account.id}
                  className="flex items-center justify-between gap-4 rounded-3xl bg-slate-950/80 px-5 py-4 ring-1 ring-white/5"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">
                        @{account.account_name}
                      </p>
                      {expiringSoon && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-300 ring-1 ring-amber-400/20">
                          Token expires in {days}d
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      IG User ID: {account.ig_user_id} &middot; Connected{" "}
                      {formatRelativeTime(account.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-300 ring-1 ring-emerald-400/20">
                      Connected
                    </span>
                    <a
                      href="/api/meta/login"
                      className="rounded-2xl bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-600"
                    >
                      Reconnect
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
