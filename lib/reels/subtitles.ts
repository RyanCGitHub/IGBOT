// Subtitle rendering WITHOUT ffmpeg's drawtext: the production ffmpeg-static
// Linux build ships no drawtext ("No such filter: 'drawtext'", run #1), so
// text is rasterized here instead — bundled TTF → vector paths (opentype.js,
// glyph-by-glyph to sidestep its GSUB shaping limits) → SVG → PNG via sharp —
// and composited in ffmpeg with the core `overlay` filter.

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as opentype from "opentype.js";

const CANVAS_W = 1080;
const FONT_SIZE = 58;
const LINE_HEIGHT = 76;
const PAD_Y = 14;
const STROKE_W = 8;

let fontPromise: Promise<opentype.Font> | null = null;

// Exported for the cover renderer (lib/reels/cover.ts) — same bundled font.
export async function loadFont(): Promise<opentype.Font> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const p = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
      const buf = await readFile(p);
      return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    })();
  }
  return fontPromise;
}

// Glyph-by-glyph path building (Font.getPath would run the Bidi/GSUB shaper,
// which rejects DejaVu's ccmp lookups). Kerning applied manually.
// Exported for the cover renderer.
export function glyphLinePath(
  font: opentype.Font,
  text: string,
  baselineY: number,
  fontSize: number
): { d: string; width: number } {
  const scale = fontSize / font.unitsPerEm;
  let x = 0;
  let d = "";
  let prev: opentype.Glyph | null = null;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, glyph) * scale;
    d += glyph.getPath(x, baselineY, fontSize).toPathData(1);
    x += (glyph.advanceWidth ?? 0) * scale;
    prev = glyph;
  }
  return { d, width: x };
}

function linePath(font: opentype.Font, text: string, baselineY: number): { d: string; width: number } {
  return glyphLinePath(font, text, baselineY, FONT_SIZE);
}

// Renders one subtitle (1–2 lines, centered, white with black outline) onto a
// transparent canvas sized CANVAS_W × height. Returns the PNG and its height.
export async function renderSubtitlePng(text: string): Promise<{ png: Buffer; height: number }> {
  const font = await loadFont();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 2);
  if (lines.length === 0) throw new Error("Empty subtitle text.");

  const height = PAD_Y * 2 + LINE_HEIGHT * lines.length;
  const paths: string[] = [];
  lines.forEach((line, i) => {
    const baselineY = PAD_Y + LINE_HEIGHT * i + FONT_SIZE;
    const { d, width } = linePath(font, line, baselineY);
    const offsetX = Math.max((CANVAS_W - width) / 2, 0);
    // Stroke pass under fill pass — librsvg has no paint-order support.
    paths.push(
      `<path transform="translate(${offsetX.toFixed(1)},0)" d="${d}" fill="none" stroke="#000000" stroke-opacity="0.85" stroke-width="${STROKE_W}" stroke-linejoin="round"/>`,
      `<path transform="translate(${offsetX.toFixed(1)},0)" d="${d}" fill="#ffffff"/>`
    );
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${height}" viewBox="0 0 ${CANVAS_W} ${height}">${paths.join("")}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, height };
}
