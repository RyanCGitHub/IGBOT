import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { publishIgPost } from "@/lib/publish-post";

type Params = { id: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId < 1) {
    return NextResponse.json({ success: false, error: "Invalid post id." }, { status: 400 });
  }

  let accountIdOverride: number | undefined;
  try {
    const body = (await request.json()) as { account_id?: number };
    if (body.account_id) accountIdOverride = body.account_id;
  } catch {
    // body is optional
  }

  const result = await publishIgPost(postId, { accountIdOverride });

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error, logs: result.logs },
      { status: result.httpStatus }
    );
  }

  return NextResponse.json({
    success: true,
    mediaId: result.mediaId,
    permalink: result.permalink,
    jobId: result.jobId,
    isRepublish: result.isRepublish,
    logs: result.logs,
  });
}
