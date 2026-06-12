"use client";
import { useRef } from "react";
import type { ExtractedEntry } from "@/lib/extractor/types";
import type { ThemeConfig } from "@/lib/composer";
import { RankingCanvas } from "./RankingCanvas";

interface Props {
  theme: ThemeConfig;
  templateUrl: string;
  entries: ExtractedEntry[];
  rankCount: number;
  title?: string;
  showCalibration?: boolean;
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Paginates the ranking across the template's slot count. The gold template has
 * 10 baked positions, so 30 ranks → 3 pages (1–10, 11–20, 21–30). Per the agreed
 * MVP the baked row numbers stay 1–10 on every page and the page range is shown
 * in the title instead — no template asset changes needed.
 */
export function RankingPages({
  theme,
  templateUrl,
  entries,
  rankCount,
  title,
  showCalibration,
}: Props) {
  const pageSize = theme.rows.length || 10;
  const shown = entries.slice(0, rankCount);
  const pages: ExtractedEntry[][] = [];
  for (let i = 0; i < shown.length; i += pageSize) {
    pages.push(shown.slice(i, i + pageSize));
  }
  const multi = pages.length > 1;
  const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const saveAll = async () => {
    const stamp = todayStamp();
    const ordered = [...canvases.current.entries()].sort((a, b) => a[0] - b[0]);
    for (const [idx, canvas] of ordered) {
      const start = idx * pageSize + 1;
      const end = Math.min(start + pageSize - 1, shown.length);
      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ranking_${stamp}_${String(start).padStart(2, "0")}-${end}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
          resolve();
        }, "image/png");
      });
      // Browsers throttle/merge rapid programmatic downloads — space them out.
      await new Promise((r) => setTimeout(r, 350));
    }
  };

  // No entries yet: still preview the bare template (matches prior behavior).
  if (pages.length === 0) {
    return (
      <RankingCanvas
        theme={theme}
        templateUrl={templateUrl}
        entries={[]}
        title={title}
        showCalibration={showCalibration}
      />
    );
  }

  return (
    <div className="space-y-6">
      {multi && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            {pages.length} ページ（{pageSize} 位ずつ）
          </p>
          <button
            onClick={saveAll}
            className="rounded-md bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-sm font-semibold text-zinc-900 transition-colors"
          >
            全ページ保存（{pages.length}枚）
          </button>
        </div>
      )}
      {pages.map((pageEntries, i) => {
        const start = i * pageSize + 1;
        const end = start + pageEntries.length - 1;
        const range = `${start}–${end}位`;
        const pageTitle = multi
          ? `${title ? `${title} ` : ""}${range}`
          : title;
        return (
          <RankingCanvas
            key={i}
            theme={theme}
            templateUrl={templateUrl}
            entries={pageEntries}
            title={pageTitle}
            heading={multi ? range : undefined}
            downloadName={
              multi ? `ranking_${String(start).padStart(2, "0")}-${end}` : undefined
            }
            showCalibration={showCalibration}
            registerRef={(el) => {
              if (el) canvases.current.set(i, el);
              else canvases.current.delete(i);
            }}
          />
        );
      })}
    </div>
  );
}
