import sharp from "sharp";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TargetShape = "portrait_4_5" | "landscape_1_91" | "preserved";

export type NormalizationMeta = {
  originalWidth: number;
  originalHeight: number;
  originalAspectRatio: string;
  finalWidth: number;
  finalHeight: number;
  finalAspectRatio: string;
  wasResized: boolean;
  wasCropped: boolean;
  wasPadded: boolean;
  wasConverted: boolean;
  originalFormat: string;
  finalFormat: "image/jpeg";
  targetShape: TargetShape;
};

// ─── Instagram feed aspect ratio bounds ───────────────────────────────────────

const IG_WIDTH = 1080;
const RATIO_MIN = 4 / 5;   // 0.80  — max portrait (4:5)
const RATIO_MAX = 1.91;    //        — max landscape (~1.91:1)

// Center-crop is preferred when we keep at least this fraction of the pixels
const CROP_KEEP_THRESHOLD = 0.75;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Returns a human-readable aspect ratio string.
 * Returns "W:H" when the reduced numbers are small (e.g. "4:5", "16:9"),
 * otherwise falls back to a decimal form (e.g. "1.91:1").
 */
function ratioLabel(w: number, h: number): string {
  const d = gcd(w, h);
  const rw = w / d;
  const rh = h / d;
  if (rw <= 50 && rh <= 50) return `${rw}:${rh}`;
  return `${(w / h).toFixed(2)}:1`;
}

/**
 * Builds a blurred-background composite:
 * the original image is scaled to fit (contain) inside the target canvas;
 * the background is a blurred, cropped (cover) version of the same image.
 * Returns a raw (non-encoded) buffer that still needs .jpeg() encoding.
 */
async function buildBlurredBackground(
  input: Buffer,
  targetW: number,
  targetH: number
): Promise<Buffer> {
  const [bg, fg] = await Promise.all([
    sharp(input)
      .resize(targetW, targetH, { fit: "cover", position: "centre" })
      .blur(30)
      .toBuffer(),
    sharp(input)
      .resize(targetW, targetH, { fit: "inside" })
      .toBuffer(),
  ]);

  return sharp(bg)
    .composite([{ input: fg, gravity: "centre" }])
    .toBuffer();
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Normalizes an uploaded image for Instagram feed posting.
 *
 * Decision logic:
 *   - Aspect ratio already in [0.80, 1.91]: scale to 1080 px wide, preserve ratio.
 *   - Too tall (ratio < 0.80, e.g. 9:16 stories): target 4:5 (1080×1350).
 *       → center-crop  when we keep ≥ 75 % of the height
 *       → blurred-pad  otherwise (background is a blurred cover of the same image)
 *   - Too wide (ratio > 1.91, e.g. ultra-wide panoramas): target ~1.91:1 (1080×565).
 *       → center-crop  when we keep ≥ 75 % of the width
 *       → blurred-pad  otherwise
 *
 * Always outputs JPEG (required by the Instagram Graph API).
 */
export async function normalizeForInstagram(
  inputBuffer: Buffer,
  inputMime: string
): Promise<{ buffer: Buffer; meta: NormalizationMeta }> {
  const md = await sharp(inputBuffer).metadata();
  const origW = md.width;
  const origH = md.height;
  if (!origW || !origH) throw new Error("Cannot read image dimensions.");

  const ratio = origW / origH;
  const wasConverted = inputMime === "image/png";

  let finalW: number;
  let finalH: number;
  let wasCropped = false;
  let wasPadded = false;
  let targetShape: TargetShape;
  let outputBuffer: Buffer;

  if (ratio >= RATIO_MIN && ratio <= RATIO_MAX) {
    // ── In range: scale to IG_WIDTH, preserve ratio ──────────────────────────
    finalW = IG_WIDTH;
    finalH = Math.round(IG_WIDTH / ratio);
    targetShape = "preserved";

    // Use quality 95 here: no composition change, so minimise re-encode loss
    outputBuffer = await sharp(inputBuffer)
      .resize(finalW)
      .jpeg({ quality: 95 })
      .toBuffer();
  } else if (ratio < RATIO_MIN) {
    // ── Too tall: target 4:5 portrait ─────────────────────────────────────────
    finalW = IG_WIDTH;
    finalH = Math.round(IG_WIDTH / RATIO_MIN); // 1350
    targetShape = "portrait_4_5";

    // Fraction of original height we would keep when cropping to 4:5
    const scaledFgH = Math.round(IG_WIDTH * (origH / origW));
    const keepFraction = finalH / scaledFgH;

    if (keepFraction >= CROP_KEEP_THRESHOLD) {
      wasCropped = true;
      outputBuffer = await sharp(inputBuffer)
        .resize(finalW, finalH, { fit: "cover", position: "centre" })
        .jpeg({ quality: 92 })
        .toBuffer();
    } else {
      wasPadded = true;
      const raw = await buildBlurredBackground(inputBuffer, finalW, finalH);
      outputBuffer = await sharp(raw).jpeg({ quality: 92 }).toBuffer();
    }
  } else {
    // ── Too wide: target ~1.91:1 landscape ────────────────────────────────────
    finalW = IG_WIDTH;
    finalH = Math.round(IG_WIDTH / RATIO_MAX); // 565
    targetShape = "landscape_1_91";

    // Fraction of original width we would keep when cropping to 1.91:1
    const scaledFgW = Math.round(finalH * (origW / origH));
    const keepFraction = finalW / scaledFgW;

    if (keepFraction >= CROP_KEEP_THRESHOLD) {
      wasCropped = true;
      outputBuffer = await sharp(inputBuffer)
        .resize(finalW, finalH, { fit: "cover", position: "centre" })
        .jpeg({ quality: 92 })
        .toBuffer();
    } else {
      wasPadded = true;
      const raw = await buildBlurredBackground(inputBuffer, finalW, finalH);
      outputBuffer = await sharp(raw).jpeg({ quality: 92 }).toBuffer();
    }
  }

  const meta: NormalizationMeta = {
    originalWidth: origW,
    originalHeight: origH,
    originalAspectRatio: ratioLabel(origW, origH),
    finalWidth: finalW,
    finalHeight: finalH,
    finalAspectRatio: ratioLabel(finalW, finalH),
    wasResized: origW !== finalW || origH !== finalH,
    wasCropped,
    wasPadded,
    wasConverted,
    originalFormat: inputMime,
    finalFormat: "image/jpeg",
    targetShape,
  };

  return { buffer: outputBuffer, meta };
}
