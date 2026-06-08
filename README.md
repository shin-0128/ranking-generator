# TikTok 貢献ランキング → 金枠ランキング画像

TikTok の貢献ランキングのスクショから、金枠デザインのランキング画像 (PNG) を生成するブラウザ完結ツール。

## ローカル開発

```bash
pnpm install
pnpm dev
```

http://localhost:3000

## 環境変数 (`.env.local`)

```
APP_PASSWORD=任意のパスワード
GOOGLE_API_KEY=AIza...
```

- `APP_PASSWORD` 未設定 → 認証無効（誰でもアクセス可、ローカル開発向け）
- `GOOGLE_API_KEY` 未設定 → スクショ解析機能が 500 エラー（手動入力モードのみ動作）

API キーは https://aistudio.google.com/apikey で発行。

## Vercel デプロイ

1. このディレクトリを GitHub リポジトリへ push
2. https://vercel.com/new で当該 repo を import
3. **Settings → Environment Variables** で以下を追加：
   - `APP_PASSWORD` (任意のパスワード)
   - `GOOGLE_API_KEY` (https://aistudio.google.com/apikey で発行)
4. Deploy

デプロイ後 `/login` で初回ログイン → cookie 30 日保持。

スクショ解析は Gemini vision API の単一パス（順位・名前・アバター枠を 1 リクエストで取得）。
過負荷時は複数モデルへ自動フォールバック（`gemini-3.5-flash` → `gemini-2.5-flash` → …）。

## 機能

- 複数スクショの D&D / クリック選択
- Gemini 単一パスで順位・名前・アバター枠を grounded 抽出（行ごとに束ねるため取り違えなし）
- アバター枠は構造的に安定化（同列・同サイズの中央値 + Y グリッド回帰）して正方形クロップ
- 順位連番でマージ、重複自動排除
- 金枠テンプレに合成し PNG ダウンロード
- 名前の絵文字・装飾記号を自動クリーニング、編集可能
- スクショから手動でアイコン再選択（自動が外れた行の補正）

## 開発用テストツール (`scripts/`)

`test-shots/` に実スクショを置いて（gitignore 済み）:

- `node scripts/test-detection.mjs` — 検出ジオメトリを数値検証（列・サイズ・Y ピッチの一貫性）
- `node scripts/contact-sheet.mjs` — 全アバターのクロップを 1 枚に並べて目視
- `node scripts/tune-padding.mjs <pad...>` — クロップ余白を円形描画で比較

## テーマ追加

`public/themes/<id>/` に `template.png` と `config.json` を配置：

```jsonc
{
  "id": "<id>",
  "name": "<表示名>",
  "size": { "width": 941, "height": 1672 },
  "rows": [
    { "rank": 1, "iconCenter": [x, y], "iconRadius": r, "nameArea": [x, y, w, h] }
    // ... 行数ぶん
  ],
  "fontFamily": "Noto Sans JP",
  "fontColor": "#FFFFFF",
  "fontSize": 50
}
```

座標調整は UI の「座標オーバーレイ」チェックで赤丸（icon）と青枠（name）を重ねて確認。

## ディレクトリ

```
app/
  api/login/    認証 API
  login/        ログインページ
components/     React コンポーネント
lib/
  extractor/    OCR 抽象（Tesseract / Claude 用）
  parser.ts     スクショ → エントリ抽出
  cleaner.ts    名前クリーニング
  composer.ts   金枠合成
public/themes/  テーマアセット
middleware.ts   認証ガード
```
