// Branded headline graphic (the @abc7la / TMZ-style news image post). Leads
// with a real background image of the subject (or an editorial backdrop) and
// keeps the headline in a darkened bottom band so it never covers the face.
// Text renders as glyph paths via the bundled font — no fontconfig, no markup
// injection. 1080x1350 (4:5 feed-optimal).

import sharp from "sharp";
import { loadFont, glyphLinePath } from "@/lib/reels/subtitles";

const W = 1080;
const MARGIN = 70;
const MAX_TEXT_WIDTH = W - MARGIN * 2;

function wrapToWidth(
  measure: (text: string, size: number) => number,
  text: string,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate, fontSize) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderHeadlineGraphic(params: {
  brandName: string;
  handle?: string | null;
  headline: string;
  tag?: string | null;            // BREAKING | DEVELOPING | null
  creditText: string;
  background?: Buffer | null;     // real photo / editorial backdrop
  photoCredit?: string | null;    // e.g. "Photo: Wikimedia Commons"
  heightPx?: number;              // 1350 (4:5 feed, default) or 1920 (9:16 Reel)
}): Promise<Buffer> {
  const H = params.heightPx ?? 1350;
  const font = await loadFont();
  const measure = (text: string, size: number) => glyphLinePath(font, text, 0, size).width;
  const hasBg = !!params.background;

  // Auto-size headline: start big, shrink until it fits in <= 5 lines.
  let fontSize = 86;
  let lines = wrapToWidth(measure, params.headline.toUpperCase(), fontSize, MAX_TEXT_WIDTH);
  while (fontSize > 46 && lines.length > 5) {
    fontSize -= 6;
    lines = wrapToWidth(measure, params.headline.toUpperCase(), fontSize, MAX_TEXT_WIDTH);
  }
  const lineHeight = Math.round(fontSize * 1.2);

  const paths: string[] = [];

  // ── Top: brand bar (with a scrim behind it for legibility over photos) ──────
  const brand = glyphLinePath(font, params.brandName.toUpperCase(), 96, 38);
  paths.push(`<path transform="translate(${MARGIN},0)" d="${brand.d}" fill="#ffffff"/>`);
  if (params.handle) {
    const handle = glyphLinePath(font, params.handle, 96, 26);
    paths.push(`<path transform="translate(${W - MARGIN - handle.width},0)" d="${handle.d}" fill="#e2e8f0"/>`);
  }

  // ── Bottom-anchored headline block (keeps the subject's face clear) ─────────
  // On a 9:16 Reel, Instagram overlays caption/username/action buttons across
  // the bottom ~25%, so reserve that space and lift the text into the safe
  // zone. A 4:5 feed photo has no such overlay — keep it near the bottom.
  const isReel = H >= 1700;
  const bottomReserve = isReel ? 480 : 56;
  const creditBaseline = H - bottomReserve;
  // Last headline baseline sits above the credit line; stack the rest upward.
  const lastBaseline = creditBaseline - 70;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;

  // Urgency tag pill above the headline.
  if (params.tag) {
    const tagText = params.tag.toUpperCase();
    const pillBaseline = firstBaseline - fontSize - 22;
    const tag = glyphLinePath(font, tagText, pillBaseline, 34);
    const pillColor = tagText === "BREAKING" ? "#ef4444" : "#f59e0b";
    paths.push(
      `<rect x="${MARGIN - 18}" y="${pillBaseline - 40}" rx="10" width="${tag.width + 36}" height="56" fill="${pillColor}"/>`,
      `<path transform="translate(${MARGIN},0)" d="${tag.d}" fill="#0f172a"/>`
    );
  }

  // Headline lines.
  lines.forEach((line, i) => {
    const baselineY = firstBaseline + i * lineHeight;
    const { d } = glyphLinePath(font, line, baselineY, fontSize);
    paths.push(`<path transform="translate(${MARGIN},0)" d="${d}" fill="#ffffff"/>`);
  });

  // Accent rule between headline and credit.
  paths.push(`<rect x="${MARGIN}" y="${lastBaseline + 24}" width="140" height="8" rx="4" fill="#22d3ee"/>`);

  // Credit footer (source + optional photo attribution).
  const creditLine = [params.creditText, params.photoCredit].filter(Boolean).join("  ·  ").slice(0, 110);
  const credit = glyphLinePath(font, creditLine, creditBaseline, 24);
  paths.push(`<path transform="translate(${MARGIN},0)" d="${credit.d}" fill="#cbd5e1"/>`);

  // Scrims: darken top (brand) and bottom (headline) so text stays legible over
  // any photo, while the middle/upper area shows the subject.
  const scrims = `
    <rect x="0" y="0" width="${W}" height="200" fill="url(#topScrim)"/>
    <rect x="0" y="${Math.round(H * 0.34)}" width="${W}" height="${H - Math.round(H * 0.34)}" fill="url(#botScrim)"/>
    <rect x="0" y="0" width="${W}" height="6" fill="#22d3ee"/>`;

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="botScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#020617" stop-opacity="0"/>
        <stop offset="0.45" stop-color="#020617" stop-opacity="0.72"/>
        <stop offset="1" stop-color="#020617" stop-opacity="0.96"/>
      </linearGradient>
    </defs>
    ${scrims}
    ${paths.join("")}
  </svg>`;

  if (hasBg) {
    // Cover-fit the photo, attention-crop toward the subject, then lay the
    // scrim+text overlay on top.
    const base = await sharp(params.background!)
      .resize(W, H, { fit: "cover", position: sharp.strategy.attention })
      .toBuffer();
    return sharp(base)
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // Fallback (no image available): the original branded gradient so we still
  // render something rather than crash.
  const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b1220"/><stop offset="0.6" stop-color="#0f172a"/><stop offset="1" stop-color="#172033"/>
      </linearGradient>
      <linearGradient id="botScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#020617" stop-opacity="0"/><stop offset="1" stop-color="#020617" stop-opacity="0.6"/>
      </linearGradient>
      <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0.4"/><stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${scrims}
    ${paths.join("")}
  </svg>`;
  return sharp(Buffer.from(gradientSvg)).jpeg({ quality: 92 }).toBuffer();
}
