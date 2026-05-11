/**
 * TikTok-style avatar circle detection from a full-resolution screenshot.
 *
 * Algorithm (v7 — validated against multiple TikTok screenshot variants):
 * 1. Background is white. Avatars = non-white pixels.
 * 2. Stage 1 — loose row bands: for each Y row in the avatar X stripe,
 *    count non-white pixels. Continuous Y rows above a low threshold = a row
 *    band (contains avatar + badge + name + coin text).
 * 3. Stage 2 — per row band, locate the avatar inside it:
 *    - cx = column with the most non-white pixels within the band's Y range
 *      (avatar's vertical center column has the maximum chord).
 *    - cy = Y row with the most non-white pixels within the band
 *      (avatar's horizontal center row has the maximum chord), refined by
 *      a gap-tolerant vertical extent scan at cx.
 *    - d  = the vertical extent at cx (the avatar's diameter).
 * 4. Apply canonical (median) cx and r across all bands (avatars are at the
 *    same X and same size across rows), per-row cy individually.
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
  rowMinNonwhitePixels?: number;
  mergeGapFrac?: number;
  rowMinHeightFrac?: number;
  gapTolerance?: number;
  radiusMargin?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  nonWhiteThreshold: 252,
  headerSkipFrac: 0.02,
  footerSkipFrac: 0.02,
  avatarXMinFrac: 0.1,
  avatarXMaxFrac: 0.4,
  rowMinNonwhitePixels: 4,
  mergeGapFrac: 0.01,
  rowMinHeightFrac: 0.04,
  gapTolerance: 12,
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
  const mergeGap = Math.max(3, Math.floor(H * o.mergeGapFrac));
  const minRowH = Math.max(20, Math.floor(H * o.rowMinHeightFrac));
  const gapTol = o.gapTolerance;

  const isNonWhite = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const i = (y * W + x) * 4;
    return (
      data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold
    );
  };

  // Stage 1: row bands
  const rowCounts: number[] = new Array(H).fill(0);
  for (let y = yStart; y < yEnd; y++) {
    let c = 0;
    for (let x = xMin; x < xMax; x++) {
      if (isNonWhite(x, y)) c++;
    }
    rowCounts[y] = c;
  }

  const raw: Array<[number, number]> = [];
  let inBand = false;
  let start = 0;
  for (let y = yStart; y < yEnd; y++) {
    if (rowCounts[y] >= o.rowMinNonwhitePixels) {
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

  const merged: Array<[number, number]> = [];
  for (const b of raw) {
    const last = merged[merged.length - 1];
    if (last && b[0] - last[1] <= mergeGap) {
      last[1] = b[1];
    } else {
      merged.push([b[0], b[1]]);
    }
  }
  const rowBands = merged.filter((b) => b[1] - b[0] >= minRowH);
  if (rowBands.length === 0) return [];

  // Stage 2: locate avatar within each row band
  const cxs: number[] = [];
  const ds: number[] = [];
  const cyList: number[] = [];

  for (const [y0, y1] of rowBands) {
    // cx = column with most non-white in band Y range
    let peakX = xMin;
    let peakXVal = -1;
    for (let x = xMin; x < xMax; x++) {
      let cnt = 0;
      for (let y = y0; y <= y1; y++) {
        if (isNonWhite(x, y)) cnt++;
      }
      if (cnt > peakXVal) {
        peakXVal = cnt;
        peakX = x;
      }
    }
    const cx = peakX;

    // cy = row with most non-white in band X range
    let peakY = y0;
    let peakYVal = rowCounts[y0];
    for (let y = y0; y <= y1; y++) {
      if (rowCounts[y] > peakYVal) {
        peakYVal = rowCounts[y];
        peakY = y;
      }
    }

    // vertical extent at cx with gap tolerance — gives avatar diameter
    let yt = peakY;
    let ws = 0;
    for (let y = peakY - 1; y >= yStart; y--) {
      if (isNonWhite(cx, y)) {
        yt = y;
        ws = 0;
      } else {
        ws++;
        if (ws > gapTol) break;
      }
    }
    let yb = peakY;
    ws = 0;
    for (let y = peakY + 1; y < yEnd; y++) {
      if (isNonWhite(cx, y)) {
        yb = y;
        ws = 0;
      } else {
        ws++;
        if (ws > gapTol) break;
      }
    }
    const d = yb - yt;
    const cy = Math.floor((yt + yb) / 2);

    cxs.push(cx);
    ds.push(d);
    cyList.push(cy);
  }

  const canonicalCx = median(cxs);
  const canonicalR = Math.floor(median(ds) / 2) + o.radiusMargin;

  return cyList
    .map((cy) => ({ cx: canonicalCx, cy, r: canonicalR }))
    .sort((a, b) => a.cy - b.cy);
}

/**
 * Match Claude's rank/name entries to detected avatar circles by Y proximity.
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
