/**
 * TikTok-style avatar circle detection from a full-resolution screenshot.
 *
 * Algorithm (validated against multiple real TikTok screenshots):
 * 1. Background is white. Avatars = non-white pixels.
 * 2. For each Y row in the avatar zone, count non-white pixels horizontally
 *    across an X stripe (excludes the rank-number column on the far left).
 * 3. Continuous Y rows above a low threshold = an avatar band. Bands within
 *    a small Y gap merge (handles avatars with internal whitespace).
 * 4. For each detected band's center Y, scan horizontally to find the
 *    avatar's leftmost/rightmost non-white extent → cx.
 * 5. Use the MEDIAN cx and MEDIAN band height across all bands as the
 *    canonical value (avatars are vertically aligned and same-size).
 * 6. Apply canonical cx + r to all bands; per-row cy from individual bands.
 */

export interface DetectedCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface DetectOptions {
  nonWhiteThreshold?: number;
  headerSkipFrac?: number;
  footerSkipFrac?: number;
  avatarXMinFrac?: number;
  avatarXMaxFrac?: number;
  minBandHeightFrac?: number;
  maxBandHeightFrac?: number;
  mergeGapFrac?: number;
  rowMinNonwhitePixels?: number;
  radiusMargin?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  nonWhiteThreshold: 245,
  headerSkipFrac: 0.02,
  footerSkipFrac: 0.02,
  avatarXMinFrac: 0.15,
  avatarXMaxFrac: 0.4,
  minBandHeightFrac: 0.025,
  maxBandHeightFrac: 0.12,
  mergeGapFrac: 0.025,
  rowMinNonwhitePixels: 4,
  radiusMargin: 2,
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function detectAvatars(
  canvas: HTMLCanvasElement,
  opts: DetectOptions = {},
): DetectedCircle[] {
  const o = { ...DEFAULTS, ...opts };
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const W = canvas.width;
  const H = canvas.height;
  if (W < 50 || H < 100) return [];

  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;
  const threshold = o.nonWhiteThreshold;

  const yStart = Math.floor(H * o.headerSkipFrac);
  const yEnd = Math.floor(H * (1 - o.footerSkipFrac));
  const xMin = Math.floor(W * o.avatarXMinFrac);
  const xMax = Math.floor(W * o.avatarXMaxFrac);
  const minBandH = Math.max(8, Math.floor(H * o.minBandHeightFrac));
  const maxBandH = Math.floor(H * o.maxBandHeightFrac);
  const mergeGap = Math.max(3, Math.floor(H * o.mergeGapFrac));

  const isNonWhite = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    return (
      data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold
    );
  };

  // Y-aggregated non-white pixel counts within the avatar X stripe
  const counts: number[] = new Array(H).fill(0);
  for (let y = yStart; y < yEnd; y++) {
    let c = 0;
    for (let x = xMin; x < xMax; x++) {
      if (isNonWhite(x, y)) c++;
    }
    counts[y] = c;
  }

  // Find continuous Y bands above threshold
  const raw: Array<[number, number]> = [];
  let inBand = false;
  let start = 0;
  for (let y = yStart; y < yEnd; y++) {
    if (counts[y] >= o.rowMinNonwhitePixels) {
      if (!inBand) {
        inBand = true;
        start = y;
      }
    } else if (inBand) {
      inBand = false;
      raw.push([start, y - 1]);
    }
  }
  if (inBand) raw.push([start, yEnd - 1]);

  // Merge close bands
  const merged: Array<[number, number]> = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b[0] - last[1] <= mergeGap) {
      last[1] = b[1];
    } else {
      merged.push([b[0], b[1]]);
    }
  }
  const bands = merged.filter((b) => {
    const h = b[1] - b[0];
    return h >= minBandH && h <= maxBandH;
  });
  if (bands.length === 0) return [];

  // Per band: estimate cx and height
  const cxs: number[] = [];
  const heights: number[] = [];
  for (const [y0, y1] of bands) {
    const cy = Math.floor((y0 + y1) / 2);
    let xl = -1;
    for (let x = xMin; x < xMax; x++) {
      if (isNonWhite(x, cy)) {
        xl = x;
        break;
      }
    }
    let xr = -1;
    for (let x = xMax - 1; x >= xMin; x--) {
      if (isNonWhite(x, cy)) {
        xr = x;
        break;
      }
    }
    if (xl !== -1 && xr !== -1) {
      cxs.push(Math.floor((xl + xr) / 2));
    }
    heights.push(y1 - y0);
  }

  // Canonical (consistent across rows) cx and r
  const canonicalCx =
    cxs.length > 0 ? median(cxs) : Math.floor((xMin + xMax) / 2);
  const canonicalR = Math.floor(median(heights) / 2) + o.radiusMargin;

  return bands
    .map(([y0, y1]) => ({
      cx: canonicalCx,
      cy: Math.floor((y0 + y1) / 2),
      r: canonicalR,
    }))
    .sort((a, b) => a.cy - b.cy);
}

/**
 * Match Claude's rank/name entries to detected avatar circles by Y proximity.
 * Returns the same length as `entries`, with each item mapped to the nearest
 * detected circle whose cy is within `tolerance` of the entry's hint cy.
 * Entries with no good match get null (caller should fall back to hint).
 */
export function matchByY<T extends { cy: number }>(
  entryHints: T[],
  detected: DetectedCircle[],
  tolerance: number,
): Array<DetectedCircle | null> {
  if (detected.length === 0) return entryHints.map(() => null);
  return entryHints.map((hint) => {
    let best: DetectedCircle | null = null;
    let bestDist = Infinity;
    for (const d of detected) {
      const dist = Math.abs(d.cy - hint.cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best && bestDist <= tolerance ? best : null;
  });
}
