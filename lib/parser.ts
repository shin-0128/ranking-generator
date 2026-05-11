import type { ExtractedEntry } from "./extractor/types";
import { cleanName } from "./cleaner";
import { detectAvatars, matchByY } from "./extractor/avatar-detect";

interface IconCircle {
  cx: number;
  cy: number;
  r: number;
}

interface ParseResponse {
  entries: Array<{
    rank: number;
    name: string;
    iconCircle: IconCircle;
  }>;
}

interface GeminiBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface GeminiResponse {
  avatars: GeminiBox[];
}

function boxToCircle(box: GeminiBox, W: number, H: number): IconCircle {
  // box coords are in [0, 1000] normalized space
  const xmin = (box.xmin / 1000) * W;
  const xmax = (box.xmax / 1000) * W;
  const ymin = (box.ymin / 1000) * H;
  const ymax = (box.ymax / 1000) * H;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  const w = xmax - xmin;
  const h = ymax - ymin;
  const r = Math.max(w, h) / 2;
  return { cx, cy, r };
}

const MAX_DIM = 1568;

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
  smallCanvas: HTMLCanvasElement;
  smallBlob: Blob;
}> {
  const img = await loadImageFromFile(file);

  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = img.naturalWidth;
  fullCanvas.height = img.naturalHeight;
  const fullCtx = fullCanvas.getContext("2d");
  if (!fullCtx) throw new Error("Canvas 2D context unavailable");
  fullCtx.drawImage(img, 0, 0);

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
  return { fullCanvas, smallCanvas, smallBlob };
}

function cropCircleToSquareCanvas(
  source: HTMLCanvasElement,
  circle: IconCircle,
): HTMLCanvasElement {
  const W = source.width;
  const H = source.height;
  const r = clamp(Math.round(circle.r), 4, Math.min(W, H) / 2);
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

async function callParse(blob: Blob, w: number, h: number): Promise<ParseResponse> {
  const fd = new FormData();
  fd.append("file", new File([blob], "screenshot.png", { type: "image/png" }));
  fd.append("width", String(w));
  fd.append("height", String(h));
  const res = await fetch("/api/parse-screenshot", { method: "POST", body: fd });
  if (!res.ok) {
    let message = `parse failed: ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return (await res.json()) as ParseResponse;
}

async function callDetect(blob: Blob): Promise<GeminiResponse | null> {
  try {
    const fd = new FormData();
    fd.append("file", new File([blob], "screenshot.png", { type: "image/png" }));
    const res = await fetch("/api/detect-avatars", { method: "POST", body: fd });
    if (!res.ok) {
      console.warn(`[parser] gemini detect failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as GeminiResponse;
  } catch (e) {
    console.warn("[parser] gemini detect error", e);
    return null;
  }
}

export async function parseScreenshot(file: File): Promise<ExtractedEntry[]> {
  const { fullCanvas, smallCanvas, smallBlob } = await preprocessToCanvas(file);
  const screenshotUrl = fullCanvas.toDataURL("image/png");
  const scaleX = fullCanvas.width / smallCanvas.width;
  const scaleY = fullCanvas.height / smallCanvas.height;
  const FW = fullCanvas.width;
  const FH = fullCanvas.height;

  // Run Claude (rank+name) and Gemini (avatar bounding boxes) in parallel
  const [data, gemini] = await Promise.all([
    callParse(smallBlob, smallCanvas.width, smallCanvas.height),
    callDetect(smallBlob),
  ]);

  // Convert Gemini boxes to full-resolution circles, sorted by Y
  const geminiCircles: IconCircle[] = (gemini?.avatars ?? [])
    .map((b) => boxToCircle(b, FW, FH))
    .sort((a, b) => a.cy - b.cy);

  // Fallback heuristic detection
  const heuristicDetected = geminiCircles.length === 0
    ? detectAvatars(fullCanvas)
    : [];

  // Sort Claude entries by hint Y to match Gemini's top-to-bottom order
  const sortedEntries = data.entries
    .map((e, originalIdx) => ({ e, originalIdx, cy: e.iconCircle.cy * scaleY }))
    .sort((a, b) => a.cy - b.cy);
  const candidates = geminiCircles.length > 0 ? geminiCircles : heuristicDetected;

  // Build matches array indexed by original entry order
  const matches: Array<IconCircle | null> = new Array(data.entries.length).fill(
    null,
  );
  if (candidates.length === sortedEntries.length) {
    // Perfect match: zip in order (most reliable when counts agree)
    sortedEntries.forEach((s, i) => {
      matches[s.originalIdx] = candidates[i];
    });
  } else {
    // Fallback: nearest-Y matching
    const tolerancePx = Math.round(FH * 0.06);
    const hints = sortedEntries.map((s) => ({ cy: s.cy }));
    const nearMatches = matchByY(hints, candidates, tolerancePx);
    sortedEntries.forEach((s, i) => {
      matches[s.originalIdx] = nearMatches[i];
    });
  }
  const matchedCount = matches.filter((m) => m).length;
  console.log(
    `[parser] gemini=${geminiCircles.length} heuristic=${heuristicDetected.length} entries=${data.entries.length} matched=${matchedCount} (mode=${candidates.length === sortedEntries.length ? "zip" : "nearest"})`,
  );

  return data.entries.map((entry, i) => {
    const claudeFull: IconCircle = {
      cx: entry.iconCircle.cx * scaleX,
      cy: entry.iconCircle.cy * scaleY,
      r: entry.iconCircle.r * scaleX,
    };
    const matched = matches[i];
    const finalCircle: IconCircle = matched
      ? { cx: matched.cx, cy: matched.cy, r: matched.r }
      : claudeFull;
    const iconCanvas = cropCircleToSquareCanvas(fullCanvas, finalCircle);
    return {
      rank: entry.rank,
      iconImage: iconCanvas.toDataURL("image/png"),
      rawName: entry.name,
      cleanedName: cleanName(entry.name),
      source: {
        screenshotUrl,
        width: FW,
        height: FH,
        iconHint: claudeFull,
        detected: candidates,
      },
      pickPos: { x: finalCircle.cx, y: finalCircle.cy },
      pickRadius: Math.round(finalCircle.r),
    };
  });
}
