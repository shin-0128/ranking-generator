/**
 * Avatar box → circle conversion (structure-aware, measured against a 13-shot
 * /103-row real test set, not a single eyeballed image).
 *
 * We do NOT pixel-scan to "refine" the VLM box — Gemini's per-row boxes are
 * already internally consistent (one column, one size, even Y spacing), and
 * scanning to guess avatar edges only added failure modes.
 *
 * What the test set proved:
 *   - within one screenshot every avatar shares one column (x) and one size
 *     → snap cx and r to the row-wise median.
 *   - rows are evenly spaced vertically → a robust (Theil–Sen) line through the
 *     per-row centres lets us snap a stray outlier row back onto the grid
 *     (observed once: a row 38px off the line).
 *   - the avatar diameter is always well under the row pitch → clamp r by pitch
 *     to kill the rare case where the model grossly over-sizes a box.
 */

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface CoarseBox {
  /** full-resolution pixel coords */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Robust line fit (Theil–Sen) of y vs index: slope = median of pairwise slopes,
 * intercept = median of (y - slope*i). Ignores outliers entirely, unlike
 * least-squares which a single stray row would drag.
 */
function theilSen(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((ys[j] - ys[i]) / (j - i));
    }
  }
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * i));
  return { slope, intercept };
}

/**
 * Convert per-row coarse boxes (sorted top-to-bottom) into stable circles.
 *
 * - cx → row-wise median (one column per screenshot)
 * - r  → row-wise median radius, clamped so the diameter can't exceed the row
 *        pitch (avatars never overlap)
 * - cy → box centre, but snapped to the robust Y-grid line when it strays far
 *        from where the even spacing says the row should be
 */
export function boxesToCircles(boxes: CoarseBox[]): Circle[] {
  const n = boxes.length;
  if (n === 0) return [];

  const cxs = boxes.map((b) => (b.x0 + b.x1) / 2);
  const cys = boxes.map((b) => (b.y0 + b.y1) / 2);
  const rs = boxes.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2);

  const medCx = median(cxs);
  const medR = median(rs);

  const { slope, intercept } = theilSen(cys);
  const pitch = Math.abs(slope);
  // Sanity ceiling: diameter ≤ pitch → r ≤ pitch/2. With normal data r ≈
  // 0.33*pitch, so this only fires on a grossly over-sized box.
  const r = pitch > 0 ? Math.min(medR, pitch * 0.5) : medR;
  // Only override a row's cy when it deviates clearly from the grid; otherwise
  // trust the model's (usually exact) per-row Y.
  const snapThreshold = pitch * 0.35;

  return boxes.map((b, i) => {
    const actualCy = cys[i];
    const fittedCy = intercept + slope * i;
    const cy =
      pitch > 0 && Math.abs(actualCy - fittedCy) > snapThreshold
        ? fittedCy
        : actualCy;
    return { cx: medCx, cy, r };
  });
}
