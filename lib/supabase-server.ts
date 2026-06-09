import { createClient } from "@supabase/supabase-js";

// This file must only be imported from server-side code (API routes, Server
// Components, Server Actions). It uses the service role key, which bypasses
// Row Level Security and must never reach the browser.
//
// The table connected_accounts has RLS enabled with zero policies, so the
// anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) cannot access it at all.
// This client is the only way to read or write that table.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "This client is server-only — do not import it in client components."
  );
}

export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    // Disable session persistence and token refresh — this is a stateless
    // server client, not a user session.
    persistSession: false,
    autoRefreshToken: false,
  },
});
