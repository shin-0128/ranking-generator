/**
 * TikTok avatar detection — v11 (vertical-extent profile).
 *
 * Key insight: avatars are CIRCULAR (h ≈ w). Text is short (h << w).
 * For each row band, scan vertical extent h(x) at each X column. The avatar's
 * X range = where h(x) is consistently HIGH (above 50% of max). Other UI
 * elements (badges, names, coin amounts) have low h(x).
 *
 * This handles all variants: white-background avatars, internal text overlays,
 * screenshots with or without header chrome.
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
  rowMinNonwhitePixels?: number;
  mergeGapFrac?: number;
  rowMinHeightFrac?: number;
  extentGapFrac?: number;
  minAvatarWFrac?: number;
  maxAvatarWFrac?: number;
  searchXMaxFrac?: number;
  heightFracThreshold?: number;
  smallImageThreshold?: number;
  smallImageHeaderSkipFrac?: number;
  radiusMargin?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  nonWhiteThreshold: 252,
  headerSkipFrac: 0.02,
  footerSkipFrac: 0.02,
  rowMinNonwhitePixels: 4,
  mergeGapFrac: 0.01,
  rowMinHeightFrac: 0.025,
  extentGapFrac: 0.012,
  minAvatarWFrac: 0.06,
  maxAvatarWFrac: 0.3,
  searchXMaxFrac: 0.5,
  heightFracThreshold: 0.5,
  smallImageThreshold: 600,
  smallImageHeaderSkipFrac: 0.18,
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

  const headerFrac =
    W < o.smallImageThreshold ? o.smallImageHeaderSkipFrac : o.headerSkipFrac;
  const yStart = Math.floor(H * headerFrac);
  const yEnd = Math.floor(H * (1 - o.footerSkipFrac));
  const mergeGap = Math.max(3, Math.floor(H * o.mergeGapFrac));
  const minRowH = Math.max(15, Math.floor(H * o.rowMinHeightFrac));
  const extGap = Math.max(5, Math.floor(W * o.extentGapFrac));
  const minAW = Math.floor(W * o.minAvatarWFrac);
  const maxAW = Math.floor(W * o.maxAvatarWFrac);
  const searchXMax = Math.floor(W * o.searchXMaxFrac);

  const isNonWhite = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const i = (y * W + x) * 4;
    return (
      data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold
    );
  };

  // Row bands using density in left half
  const rowXMax = Math.floor(W / 2);
  const rowCounts: number[] = new Array(H).fill(0);
  for (let y = yStart; y < yEnd; y++) {
    let c = 0;
    for (let x = 0; x < rowXMax; x++) {
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

  const vertExtent = (
    x: number,
    nearY: number,
    gap: number,
  ): [number, number] => {
    let yt = nearY;
    let ws = 0;
    for (let y = nearY - 1; y >= yStart; y--) {
      if (isNonWhite(x, y)) {
        yt = y;
        ws = 0;
      } else {
        ws++;
        if (ws > gap) break;
      }
    }
    let yb = nearY;
    ws = 0;
    for (let y = nearY + 1; y < yEnd; y++) {
      if (isNonWhite(x, y)) {
        yb = y;
        ws = 0;
      } else {
        ws++;
        if (ws > gap) break;
      }
    }
    return [yt, yb];
  };

  const detected: Array<{ cx: number; cy: number; d: number }> = [];
  for (const [y0, y1] of rowBands) {
    let peakY = y0;
    let pv = rowCounts[y0];
    for (let y = y0; y <= y1; y++) {
      if (rowCounts[y] > pv) {
        pv = rowCounts[y];
        peakY = y;
      }
    }

    // h(x) profile across search range
    const hAt: number[] = new Array(searchXMax).fill(0);
    let maxH = 0;
    for (let x = 0; x < searchXMax; x++) {
      if (!isNonWhite(x, peakY)) continue;
      const [yt, yb] = vertExtent(x, peakY, extGap);
      hAt[x] = yb - yt;
      if (hAt[x] > maxH) maxH = hAt[x];
    }
    if (maxH < minRowH) continue;

    const hThreshold = Math.max(20, Math.floor(maxH * o.heightFracThreshold));

    // Longest contiguous X run with h(x) >= threshold
    let bestStart = -1;
    let bestEnd = -1;
    let curStart = -1;
    let curEnd = -1;
    for (let x = 0; x < searchXMax; x++) {
      if (hAt[x] >= hThreshold) {
        if (curStart === -1) curStart = x;
        curEnd = x;
      } else {
        if (curStart !== -1) {
          if (curEnd - curStart > bestEnd - bestStart) {
            bestStart = curStart;
            bestEnd = curEnd;
          }
          curStart = -1;
        }
      }
    }
    if (curStart !== -1 && curEnd - curStart > bestEnd - bestStart) {
      bestStart = curStart;
      bestEnd = curEnd;
    }
    if (bestStart === -1) continue;

    const w = bestEnd - bestStart + 1;
    const cx = Math.floor((bestStart + bestEnd) / 2);
    if (w < minAW || w > maxAW) continue;

    const [yt, yb] = vertExtent(cx, peakY, extGap);
    const cy = Math.floor((yt + yb) / 2);
    const h = yb - yt;
    const d = Math.max(w, h);
    detected.push({ cx, cy, d });
  }
  if (detected.length === 0) return [];

  const canonicalCx = median(detected.map((a) => a.cx));
  const canonicalR =
    Math.floor(median(detected.map((a) => a.d)) / 2) + o.radiusMargin;

  return detected
    .map((a) => ({ cx: canonicalCx, cy: a.cy, r: canonicalR }))
    .sort((a, b) => a.cy - b.cy);
}

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
