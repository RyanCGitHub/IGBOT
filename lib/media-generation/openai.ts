// OpenAI Images (gpt-image-1) provider. Dependency-free — uses fetch, mirroring
// how the app already calls the Meta Graph API. The API key is read from the
// environment and never logged or returned.

import type { ImageProvider, GenerateImageOptions, GeneratedImageResult } from "./types";
import { safeJson } from "@/lib/media-generation/http";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const MODEL = "gpt-image-1";
const DEFAULT_SIZE = "1024x1024";

// OpenAI's image endpoints intermittently return 5xx gateway pages (observed
// HTTP 502 on images/edits with no status-page incident). Retry in-call with
// backoff so a flaky edge doesn't burn a whole scheduler-tick attempt.
async function fetchWithRetry(input: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(input, init);
      if (res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status} from ${input}`);
    } catch (e) {
      lastError = e;
    }
    if (i < attempts - 1) await new Promise<void>(r => setTimeout(r, 2_000 * (i + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

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

      const res = await fetchWithRetry(OPENAI_IMAGES_URL, {
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

      // FormData bodies cannot be reused across fetch attempts in all
      // runtimes — rebuild per attempt via a factory.
      const makeForm = () => {
        const f = new FormData();
        f.append("model", MODEL);
        f.append("prompt", prompt);
        f.append("size", size);
        f.append(
          "image[]",
          new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }),
          reference.mimeType === "image/jpeg" ? "reference.jpg" : "reference.png"
        );
        return f;
      };

      let res: Response | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(OPENAI_EDITS_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` }, // content-type set by FormData
            body: makeForm(),
          });
          if (res.status < 500) break;
          lastErr = new Error(`HTTP ${res.status} from images/edits`);
        } catch (e) {
          lastErr = e;
          res = null;
        }
        if (attempt < 2) await new Promise<void>(r => setTimeout(r, 2_000 * (attempt + 1)));
      }
      if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

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
