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

export async function parseScreenshot(file: File): Promise<ExtractedEntry[]> {
  const { fullCanvas, smallCanvas, smallBlob } = await preprocessToCanvas(file);

  const formData = new FormData();
  formData.append(
    "file",
    new File([smallBlob], "screenshot.png", { type: "image/png" }),
  );
  formData.append("width", String(smallCanvas.width));
  formData.append("height", String(smallCanvas.height));

  const res = await fetch("/api/parse-screenshot", {
    method: "POST",
    body: formData,
  });
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
  const data = (await res.json()) as ParseResponse;
  const screenshotUrl = fullCanvas.toDataURL("image/png");
  const scaleX = fullCanvas.width / smallCanvas.width;
  const scaleY = fullCanvas.height / smallCanvas.height;

  const detected = detectAvatars(fullCanvas);
  const tolerancePx = Math.round(fullCanvas.height * 0.03);
  const hints = data.entries.map((e) => ({
    cy: e.iconCircle.cy * scaleY,
  }));
  const matches = matchByY(hints, detected, tolerancePx);
  const matchedCount = matches.filter((m) => m).length;
  console.log(
    `[parser] detected ${detected.length} avatars, matched ${matchedCount}/${data.entries.length} entries (tolerance ${tolerancePx}px)`,
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
        width: fullCanvas.width,
        height: fullCanvas.height,
        iconHint: claudeFull,
        detected,
      },
      pickPos: { x: finalCircle.cx, y: finalCircle.cy },
      pickRadius: Math.round(finalCircle.r),
    };
  });
}
