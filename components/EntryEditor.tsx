"use client";
import { useRef } from "react";
import type { ExtractedEntry } from "@/lib/extractor/types";
import { cleanName } from "@/lib/cleaner";

interface Props {
  entries: ExtractedEntry[];
  rankCount: number;
  activeIdx?: number | null;
  onChange: (entries: ExtractedEntry[]) => void;
  onActivate?: (idx: number) => void;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EntryEditor({
  entries,
  rankCount,
  activeIdx,
  onChange,
  onActivate,
}: Props) {
  const rows: ExtractedEntry[] = Array.from({ length: rankCount }, (_, i) => {
    return (
      entries[i] ?? {
        rank: -(i + 1),
        iconImage: "",
        rawName: "",
        cleanedName: "",
      }
    );
  });

  const updateEntry = (idx: number, partial: Partial<ExtractedEntry>) => {
    const next = [...rows];
    next[idx] = { ...rows[idx], ...partial };
    onChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-800 text-zinc-400">
          <tr>
            <th className="py-2 px-2 text-left w-12">順位</th>
            <th className="py-2 px-2 text-left w-32">アイコン</th>
            <th className="py-2 px-2 text-left">名前</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, i) => (
            <Row
              key={i}
              entry={entry}
              displayRank={i + 1}
              isActive={activeIdx === i}
              onNameChange={(v) =>
                updateEntry(i, { rawName: v, cleanedName: cleanName(v) })
              }
              onIconUpload={async (file) => {
                const dataUrl = await readAsDataURL(file);
                updateEntry(i, { iconImage: dataUrl, pickPos: undefined });
              }}
              onIconClear={() =>
                updateEntry(i, { iconImage: "", pickPos: undefined })
              }
              onActivate={() => onActivate?.(i)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RowProps {
  entry: ExtractedEntry;
  displayRank: number;
  isActive: boolean;
  onNameChange: (value: string) => void;
  onIconUpload: (file: File) => void;
  onIconClear: () => void;
  onActivate: () => void;
}

function Row({
  entry,
  displayRank,
  isActive,
  onNameChange,
  onIconUpload,
  onIconClear,
  onActivate,
}: RowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSource = !!entry.source;
  const handleIconClick = () => {
    if (hasSource) onActivate();
    else fileRef.current?.click();
  };
  return (
    <tr
      className={`border-b border-zinc-900 ${
        isActive ? "bg-amber-500/10" : ""
      }`}
    >
      <td className="py-2 px-2 font-semibold text-amber-400">{displayRank}</td>
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleIconClick}
            className={`size-12 rounded-full overflow-hidden border transition-colors flex items-center justify-center bg-zinc-800 ${
              isActive
                ? "border-amber-400 ring-2 ring-amber-400"
                : "border-zinc-700 hover:border-amber-500"
            }`}
            title={hasSource ? "スクショから再選択" : "アイコンを選択"}
          >
            {entry.iconImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.iconImage}
                alt={`rank ${entry.rank}`}
                className="size-full object-cover"
              />
            ) : (
              <span className="text-xs text-zinc-500">+</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onIconUpload(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-zinc-500 hover:text-amber-400"
              title="ファイルからアップロード"
            >
              📁
            </button>
            {entry.iconImage && (
              <button
                onClick={onIconClear}
                className="text-xs text-zinc-500 hover:text-red-400"
                title="アイコンをクリア"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </td>
      <td className="py-2 px-2">
        <input
          type="text"
          value={entry.rawName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="名前を入力"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1 focus:outline-none focus:border-amber-500"
        />
        {entry.rawName && entry.cleanedName !== entry.rawName && (
          <p className="text-xs text-zinc-500 mt-0.5">→ {entry.cleanedName}</p>
        )}
      </td>
    </tr>
  );
}
