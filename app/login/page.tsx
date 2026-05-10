"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("パスワードを入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else if (res.status === 401) {
        setError("パスワードが違います");
      } else {
        setError("ログインエラー");
      }
    } catch {
      setError("送信エラー");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-3">
        <h1 className="text-xl font-bold">ログイン</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoFocus
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-amber-500"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 px-4 py-2 text-zinc-900 font-semibold"
        >
          {busy ? "..." : "ログイン"}
        </button>
      </form>
    </main>
  );
}
