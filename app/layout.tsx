import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ランキング画像生成",
  description: "TikTok 貢献ランキングから金枠ランキング画像を生成",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
