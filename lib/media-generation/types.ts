// Provider-agnostic media generation interface. Swap providers without touching
// callers. Image is implemented now; video is a disabled stub (Part 2.3).

export type GenerateImageOptions = {
  size?: string;     // provider-specific, e.g. "1024x1024" | "1024x1536" | "1536x1024"
  quality?: string;  // provider-specific
};

export type GeneratedImageResult = {
  base64: string;                         // raw image bytes, base64 (no data: prefix)
  mimeType: string;                       // e.g. "image/png"
  providerMeta: Record<string, unknown>;  // model/size/usage — never includes secrets
};

export interface ImageProvider {
  readonly name: string;
  generateImage(prompt: string, options?: GenerateImageOptions): Promise<GeneratedImageResult>;
}

// ─── Video (stub only — not implemented until MEDIA_VIDEO_ENABLED + a real provider) ─

export type GeneratedVideoResult = {
  base64?: string;
  url?: string;
  providerMeta: Record<string, unknown>;
};

export interface VideoProvider {
  readonly name: string;
  generateVideo(prompt: string, options?: Record<string, unknown>): Promise<GeneratedVideoResult>;
}
