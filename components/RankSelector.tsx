"use client";

const OPTIONS = [10, 20, 30, 50, 100];

interface Props {
  value: number;
  onChange: (value: number) => void;
}

export function RankSelector({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-400">表示位数:</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500"
      >
        {OPTIONS.map((n) => (
          <option key={n} value={n}>
            上位 {n} 位
          </option>
        ))}
      </select>
    </label>
  );
}
