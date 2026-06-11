import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireCronOrApiKey, publishingPaused, pausedResponse } from "@/lib/cron-auth";

// Daily planner. For every account with autopilot enabled, tops the day up to
// reels_daily_cap queued runs; the tick cron does everything after that.
// POST {account_id} from the dashboard force-queues one run for that account
// regardless of the autopilot flag (manual "make me a reel now").
export const dynamic = "force-dynamic";

type AccountRow = { id: number; account_name: string; reels_autopilot_enabled: boolean; reels_daily_cap: number };

async function runsCreatedToday(accountId: number): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await supabaseServer
    .from("reel_runs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .neq("status", "failed") // failed runs don't consume the day's budget
    .gte("created_at", dayStart.toISOString());
  return count ?? 0;
}

async function plan(forceAccountId?: number): Promise<NextResponse> {
  let accounts: AccountRow[];

  if (forceAccountId) {
    const { data, error } = await supabaseServer
      .from("connected_accounts")
      .select("id, account_name, reels_autopilot_enabled, reels_daily_cap")
      .eq("id", forceAccountId)
      .single();
    if (error || !data) {
      return NextResponse.json({ success: false, error: "Account not found." }, { status: 404 });
    }
    accounts = [data as AccountRow];
  } else {
    const { data, error } = await supabaseServer
      .from("connected_accounts")
      .select("id, account_name, reels_autopilot_enabled, reels_daily_cap")
      .eq("reels_autopilot_enabled", true);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    accounts = (data ?? []) as AccountRow[];
  }

  const created: { account_id: number; account: string; run_id: number }[] = [];

  for (const account of accounts) {
    // Manual kick always queues exactly one; the cron tops up to the daily cap.
    const toCreate = forceAccountId
      ? 1
      : Math.max((account.reels_daily_cap ?? 1) - await runsCreatedToday(account.id), 0);

    for (let i = 0; i < toCreate; i++) {
      const { data: run, error: insErr } = await supabaseServer
        .from("reel_runs")
        .insert({ account_id: account.id, status: "queued" })
        .select("id")
        .single();
      if (insErr || !run) {
        console.error(`[reels/plan] failed to queue run for @${account.account_name}: ${insErr?.message}`);
        continue;
      }
      created.push({ account_id: account.id, account: account.account_name, run_id: run.id as number });
    }
  }

  console.log(`[reels/plan] queued ${created.length} run(s) across ${accounts.length} account(s)`);
  return NextResponse.json({ success: true, accountsConsidered: accounts.length, created });
}

// Vercel cron (GET) tops up all autopilot accounts daily.
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();
  return plan();
}

// Dashboard (POST) — optional {account_id} to force-queue one run now.
export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;
  if (publishingPaused()) return pausedResponse();

  let accountId: number | undefined;
  try {
    const body = (await request.json()) as { account_id?: number };
    if (body.account_id != null) {
      accountId = Number(body.account_id);
      if (!Number.isInteger(accountId) || accountId < 1) {
        return NextResponse.json({ success: false, error: "Invalid account_id." }, { status: 400 });
      }
    }
  } catch {
    // empty body → behave like the cron
  }
  return plan(accountId);
}
