import type { ExtractedEntry } from "./extractor/types";

export interface ThemeRow {
  rank: number;
  iconCenter: [number, number];
  iconRadius: number;
  nameArea: [number, number, number, number];
  decoration?: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  size: { width: number; height: number };
  rows: ThemeRow[];
  fontFamily: string;
  fontColor: string;
  fontSize: number;
  titleArea?: [number, number, number, number];
  titleFontSize?: number;
  titleFontColor?: string;
}

const FONT_STACK =
  '"Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

function truncateToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (!text) return text;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + "…";
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  startSize: number,
  fontStack: string,
): number {
  let size = startSize;
  while (size > 12) {
    ctx.font = `bold ${size}px ${fontStack}`;
    if (ctx.measureText(text).width <= maxWidth && size <= maxHeight) {
      return size;
    }
    size -= 2;
  }
  return size;
}

export async function composeRanking(
  templateUrl: string,
  config: ThemeConfig,
  entries: ExtractedEntry[],
  canvas: HTMLCanvasElement,
  title: string = "",
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  canvas.width = config.size.width;
  canvas.height = config.size.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const template = await loadImage(templateUrl);
  ctx.drawImage(template, 0, 0, config.size.width, config.size.height);

  if (title && config.titleArea) {
    const [tx, ty, tw, th] = config.titleArea;
    const startSize = config.titleFontSize ?? 96;
    const color = config.titleFontColor ?? "#FFD700";
    const size = fitFontSize(ctx, title, tw - 40, th - 20, startSize, FONT_STACK);
    ctx.font = `bold ${size}px ${FONT_STACK}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, tx + tw / 2, ty + th / 2);
  }

  const rowsToRender = Math.min(entries.length, config.rows.length);
  for (let i = 0; i < rowsToRender; i++) {
    const entry = entries[i];
    const row = config.rows[i];

    if (entry.iconImage) {
      try {
        const icon = await loadImage(entry.iconImage);
        const [cx, cy] = row.iconCenter;
        const r = row.iconRadius;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        const aspect = icon.width / icon.height;
        let dw: number;
        let dh: number;
        if (aspect >= 1) {
          dh = r * 2;
          dw = dh * aspect;
        } else {
          dw = r * 2;
          dh = dw / aspect;
        }
        ctx.drawImage(icon, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
      } catch (err) {
        console.warn(`Failed to render icon for rank ${row.rank}`, err);
      }
    }

    const name = entry.cleanedName || entry.rawName;
    if (name) {
      ctx.fillStyle = config.fontColor;
      ctx.font = `bold ${config.fontSize}px ${FONT_STACK}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const [nx, ny, nw, nh] = row.nameArea;
      const text = truncateToFit(ctx, name, nw);
      ctx.fillText(text, nx, ny + nh / 2);
    }
  }
}

export function drawCalibrationOverlay(
  config: ThemeConfig,
  canvas: HTMLCanvasElement,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.lineWidth = 3;
  if (config.titleArea) {
    ctx.strokeStyle = "rgba(255, 200, 0, 0.85)";
    const [tx, ty, tw, th] = config.titleArea;
    ctx.strokeRect(tx, ty, tw, th);
  }
  for (const row of config.rows) {
    ctx.strokeStyle = "rgba(255, 60, 60, 0.85)";
    ctx.beginPath();
    ctx.arc(row.iconCenter[0], row.iconCenter[1], row.iconRadius, 0, Math.PI * 2);
    ctx.stroke();
    const [x, y, w, h] = row.nameArea;
    ctx.strokeStyle = "rgba(80, 200, 255, 0.85)";
    ctx.strokeRect(x, y, w, h);
  }
}
