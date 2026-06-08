import type { ExtractedEntry } from "./extractor/types";
import { cleanName } from "./cleaner";
import { boxesToCircles, type Circle } from "./extractor/avatar-detect";

interface ParseEntry {
  rank: number;
  name: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface ParseResponse {
  entries: ParseEntry[];
}

const MAX_DIM = 1568;
// Crop radius as a fraction of the avatar radius. Slightly NEGATIVE so the
// avatar fills the template's gold circle edge-to-edge instead of leaving a
// background ring (the detector is told to box "slightly large", so a small
// inward trim cancels that margin). Tuned against the 13-shot set rendered as
// real circular cells — see scripts/tune-padding.mjs. With 3.5-flash's accurate
// centring + median stabilisation, the lost safety margin isn't needed.
const CROP_PADDING = -0.05;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像読み込み失敗"));
    };
    img.src = url;
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

async function preprocessToCanvas(file: File): Promise<{
  fullCanvas: HTMLCanvasElement;
  smallBlob: Blob;
}> {
  const img = await loadImageFromFile(file);

  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = img.naturalWidth;
  fullCanvas.height = img.naturalHeight;
  const fullCtx = fullCanvas.getContext("2d");
  if (!fullCtx) throw new Error("Canvas 2D context unavailable");
  fullCtx.drawImage(img, 0, 0);

  // Downscale for the API call (keeps the request under Vercel's 4.5MB body
  // limit). Coordinates come back normalized [0,1000], so the downscale never
  // costs us resolution — refinement runs on the full-res canvas.
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const smallCanvas = document.createElement("canvas");
  smallCanvas.width = w;
  smallCanvas.height = h;
  const smallCtx = smallCanvas.getContext("2d");
  if (!smallCtx) throw new Error("Canvas 2D context unavailable");
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(img, 0, 0, w, h);
  const smallBlob: Blob = await new Promise((resolve, reject) => {
    smallCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
  return { fullCanvas, smallBlob };
}

function cropCircleToSquareCanvas(
  source: HTMLCanvasElement,
  circle: Circle,
  paddingFactor: number,
): HTMLCanvasElement {
  const W = source.width;
  const H = source.height;
  const r = clamp(
    Math.round(circle.r * (1 + paddingFactor)),
    4,
    Math.min(W, H) / 2,
  );
  const cx = clamp(Math.round(circle.cx), r, W - r);
  const cy = clamp(Math.round(circle.cy), r, H - r);
  const size = r * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(source, cx - r, cy - r, size, size, 0, 0, size, size);
  return c;
}

async function callParse(blob: Blob): Promise<ParseResponse> {
  const fd = new FormData();
  fd.append("file", new File([blob], "screenshot.png", { type: "image/png" }));
  const res = await fetch("/api/parse-screenshot", { method: "POST", body: fd });
  if (!res.ok) {
    let message = `parse failed: ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as ParseResponse;
}

export async function parseScreenshot(file: File): Promise<ExtractedEntry[]> {
  const { fullCanvas, smallBlob } = await preprocessToCanvas(file);
  const screenshotUrl = fullCanvas.toDataURL("image/png");
  const FW = fullCanvas.width;
  const FH = fullCanvas.height;

  // One grounded pass: rank + name + coarse avatar box, bound together per row.
  const data = await callParse(smallBlob);
  const entries = (data.entries ?? [])
    .slice()
    .sort((a, b) => a.ymin - b.ymin);

  // Normalized [0,1000] boxes -> full-res -> stable circles (cx & r snapped to
  // the row-wise median; cy from each box's top edge). No pixel-scan refine.
  const circles: Circle[] = boxesToCircles(
    entries.map((e) => ({
      x0: (e.xmin / 1000) * FW,
      y0: (e.ymin / 1000) * FH,
      x1: (e.xmax / 1000) * FW,
      y1: (e.ymax / 1000) * FH,
    })),
  );

  console.log(
    `[parser] entries=${entries.length} circles=${circles.length} medR=${Math.round(circles[0]?.r ?? 0)}`,
  );

  return entries.map((entry, i) => {
    const circle = circles[i];
    const iconCanvas = cropCircleToSquareCanvas(fullCanvas, circle, CROP_PADDING);
    return {
      rank: entry.rank,
      iconImage: iconCanvas.toDataURL("image/png"),
      rawName: entry.name,
      cleanedName: cleanName(entry.name),
      source: {
        screenshotUrl,
        width: FW,
        height: FH,
        iconHint: circle,
        detected: circles,
      },
      pickPos: { x: circle.cx, y: circle.cy },
      pickRadius: Math.round(circle.r * (1 + CROP_PADDING)),
    };
  });
}
