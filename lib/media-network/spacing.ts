// Per-account posting spacing (anti-burst rule, plan §posting rules). The
// window comes from the media_brand attached to the account; accounts without
// a brand (e.g. Finn's reels account) are unconstrained unless
// POSTS_MIN_SPACING_MINUTES sets a global floor.

import { supabaseServer } from "@/lib/supabase-server";

export type SpacingVerdict = { allowed: true } | { allowed: false; waitMinutes: number };

export async function checkPostingSpacing(accountId: number): Promise<SpacingVerdict> {
  let windowMinutes = 0;

  const { data: brand } = await supabaseServer
    .from("media_brands")
    .select("min_minutes_between_posts")
    .eq("connected_account_id", accountId)
    .eq("status", "active")
    .order("min_minutes_between_posts", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (brand?.min_minutes_between_posts) windowMinutes = brand.min_minutes_between_posts;

  const globalFloor = Number(process.env.POSTS_MIN_SPACING_MINUTES);
  if (Number.isFinite(globalFloor) && globalFloor > windowMinutes) windowMinutes = globalFloor;

  if (windowMinutes <= 0) return { allowed: true };

  const { data: last } = await supabaseServer
    .from("ig_posts")
    .select("published_at")
    .eq("account_id", accountId)
    .in("status", ["published", "republished"])
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!last?.published_at) return { allowed: true };

  const elapsedMin = (Date.now() - new Date(last.published_at).getTime()) / 60_000;
  if (elapsedMin >= windowMinutes) return { allowed: true };
  return { allowed: false, waitMinutes: Math.ceil(windowMinutes - elapsedMin) };
}
