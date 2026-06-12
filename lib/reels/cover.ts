// Reel cover/thumbnail renderer (viral ruleset V15): the cover is a SEPARATE
// asset from the first frame — it sells the tap on the profile grid. Design
// rules from the research: big 3–5 word curiosity title, face close-up
// underneath, composed for the 3:4 grid crop, one consistent series template.
//
// Composition (1080x1920, all text inside the center 3:4 region y≈240–1680):
//   - hook keyframe as the full-bleed background (the host's face shot)
//   - dark gradient up top for legibility
//   - title block (up to 3 lines, auto-sized) in the upper third
//   - small series wordmark near the bottom of the 3:4 region

import sharp from "sharp";
import { loadFont, glyphLinePath } from "@/lib/reels/subtitles";

const W = 1080;
const H = 1920;
const GRID_TOP = 240;      // 3:4 crop starts here on a 9:16 canvas
const GRID_BOTTOM = 1680;  // and ends here
const TITLE_MAX_WIDTH = 920;

export async function renderCover(keyframe: Buffer, title: string): Promise<Buffer> {
  const font = await loadFont();
  const words = title.trim().split(/\s+/).slice(0, 6);

  // Two balanced lines max, bottom-anchored over the host's chest so the face
  // stays fully visible (visually verified layout). Auto-size to fit width.
  const perLine = Math.ceil(words.length / 2);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(" "));

  let fontSize = 120;
  const measure = (text: string, size: number) => glyphLinePath(font, text, 0, size).width;
  while (fontSize > 60 && lines.some(l => measure(l.toUpperCase(), fontSize) > TITLE_MAX_WIDTH)) fontSize -= 6;
  const lineHeight = Math.round(fontSize * 1.18);

  const lastBaseline = GRID_BOTTOM - 150;
  const firstBaseline = lastBaseline - lineHeight * (lines.length - 1);
  const paths: string[] = [];
  lines.forEach((line, i) => {
    const baselineY = firstBaseline + lineHeight * i;
    const { d, width } = glyphLinePath(font, line.toUpperCase(), baselineY, fontSize);
    const ox = (W - width) / 2;
    paths.push(
      `<path transform="translate(${ox.toFixed(1)},0)" d="${d}" fill="none" stroke="#000000" stroke-opacity="0.9" stroke-width="${Math.max(8, fontSize / 11)}" stroke-linejoin="round"/>`,
      `<path transform="translate(${ox.toFixed(1)},0)" d="${d}" fill="#ffffff"/>`
    );
  });

  // Wordmark removed per owner direction (2026-06-12) — title only.
  const gradTop = firstBaseline - fontSize - 120;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#000000" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${gradTop}" width="${W}" height="${H - gradTop}" fill="url(#g)"/>
    ${paths.join("")}
  </svg>`;

  return sharp(keyframe)
    .resize(W, H, { fit: "cover", position: sharp.strategy.attention })
    .composite([{ input: Buffer.from(overlay) }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
