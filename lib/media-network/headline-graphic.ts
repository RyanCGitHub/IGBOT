// Branded headline graphic (the @abc7la-style news image post), rendered
// entirely in Node: sharp + the bundled font via glyph paths — no external
// images, no fontconfig. 1080x1350 (4:5 feed-optimal).

import sharp from "sharp";
import { loadFont, glyphLinePath } from "@/lib/reels/subtitles";

const W = 1080;
const H = 1350;
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
  tag?: string | null;       // BREAKING | DEVELOPING | null
  creditText: string;
}): Promise<Buffer> {
  const font = await loadFont();
  const measure = (text: string, size: number) => glyphLinePath(font, text, 0, size).width;

  // Auto-size headline: start big, shrink until it fits in <= 6 lines.
  let fontSize = 84;
  let lines = wrapToWidth(measure, params.headline.toUpperCase(), fontSize, MAX_TEXT_WIDTH);
  while (fontSize > 44 && lines.length > 6) {
    fontSize -= 6;
    lines = wrapToWidth(measure, params.headline.toUpperCase(), fontSize, MAX_TEXT_WIDTH);
  }
  const lineHeight = Math.round(fontSize * 1.22);

  const paths: string[] = [];

  // Brand bar (top)
  const brand = glyphLinePath(font, params.brandName.toUpperCase(), 96, 38);
  paths.push(`<path transform="translate(${MARGIN},0)" d="${brand.d}" fill="#ffffff"/>`);
  if (params.handle) {
    const handle = glyphLinePath(font, params.handle, 96, 26);
    paths.push(`<path transform="translate(${W - MARGIN - handle.width},0)" d="${handle.d}" fill="#94a3b8"/>`);
  }

  // Urgency tag pill
  let headlineTop = 250;
  if (params.tag) {
    const tagText = params.tag.toUpperCase();
    const tag = glyphLinePath(font, tagText, headlineTop, 34);
    const pillColor = tagText === "BREAKING" ? "#ef4444" : "#f59e0b";
    paths.push(
      `<rect x="${MARGIN - 18}" y="${headlineTop - 40}" rx="10" width="${tag.width + 36}" height="56" fill="${pillColor}"/>`,
      `<path transform="translate(${MARGIN},0)" d="${tag.d}" fill="#0f172a"/>`
    );
    headlineTop += 90;
  }

  // Headline
  lines.forEach((line, i) => {
    const baselineY = headlineTop + fontSize + i * lineHeight;
    const { d } = glyphLinePath(font, line, baselineY, fontSize);
    paths.push(`<path transform="translate(${MARGIN},0)" d="${d}" fill="#ffffff"/>`);
  });

  // Accent rule under headline
  const ruleY = headlineTop + fontSize + (lines.length - 1) * lineHeight + 44;
  paths.push(`<rect x="${MARGIN}" y="${ruleY}" width="140" height="8" rx="4" fill="#22d3ee"/>`);

  // Credit footer
  const credit = glyphLinePath(font, params.creditText.slice(0, 90), H - 70, 26);
  paths.push(`<path transform="translate(${MARGIN},0)" d="${credit.d}" fill="#94a3b8"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b1220"/>
        <stop offset="0.6" stop-color="#0f172a"/>
        <stop offset="1" stop-color="#172033"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.85" cy="0.1" r="0.8">
        <stop offset="0" stop-color="#22d3ee" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <rect x="0" y="0" width="${W}" height="6" fill="#22d3ee"/>
    ${paths.join("")}
  </svg>`;

  // All text renders as glyph paths — nothing user-controlled enters the SVG
  // as markup, so no escaping is needed.
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
