"use client";
import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function ImageUploader({ onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length > 0) onFiles(arr);
  };

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors select-none ${
        dragOver
          ? "border-amber-500 bg-amber-500/5"
          : "border-zinc-700 hover:border-zinc-500"
      } ${disabled ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
    >
      <p className="text-zinc-300">
        TikTok 貢献ランキングのスクショをドロップ
      </p>
      <p className="text-xs text-zinc-500 mt-1">
        または クリックしてファイル選択（複数可）
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
