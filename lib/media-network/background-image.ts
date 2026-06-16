import sharp from "sharp";

// Sources a background image for a news headline graphic. Order of preference:
//   1. A real, license-clean photo of the named subject from Wikipedia/Wikimedia
//      Commons (public-domain / CC — safe for a public news account, with
//      attribution). High hit-rate for the celebrity/sports/public-figure beat.
//   2. An AI-generated editorial backdrop of the *situation* (never a fabricated
//      photo of a real person) so no post ever ships on a blank background.
//
// This deliberately avoids scraping copyrighted press/paparazzi images — those
// carry takedown/DMCA exposure that a summarize-only news page should not take.

const UA = "NuudMediaBot/1.0 (Instagram news graphics; contact via account)";

export type BackgroundImage = {
  buffer: Buffer;
  // Short credit line to surface on the graphic, or null when none is required.
  attribution: string | null;
  source: "wikimedia" | "generated";
};

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Validate it actually decodes as a raster image sharp can handle.
    await sharp(buf).metadata();
    return buf;
  } catch {
    return null;
  }
}

// Wikipedia REST summary → the page's lead image (usually a clean portrait,
// sourced from Commons). Returns null on miss / disambiguation / no image.
async function tryWikipedia(subject: string): Promise<BackgroundImage | null> {
  const title = subject.trim();
  if (!title) return null;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      type?: string;
      originalimage?: { source?: string; width?: number };
      thumbnail?: { source?: string };
    };
    // Skip disambiguation pages — their lead image is meaningless.
    if (data.type === "disambiguation") return null;

    const url = data.originalimage?.source ?? data.thumbnail?.source;
    if (!url) return null;
    const buffer = await downloadImage(url);
    if (!buffer) return null;
    return { buffer, attribution: "Photo: Wikimedia Commons", source: "wikimedia" };
  } catch {
    return null;
  }
}

// Last resort: generate a non-photoreal editorial backdrop of the scene/topic.
// We instruct the model NOT to depict any real identifiable person, so we never
// fabricate a fake photo of a real individual.
async function generateEditorial(sceneHint: string): Promise<BackgroundImage | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt =
    `Editorial, cinematic news background illustration representing: ${sceneHint}. ` +
    `Moody dramatic lighting, rich depth, premium magazine aesthetic. ` +
    `Do NOT depict any real, identifiable person or celebrity. No faces in focus, no logos, no readable text, no watermarks. ` +
    `Composition leaves the lower third darker and uncluttered for an overlaid headline.`;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1536", n: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    return { buffer: Buffer.from(b64, "base64"), attribution: "Illustration", source: "generated" };
  } catch {
    return null;
  }
}

export async function sourceBackgroundImage(opts: {
  subject: string | null;      // best person/entity to photograph, from the generator
  sceneHint: string;           // fallback scene description (headline works)
  allowGenerated?: boolean;    // gate the paid AI fallback (default true)
  forceGenerated?: boolean;    // skip Wikipedia, go straight to the AI backdrop
}): Promise<BackgroundImage | null> {
  const subject = (opts.subject ?? "").trim();

  if (opts.forceGenerated) return generateEditorial(subject || opts.sceneHint);

  // Try each candidate name (handles "Taylor Swift & Travis Kelce").
  if (subject) {
    const candidates = subject.split(/\s*(?:,|&|\band\b|\bvs\.?\b|\bx\b)\s*/i).map(s => s.trim()).filter(Boolean);
    for (const name of candidates.slice(0, 2)) {
      const hit = await tryWikipedia(name);
      if (hit) return hit;
    }
  }

  if (opts.allowGenerated !== false) {
    return generateEditorial(subject || opts.sceneHint);
  }
  return null;
}
