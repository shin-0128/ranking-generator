/**
 * TikTok avatar detection — v10.
 *
 * Strategy:
 * 1. Find row bands (rows with non-white content in left half of screenshot).
 * 2. For each band, scan at the peak Y row for non-white "runs" (using a
 *    tight gap tolerance so runs don't merge across element boundaries).
 * 3. Filter runs by:
 *    - width within plausible avatar size range
 *    - cx within plausible X zone (excludes rank-number column on far left)
 *    - aspect (vertical extent ≈ horizontal width — avatars are circular)
 * 4. Pick the largest qualifying run per band → that's the avatar.
 * 5. Use median cx and median diameter across all bands as the canonical
 *    (since avatars are at the same X and same size across rows).
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
  runGapFrac?: number;
  extentGapFrac?: number;
  minAvatarWFrac?: number;
  maxAvatarWFrac?: number;
  avatarCxMinFrac?: number;
  avatarCxMaxFrac?: number;
  aspectMin?: number;
  aspectMax?: number;
  radiusMargin?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  nonWhiteThreshold: 252,
  headerSkipFrac: 0.02,
  footerSkipFrac: 0.02,
  rowMinNonwhitePixels: 4,
  mergeGapFrac: 0.01,
  rowMinHeightFrac: 0.025,
  runGapFrac: 0.005,
  extentGapFrac: 0.012,
  minAvatarWFrac: 0.08,
  maxAvatarWFrac: 0.3,
  avatarCxMinFrac: 0.06,
  avatarCxMaxFrac: 0.45,
  aspectMin: 0.6,
  aspectMax: 1.5,
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
  const mergeGap = Math.max(3, Math.floor(H * o.mergeGapFrac));
  const minRowH = Math.max(15, Math.floor(H * o.rowMinHeightFrac));
  const runGap = Math.max(2, Math.floor(W * o.runGapFrac));
  const extGap = Math.max(5, Math.floor(W * o.extentGapFrac));
  const minAW = Math.floor(W * o.minAvatarWFrac);
  const maxAW = Math.floor(W * o.maxAvatarWFrac);
  const cxMin = Math.floor(W * o.avatarCxMinFrac);
  const cxMax = Math.floor(W * o.avatarCxMaxFrac);

  const isNonWhite = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const i = (y * W + x) * 4;
    return (
      data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold
    );
  };

  // Row bands using density in left half of image
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

  const findRunsAt = (y: number, gap: number): Array<[number, number]> => {
    const runs: Array<[number, number]> = [];
    let inRun = false;
    let s = 0;
    let lastNw = 0;
    let ws = 0;
    for (let x = 0; x < W; x++) {
      if (isNonWhite(x, y)) {
        if (!inRun) {
          inRun = true;
          s = x;
        }
        ws = 0;
        lastNw = x;
      } else if (inRun) {
        ws++;
        if (ws > gap) {
          runs.push([s, lastNw]);
          inRun = false;
        }
      }
    }
    if (inRun) runs.push([s, lastNw]);
    return runs;
  };

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

    const runs = findRunsAt(peakY, runGap);
    let best: { cx: number; cy: number; d: number } | null = null;
    for (const [s, e] of runs) {
      const w = e - s + 1;
      const cx = Math.floor((s + e) / 2);
      if (w < minAW || w > maxAW) continue;
      if (cx < cxMin || cx > cxMax) continue;
      const [yt, yb] = vertExtent(cx, peakY, extGap);
      const h = yb - yt;
      if (w === 0) continue;
      const aspect = h / w;
      if (aspect < o.aspectMin || aspect > o.aspectMax) continue;
      const d = Math.max(w, h);
      if (!best || d > best.d) {
        best = { cx, cy: Math.floor((yt + yb) / 2), d };
      }
    }
    if (best) detected.push(best);
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
