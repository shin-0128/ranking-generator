"use client";
import { useState } from "react";
import type { ExtractedEntry } from "@/lib/extractor/types";
import { makeCircularAvatar } from "@/lib/circleAvatar";
import { REEL_GENRES, getGenre } from "@/lib/reelGenres";
import { REEL_EFFECTS } from "@/lib/reelEffects";
import { REEL_FONTS } from "@/lib/reelFonts";

interface Props {
  entries: ExtractedEntry[];
  rankCount: number;
  title?: string;
}

const MAX_REEL = 10; // cinematic length cap for now

type Phase = "idle" | "avatars" | "rendering" | "done" | "error";

export function RankingReelExport({ entries, rankCount, title }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [genreId, setGenreId] = useState(REEL_GENRES[0].id);
  const [effectId, setEffectId] = useState(REEL_EFFECTS[0].id);
  const [sound, setSound] = useState(false);
  const [fontId, setFontId] = useState(REEL_FONTS[0].id);
  const genre = getGenre(genreId);

  const shown = entries
    .filter((e) => e.iconImage)
    .slice(0, Math.min(rankCount, MAX_REEL));

  const generate = async () => {
    if (shown.length === 0) return;
    setVideoUrl(null);
    setPhase("avatars");
    setMsg(`アバターを準備中… (0/${shown.length})`);
    try {
      // 1) circular avatar PNG → host on Shotstack, in parallel
      let done = 0;
      const reelEntries = await Promise.all(
        shown.map(async (e, i) => {
          const blob = await makeCircularAvatar(e.iconImage, genre.ringStops);
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "image/png" },
            body: blob,
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || `ingest ${res.status}`);
          }
          const { url } = (await res.json()) as { url: string };
          done++;
          setMsg(`アバターを準備中… (${done}/${shown.length})`);
          return {
            rank: i + 1,
            name: e.cleanedName || e.rawName || "",
            url,
          };
        }),
      );

      // 2) submit the render
      setPhase("rendering");
      setMsg("動画をレンダリング中…（30秒前後）");
      const sub = await fetch("/api/render-reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: reelEntries,
          title,
          genre: genreId,
          effect: effectId,
          sound,
          font: fontId,
        }),
      });
      if (!sub.ok) {
        const j = await sub.json().catch(() => ({}));
        throw new Error(j.error || `render ${sub.status}`);
      }
      const { id } = (await sub.json()) as { id: string };

      // 3) poll until ready
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const st = await fetch(`/api/render-reel?id=${id}`);
        const sj = (await st.json()) as { status?: string; url?: string };
        if (sj.status === "done" && sj.url) {
          setVideoUrl(sj.url);
          setPhase("done");
          setMsg("");
          return;
        }
        if (sj.status === "failed") throw new Error("レンダリング失敗");
      }
      throw new Error("タイムアウト（時間をおいて再試行）");
    } catch (e) {
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const busy = phase === "avatars" || phase === "rendering";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">ジャンル:</span>
        {REEL_GENRES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGenreId(g.id)}
            disabled={busy}
            className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
              g.id === genreId
                ? "border-amber-400 bg-amber-400 text-zinc-900 font-semibold"
                : "border-zinc-700 text-zinc-300 hover:border-amber-500"
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">演出:</span>
        {REEL_EFFECTS.map((ef) => (
          <button
            key={ef.id}
            onClick={() => setEffectId(ef.id)}
            disabled={busy}
            className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
              ef.id === effectId
                ? "border-amber-400 bg-amber-400 text-zinc-900 font-semibold"
                : "border-zinc-700 text-zinc-300 hover:border-amber-500"
            }`}
          >
            {ef.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">フォント:</span>
        {REEL_FONTS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFontId(f.id)}
            disabled={busy}
            className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
              f.id === fontId
                ? "border-amber-400 bg-amber-400 text-zinc-900 font-semibold"
                : "border-zinc-700 text-zinc-300 hover:border-amber-500"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => setSound(e.target.checked)}
          disabled={busy}
          className="accent-amber-400"
        />
        効果音をつける
        <span className="text-zinc-500">
          （通常はOFF。TikTokでトレンド音源を乗せる人向け）
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={generate}
          disabled={busy || shown.length === 0}
          className="rounded-md bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 px-5 py-2 text-sm font-semibold text-zinc-900 transition-colors"
        >
          {busy ? "生成中…" : `MP4 を生成（上位 ${shown.length} 人）`}
        </button>
        {msg && (
          <span
            className={`text-sm ${phase === "error" ? "text-red-400" : "text-amber-400"}`}
          >
            {msg}
          </span>
        )}
      </div>

      {videoUrl && (
        <div className="space-y-2">
          <div className="flex justify-center bg-black rounded p-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              playsInline
              className="max-w-full h-auto rounded"
              style={{ maxHeight: "75vh" }}
            />
          </div>
          <div className="flex justify-end">
            <a
              href={videoUrl}
              download="ranking_reel.mp4"
              className="rounded-md bg-amber-500 hover:bg-amber-400 px-5 py-2 text-sm font-semibold text-zinc-900 transition-colors"
            >
              動画をダウンロード
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
