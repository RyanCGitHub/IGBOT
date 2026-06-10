import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// ─── Meta Graph API response shapes ──────────────────────────────────────────

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string; type: string; code: number };
};

type IGBusinessAccount = {
  id: string;
  username?: string;
  name?: string;
};

type FBPage = {
  id: string;
  name: string;
  instagram_business_account?: IGBusinessAccount;
};

type PagesResponse = {
  data?: FBPage[];
  error?: { message: string };
};

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_META_REDIRECT_URI;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const storedState = request.cookies.get("meta_oauth_state")?.value;

  // Build a redirect that lands on the dashboard with an outcome param
  function redirect(instagram: string, reason?: string) {
    const dest = new URL("/", url.origin);
    dest.searchParams.set("instagram", instagram);
    if (reason) dest.searchParams.set("reason", reason);
    const res = NextResponse.redirect(dest);
    res.cookies.delete("meta_oauth_state");
    return res;
  }

  // --- Guard rails (never reach Meta APIs if these fail) ---
  if (errorParam) return redirect("error", "access_denied");
  if (!code) return redirect("error", "missing_code");
  if (!returnedState || returnedState !== storedState) {
    return redirect("error", "state_mismatch");
  }
  if (!appId || !appSecret || !redirectUri) {
    return redirect("error", "not_configured");
  }

  // --- Step 1: exchange code for short-lived user token ---
  const shortTokenParams = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret, // server-only, never reaches the browser
    redirect_uri: redirectUri,
    code,
  });

  const shortTokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${shortTokenParams}`
  );
  const shortTokenData = (await shortTokenRes.json()) as TokenResponse;

  if (!shortTokenData.access_token) {
    return redirect("error", "token_exchange_failed");
  }

  // --- Step 2: exchange short-lived token for long-lived token (~60 days) ---
  const llParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortTokenData.access_token,
  });

  const llRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${llParams}`
  );
  const llData = (await llRes.json()) as TokenResponse;

  if (!llData.access_token) {
    return redirect("error", "long_lived_token_failed");
  }

  const longLivedToken = llData.access_token;
  const expiresInSeconds = llData.expires_in ?? 5_184_000; // default 60 days
  const tokenExpiresAt = new Date(
    Date.now() + expiresInSeconds * 1000
  ).toISOString();

  // --- Step 3: get FB pages with linked Instagram business accounts ---
  const pagesUrl = new URL("https://graph.facebook.com/v21.0/me/accounts");
  pagesUrl.searchParams.set(
    "fields",
    "id,name,instagram_business_account{id,username,name}"
  );
  pagesUrl.searchParams.set("access_token", longLivedToken);

  const pagesRes = await fetch(pagesUrl.toString());
  const pagesData = (await pagesRes.json()) as PagesResponse;

  if (!pagesData.data) {
    return redirect("error", "pages_fetch_failed");
  }

  // Collect every Facebook Page that has a linked IG Business account.
  // A user may manage multiple Pages, each with its own IG account.
  const pagesWithIG = pagesData.data.filter(
    (page) => page.instagram_business_account?.id
  );

  console.log(
    `[meta/callback] Pages returned: ${pagesData.data.length} · with IG account: ${pagesWithIG.length}`
  );

  if (pagesWithIG.length === 0) {
    return redirect("error", "no_ig_account");
  }

  // --- Step 4: upsert every found IG account into connected_accounts ---
  // ig_user_id has a unique index — reconnecting the same account refreshes the token.
  // access_token is stored server-side and never returned to the client.
  // Each account is upserted independently so one failure doesn't block the others.
  let savedCount = 0;
  let failedCount = 0;

  for (const page of pagesWithIG) {
    const igAccount = page.instagram_business_account!;
    const accountName = igAccount.username ?? igAccount.name ?? page.name;

    const { error: dbError } = await supabaseServer
      .from("connected_accounts")
      .upsert(
        {
          platform: "instagram",
          account_name: accountName,
          ig_user_id: igAccount.id,
          access_token: longLivedToken,
          token_expires_at: tokenExpiresAt,
        },
        { onConflict: "ig_user_id" }
      );

    if (dbError) {
      failedCount++;
      // Log the account name (public) and error message — never the token.
      console.error(
        `[meta/callback] Failed to save @${accountName} (ig_user_id ${igAccount.id}): ${dbError.message}`
      );
    } else {
      savedCount++;
      console.log(
        `[meta/callback] Saved @${accountName} (ig_user_id ${igAccount.id})`
      );
    }
  }

  console.log(
    `[meta/callback] IG accounts found: ${pagesWithIG.length} · saved: ${savedCount} · failed: ${failedCount}`
  );

  // If every account failed to save, surface the DB error.
  if (savedCount === 0) {
    return redirect("error", "db_write_failed");
  }

  return redirect("connected");
}
