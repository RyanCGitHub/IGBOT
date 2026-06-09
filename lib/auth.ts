import { NextResponse } from "next/server";

// Checks the x-app-api-key header against NEXT_PUBLIC_APP_INTERNAL_API_KEY.
// Returns a 401 NextResponse when the check fails, null when it passes.
//
// The NEXT_PUBLIC_ prefix is intentional: browser-side components must be able
// to include the key in fetch headers. This is an internal shared secret for a
// single-user tool — it stops bots and scanners, not determined attackers.
//
// If the env var is not set the check is skipped entirely, keeping local
// development zero-config.
export function requireApiKey(request: Request): NextResponse | null {
  const configuredKey = process.env.NEXT_PUBLIC_APP_INTERNAL_API_KEY;
  if (!configuredKey) return null;

  const provided = request.headers.get("x-app-api-key");
  if (!provided || provided !== configuredKey) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }
  return null;
}
