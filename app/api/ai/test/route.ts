import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";

export async function GET() {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: "Reply only with Claude API connected",
        },
      ],
    });

    return NextResponse.json({
      success: true,
      text: response.content,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
    });
  }
}