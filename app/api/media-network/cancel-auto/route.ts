import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { requireApiKey } from "@/lib/auth";
import type { ContentPackage } from "@/lib/media-network/types";

// Cancel a scheduled auto-publish before it goes out: archive the linked
// ig_post (so process-scheduled skips it) and the package. Refuses if the post
// already published.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { package_id?: number };
  try { body = (await request.json()) as typeof body; }
  catch { return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }); }

  const pkgId = Number(body.package_id);
  if (!Number.isInteger(pkgId) || pkgId < 1) {
    return NextResponse.json({ success: false, error: "package_id is required." }, { status: 400 });
  }

  const { data: pkg } = await supabaseServer.from("content_packages").select("*").eq("id", pkgId).single<ContentPackage>();
  if (!pkg) return NextResponse.json({ success: false, error: "Package not found." }, { status: 404 });

  const now = new Date().toISOString();

  if (pkg.linked_ig_post_id) {
    const { data: post } = await supabaseServer
      .from("ig_posts").select("status").eq("id", pkg.linked_ig_post_id).single();
    if (post?.status === "published" || post?.status === "republished") {
      return NextResponse.json({ success: false, error: "Already published — can't cancel." }, { status: 409 });
    }
    await supabaseServer.from("ig_posts")
      .update({ status: "draft", archived_at: now, updated_at: now })
      .eq("id", pkg.linked_ig_post_id);
  }

  await supabaseServer.from("content_packages")
    .update({ status: "archived", updated_at: now })
    .eq("id", pkg.id);

  return NextResponse.json({ success: true });
}
