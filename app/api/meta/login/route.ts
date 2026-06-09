import { NextResponse } from "next/server";

export async function GET() {
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.NEXT_PUBLIC_META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "Meta OAuth is not configured. Set META_APP_ID and NEXT_PUBLIC_META_REDIRECT_URI." },
      { status: 500 }
    );
  }

  // One-time CSRF token stored in a short-lived httpOnly cookie
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "instagram_basic,pages_show_list,instagram_content_publish",
    response_type: "code",
    state,
  });

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  const response = NextResponse.redirect(oauthUrl);

  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes — enough time to complete the OAuth dialog
    path: "/",
  });

  return response;
}
