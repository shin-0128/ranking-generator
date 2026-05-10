import { createWorker } from "tesseract.js";
import type { NameExtractor } from "./types";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

let workerPromise: Promise<TesseractWorker> | null = null;

export async function getOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker(["jpn", "eng"], 1);
  }
  return workerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  imageWidth: number;
  imageHeight: number;
}

interface RawWord {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface RawLine {
  words?: RawWord[];
}

interface RawParagraph {
  lines?: RawLine[];
}

interface RawBlock {
  paragraphs?: RawParagraph[];
}

interface RawData {
  text?: string;
  words?: RawWord[];
  blocks?: RawBlock[];
}

function flattenWords(data: RawData): OcrWord[] {
  const out: OcrWord[] = [];
  const push = (w: RawWord | undefined) => {
    if (!w || !w.text || !w.bbox) return;
    out.push({
      text: w.text,
      confidence: w.confidence ?? 0,
      bbox: w.bbox,
    });
  };
  if (data.words && data.words.length > 0) {
    for (const w of data.words) push(w);
    return out;
  }
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) push(w);
      }
    }
  }
  return out;
}

export async function recognizeImage(
  source: HTMLCanvasElement,
): Promise<OcrResult> {
  const worker = await getOcrWorker();
  const result = await worker.recognize(
    source,
    {},
    { blocks: true } as Parameters<TesseractWorker["recognize"]>[2],
  );
  const data = result.data as unknown as RawData;
  return {
    text: data.text ?? "",
    words: flattenWords(data),
    imageWidth: source.width,
    imageHeight: source.height,
  };
}

export class TesseractExtractor implements NameExtractor {
  async extract(imageRegion: ImageData): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = imageRegion.width;
    canvas.height = imageRegion.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.putImageData(imageRegion, 0, 0);
    const { text } = await recognizeImage(canvas);
    return text.trim();
  }
}
