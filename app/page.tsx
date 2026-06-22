"use client";
import { useEffect, useMemo, useState } from "react";
import { ImageUploader } from "@/components/ImageUploader";
import { EntryEditor } from "@/components/EntryEditor";
import { RankSelector } from "@/components/RankSelector";
import { RankingPages } from "@/components/RankingPages";
import { RankingReelExport } from "@/components/RankingReelExport";
import { ScreenshotIconPicker } from "@/components/ScreenshotIconPicker";
import type { ExtractedEntry } from "@/lib/extractor/types";
import type { ThemeConfig } from "@/lib/composer";
import { parseScreenshot } from "@/lib/parser";

const TEMPLATE_URL = "/themes/gold/template.png";
const CONFIG_URL = "/themes/gold/config.json";
const DEFAULT_CROP_RADIUS = 80;
const CROP_RADIUS_MIN = 20;
const CROP_RADIUS_MAX = 300;

function medianHintRadius(entries: ExtractedEntry[]): number | null {
  const rs = entries
    .map((e) => e.source?.iconHint?.r)
    .filter((r): r is number => typeof r === "number" && r > 0);
  if (rs.length === 0) return null;
  rs.sort((a, b) => a - b);
  return rs[Math.floor(rs.length / 2)];
}

export default function Home() {
  const [theme, setTheme] = useState<ThemeConfig | null>(null);
  const [entries, setEntries] = useState<ExtractedEntry[]>([]);
  const [rankCount, setRankCount] = useState(10);
  const [title, setTitle] = useState("ランキング");
  const [showCalibration, setShowCalibration] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [cropRadius, setCropRadius] = useState(DEFAULT_CROP_RADIUS);

  useEffect(() => {
    fetch(CONFIG_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`config fetch: ${r.status}`);
        return r.json();
      })
      .then((data: ThemeConfig) => setTheme(data))
      .catch((e) => setThemeError(e instanceof Error ? e.message : String(e)));
  }, []);

  const activeEntry = activeIdx != null ? entries[activeIdx] : null;
  const activeSource = activeEntry?.source ?? null;

  const sameSourceMarkers = useMemo(() => {
    if (!activeSource) return [];
    return entries
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          e.pickPos &&
          e.source?.screenshotUrl === activeSource.screenshotUrl,
      )
      .map(({ e, i }) => ({
        x: e.pickPos!.x,
        y: e.pickPos!.y,
        r: e.pickRadius ?? cropRadius,
        label: String(i + 1),
      }));
  }, [entries, activeSource, cropRadius]);

  useEffect(() => {
    if (entries.length === 0) {
      if (activeIdx !== null) setActiveIdx(null);
      return;
    }
    if (activeIdx != null && activeIdx < entries.length) return;
    const firstWithSource = entries.findIndex((e) => e.source);
    setActiveIdx(firstWithSource !== -1 ? firstWithSource : null);
  }, [entries, activeIdx]);

  const handlePick = (
    cropDataUrl: string,
    pickPos: { x: number; y: number },
    radius: number,
  ) => {
    if (activeIdx == null) return;
    const next = [...entries];
    next[activeIdx] = {
      ...next[activeIdx],
      iconImage: cropDataUrl,
      pickPos,
      pickRadius: radius,
    };
    setEntries(next);
    setCropRadius(radius);
  };

  const handleFiles = async (files: File[]) => {
    setParsing(true);
    setParseStatus(`スクショを解析中...`);
    try {
      const newEntries: ExtractedEntry[] = [];
      for (let i = 0; i < files.length; i++) {
        setParseStatus(`スクショ ${i + 1}/${files.length} を解析中...`);
        const parsed = await parseScreenshot(files[i]);
        newEntries.push(...parsed);
      }
      let mergedTotal = 0;
      setEntries((prev) => {
        const byRank = new Map<number, ExtractedEntry>();
        for (const e of prev) byRank.set(e.rank, e);
        for (const e of newEntries) byRank.set(e.rank, e);
        const merged = [...byRank.values()].sort((a, b) => a.rank - b.rank);
        mergedTotal = merged.length;
        return merged;
      });
      const med = medianHintRadius(newEntries);
      if (med)
        setCropRadius(
          Math.max(CROP_RADIUS_MIN, Math.min(CROP_RADIUS_MAX, Math.round(med))),
        );
      setParseStatus(
        `✓ ${newEntries.length} 件追加（合計 ${mergedTotal} / 表示上限 ${rankCount}）`,
      );
    } catch (err) {
      setParseStatus(
        `エラー: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setParsing(false);
    }
  };

  const handleClear = () => {
    setEntries([]);
    setActiveIdx(null);
    setParseStatus(null);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold">
            TikTok 貢献ランキング → 金枠ランキング画像
          </h1>
        </header>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
          <ImageUploader onFiles={handleFiles} disabled={parsing} />
          <div className="flex items-center justify-between gap-3">
            {parseStatus ? (
              <p
                className={`text-sm ${parsing ? "text-amber-400" : "text-zinc-400"}`}
              >
                {parseStatus}
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                追加で読み込むと既存に積まれます。新規開始は「クリア」。
              </p>
            )}
            {entries.length > 0 && (
              <button
                onClick={handleClear}
                disabled={parsing}
                className="shrink-0 text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
              >
                クリア（{entries.length}件）
              </button>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
          {theme?.titleArea && (
            <label className="flex items-center gap-3 text-sm">
              <span className="text-zinc-400 w-16 shrink-0">タイトル:</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: ランキング、トップ10、月間 MVP"
                className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 focus:outline-none focus:border-amber-500"
              />
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RankSelector value={rankCount} onChange={setRankCount} />
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showCalibration}
                onChange={(e) => setShowCalibration(e.target.checked)}
                className="size-4 accent-amber-500"
              />
              座標オーバーレイ（位置調整用）
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="font-semibold mb-3">エントリ一覧</h2>
          <EntryEditor
            entries={entries}
            rankCount={rankCount}
            activeIdx={activeIdx}
            onChange={setEntries}
            onActivate={(idx) => setActiveIdx(idx)}
          />
        </section>

        {activeSource && activeEntry && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                スクショから選択{" "}
                <span className="text-amber-400 ml-2">
                  rank {activeIdx! + 1}
                  {activeEntry.cleanedName ? `: ${activeEntry.cleanedName}` : ""}
                </span>
              </h2>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <span>クロップ半径:</span>
                <input
                  type="range"
                  min={CROP_RADIUS_MIN}
                  max={CROP_RADIUS_MAX}
                  value={cropRadius}
                  onChange={(e) => setCropRadius(Number(e.target.value))}
                  className="accent-amber-500"
                />
                <span className="w-10 text-right tabular-nums">
                  {cropRadius}
                </span>
              </label>
            </div>
            <p className="text-xs text-zinc-400">
              スクショ上のアイコンをクリック →
              選択中の順位に割り当て、自動で次の順位に進みます。エントリ一覧でアイコンをタップすれば選択中の順位を変更できます。
            </p>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {entries.map((e, i) => {
                const isActive = i === activeIdx;
                const hasIcon = !!e.iconImage;
                const displayRank = i + 1;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={`min-w-[40px] h-10 px-2 rounded-md text-sm font-bold transition-colors ${
                      isActive
                        ? "bg-amber-400 text-zinc-900"
                        : hasIcon
                          ? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                          : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
                    }`}
                    title={`rank ${displayRank}: ${e.cleanedName ?? ""}`}
                  >
                    {displayRank}
                  </button>
                );
              })}
            </div>
            <ScreenshotIconPicker
              source={activeSource}
              cropRadius={cropRadius}
              markers={sameSourceMarkers}
              activeLabel={String(activeIdx! + 1)}
              onPick={handlePick}
              onMarkerTap={(label) => {
                const idx = Number(label) - 1;
                if (idx >= 0 && idx < entries.length) setActiveIdx(idx);
              }}
            />
          </section>
        )}

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="font-semibold mb-3">プレビュー</h2>
          {themeError && (
            <p className="rounded bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-300">
              テーマ読み込みエラー: {themeError}
            </p>
          )}
          {theme && (
            <RankingPages
              theme={theme}
              templateUrl={TEMPLATE_URL}
              entries={entries}
              rankCount={rankCount}
              title={title}
              showCalibration={showCalibration}
            />
          )}
        </section>

        {entries.length > 0 && (
          <section className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-4">
            <h2 className="font-semibold mb-1">
              動画リール <span className="text-amber-400 text-sm">β（全画面カウントダウン）</span>
            </h2>
            <p className="text-xs text-zinc-400 mb-3">
              上位を 1人ずつ全画面でドラマチックに発表（9:16・MP4）。本物のアイコンが動くのが差別化ポイント。
            </p>
            <RankingReelExport entries={entries} rankCount={rankCount} title={title} />
          </section>
        )}
      </div>
    </main>
  );
}
