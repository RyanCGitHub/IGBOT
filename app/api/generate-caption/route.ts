import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { requireApiKey } from "@/lib/auth";

const PROMPT_MAX = 2_000;

type GenerateCaptionRequestBody = {
  prompt: string;
};

export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as GenerateCaptionRequestBody;

    if (!body.prompt || !body.prompt.trim()) {
      return NextResponse.json(
        { success: false, error: "Prompt is required." },
        { status: 400 }
      );
    }

    if (body.prompt.length > PROMPT_MAX) {
      return NextResponse.json(
        { success: false, error: `Prompt must be ${PROMPT_MAX} characters or fewer.` },
        { status: 400 }
      );
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: body.prompt,
        },
      ],
    });

    const caption = extractCaption(response.content);

    return NextResponse.json({
      success: true,
      caption,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error) || "Claude request failed.",
      },
      { status: 500 }
    );
  }
}

function extractCaption(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const first = content.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
    );
    return first ? String((first as { text: string }).text) : "";
  }

  if (content && typeof content === "object") {
    const typed = content as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      return typed.text;
    }
    for (const value of Object.values(content)) {
      const extracted = extractCaption(value);
      if (extracted) return extracted;
    }
  }

  return "";
}
