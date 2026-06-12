// OpenAI Images (gpt-image-1) provider. Dependency-free — uses fetch, mirroring
// how the app already calls the Meta Graph API. The API key is read from the
// environment and never logged or returned.

import type { ImageProvider, GenerateImageOptions, GeneratedImageResult } from "./types";
import { safeJson } from "@/lib/media-generation/http";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
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

      const data = await safeJson<OpenAIImagesResponse>(res, "OpenAI images");

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

    // images/edits with a reference image — gpt-image-1 re-renders the subject
    // (our avatar) into the scene described by the prompt. Multipart form.
    async editImage(prompt, reference, options) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set on the server.");

      const size = options?.size ?? DEFAULT_SIZE;
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append(
        "image[]",
        new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }),
        reference.mimeType === "image/jpeg" ? "reference.jpg" : "reference.png"
      );

      const res = await fetch(OPENAI_EDITS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` }, // content-type set by FormData
        body: form,
      });

      const data = await safeJson<OpenAIImagesResponse>(res, "OpenAI images/edits");
      if (!res.ok) {
        throw new Error(data.error?.message ?? `OpenAI image edit failed (HTTP ${res.status}).`);
      }
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI returned no image data from edit.");

      return {
        base64: b64,
        mimeType: "image/png",
        providerMeta: { model: MODEL, size, mode: "edit", usage: data.usage ?? null },
      };
    },
  };
}
