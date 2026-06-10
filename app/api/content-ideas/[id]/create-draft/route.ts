import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";

type Params = { id: string };

// ─── POST: turn a saved idea into a draft ig_post ───────────────────────────────
// Creates a draft only. Never publishes, never schedules. The account comes from
// the idea's campaign (if it has one); publishing later still enforces account choice.

export async function POST(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const ideaId = Number(id);
  if (!Number.isInteger(ideaId) || ideaId < 1) {
    return NextResponse.json({ success: false, error: "Invalid idea id." }, { status: 400 });
  }

  // ── Fetch the idea ──────────────────────────────────────────────────────────
  const { data: idea, error: ideaErr } = await supabaseServer
    .from("content_ideas")
    .select("*")
    .eq("id", ideaId)
    .single();

  if (ideaErr || !idea) {
    return NextResponse.json({ success: false, error: "Idea not found." }, { status: 404 });
  }

  // ── Resolve the campaign's account (optional) ───────────────────────────────
  const { data: campaign } = await supabaseServer
    .from("campaigns")
    .select("id, account_id")
    .eq("id", idea.campaign_id)
    .single();

  const accountId: number | null = campaign?.account_id ?? null;

  // ── Compose a starting caption from the idea fields ─────────────────────────
  const caption =
    [idea.caption_angle, idea.cta, idea.hashtags]
      .map((s: string | null) => (s ? s.trim() : ""))
      .filter(Boolean)
      .join("\n\n") || idea.title;

  // ── Create the draft post ───────────────────────────────────────────────────
  const { data: post, error: postErr } = await supabaseServer
    .from("ig_posts")
    .insert({
      title: idea.title,
      caption,
      account_id: accountId,
      campaign_id: idea.campaign_id,
      status: "draft",
    })
    .select("*")
    .single();

  if (postErr || !post) {
    return NextResponse.json(
      { success: false, error: postErr?.message ?? "Failed to create draft." },
      { status: 500 }
    );
  }

  // ── Link the idea to its draft (best-effort; draft already exists either way) ─
  const { error: linkErr } = await supabaseServer
    .from("content_ideas")
    .update({ converted_post_id: post.id, updated_at: new Date().toISOString() })
    .eq("id", ideaId);

  if (linkErr) {
    console.error(`[content-ideas/create-draft] idea ${ideaId} → post ${post.id} created, but link update failed: ${linkErr.message}`);
  }

  console.log(`[content-ideas/create-draft] idea ${ideaId} → draft post ${post.id} (account ${accountId ?? "none"})`);

  return NextResponse.json({ success: true, post }, { status: 201 });
}
