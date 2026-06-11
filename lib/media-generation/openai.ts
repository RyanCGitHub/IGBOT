// OpenAI Images (gpt-image-1) provider. Dependency-free — uses fetch, mirroring
// how the app already calls the Meta Graph API. The API key is read from the
// environment and never logged or returned.

import type { ImageProvider, GenerateImageOptions, GeneratedImageResult } from "./types";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-1";
const DEFAULT_SIZE = "1024x1024";

type OpenAIImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: unknown;
  error?: { message?: string; type?: string; code?: string };
};

export function createOpenAIImageProvider(): ImageProvider {
  return {
    name: `openai:${MODEL}`,
    async generateImage(prompt: string, options?: GenerateImageOptions): Promise<GeneratedImageResult> {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set on the server.");

      const size = options?.size ?? DEFAULT_SIZE;

      const res = await fetch(OPENAI_IMAGES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`, // server-only, never logged
        },
        body: JSON.stringify({ model: MODEL, prompt, size, n: 1 }),
      });

      const data = (await res.json()) as OpenAIImagesResponse;

      if (!res.ok) {
        throw new Error(data.error?.message ?? `OpenAI image request failed (HTTP ${res.status}).`);
      }

      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI returned no image data.");

      // gpt-image-1 returns PNG base64. providerMeta carries no secrets.
      return {
        base64: b64,
        mimeType: "image/png",
        providerMeta: { model: MODEL, size, usage: data.usage ?? null },
      };
    },
  };
}
