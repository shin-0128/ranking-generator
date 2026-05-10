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
ANTHROPIC_API_KEY=sk-ant-...
```

- `APP_PASSWORD` 未設定 → 認証無効（誰でもアクセス可、ローカル開発向け）
- `ANTHROPIC_API_KEY` 未設定 → スクショ解析機能が 500 エラー（手動入力モードのみ動作）

API キーは https://console.anthropic.com/ で発行。

## Vercel デプロイ

1. このディレクトリを GitHub リポジトリへ push
2. https://vercel.com/new で当該 repo を import
3. **Settings → Environment Variables** で以下を追加：
   - `APP_PASSWORD` (任意のパスワード)
   - `ANTHROPIC_API_KEY` (https://console.anthropic.com/ で発行)
4. Deploy

デプロイ後 `/login` で初回ログイン → cookie 30 日保持。

スクショ解析は Claude Sonnet 4.6 vision API を使用（1 枚あたり ~$0.01〜0.02）。

## 機能

- 複数スクショの D&D / クリック選択
- Tesseract.js による日本語+英語 OCR（ブラウザ内、サーバ送信なし）
- 順位連番でマージ、重複自動排除
- 金枠テンプレに合成し PNG ダウンロード
- 名前の絵文字・装飾記号を自動クリーニング、編集可能

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
