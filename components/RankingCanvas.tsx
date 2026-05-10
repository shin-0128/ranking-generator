"use client";
import { useEffect, useRef, useState } from "react";
import type { ExtractedEntry } from "@/lib/extractor/types";
import { type ThemeConfig, composeRanking, drawCalibrationOverlay } from "@/lib/composer";

interface Props {
  theme: ThemeConfig;
  templateUrl: string;
  entries: ExtractedEntry[];
  title?: string;
  showCalibration?: boolean;
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function RankingCanvas({ theme, templateUrl, entries, title, showCalibration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setBusy(true);
      try {
        if (typeof document !== "undefined" && document.fonts?.ready) {
          await document.fonts.ready;
        }
        await composeRanking(templateUrl, theme, entries, canvas, title ?? "");
        if (!cancelled && showCalibration) {
          drawCalibrationOverlay(theme, canvas);
        }
        if (!cancelled) setError(null);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [theme, templateUrl, entries, title, showCalibration]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ranking_${todayStamp()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-300">
          エラー: {error}
        </p>
      )}
      <div className="flex justify-center bg-zinc-900 rounded p-2">
        <canvas
          ref={canvasRef}
          className="max-w-full h-auto rounded"
          style={{ maxHeight: "70vh" }}
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={handleDownload}
          disabled={busy}
          className="rounded-md bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 px-5 py-2 text-sm font-semibold text-zinc-900 transition-colors"
        >
          画像を保存
        </button>
      </div>
    </div>
  );
}
