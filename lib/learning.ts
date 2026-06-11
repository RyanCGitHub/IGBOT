// Active-learnings helpers. Injected into generation prompts so the AI favors
// what has worked for an account. No-op when an account has no active learnings.

import { supabaseServer } from "@/lib/supabase-server";
import type { Learning } from "@/lib/supabase";

const MAX_INJECTED = 15;

export async function getActiveLearnings(accountId: number | null | undefined): Promise<Learning[]> {
  if (accountId == null) return [];
  const { data } = await supabaseServer
    .from("learnings")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(MAX_INJECTED);
  return (data as Learning[]) ?? [];
}

export function learningsPromptBlock(learnings: Learning[]): string {
  if (!learnings.length) return "";
  const lines = learnings.map(l => `- ${l.finding}`);
  return [
    "Apply these data-backed learnings for this account (favor what worked, avoid what underperformed):",
    ...lines,
  ].join("\n");
}
