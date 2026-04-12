# Chrome Web Store Listing Assets

## Name

VoiceMarkets

---

## Short description (132 chars max)

**日本語（ja）:**
音声でブックマーク・閲覧履歴を検索。話すだけで目的のページへ。Gemini Nano によるオンデバイス AI ランキング対応。

（118文字）

**English（en）:**
Navigate your bookmarks and history by voice. Speak a topic — find the page instantly. On-device AI ranking via Gemini Nano.

（124文字）

---

## Detailed description

### 日本語

**VoiceMarkets — 声でブラウザを操る**

ブックマークが何千件もあって、探すのが大変になっていませんか？
VoiceMarkets はマイクボタンをクリックして話しかけるだけで、あなたのブックマークや閲覧履歴からピッタリのページを見つけます。

**使い方**
1. 拡張機能のアイコンをクリックしてポップアップを開く
2. マイクボタンを押して、探したいページのトピックを話す
3. 結果が表示されたら、クリックしてページへジャンプ

**2段階の検索アルゴリズム**
- Stage 1: キーワード頻度と再訪問率でスコアリング（常時動作）
- Stage 2: Gemini Nano によるセマンティックランキング（利用可能な場合）

**プライバシー重視**
- ブックマーク・履歴データは一切外部サーバーに送信されません
- Gemini Nano のランキング処理はデバイス上で完結
- 音声認識は Web Speech API 経由（Google のサーバーを通ります）

**特徴**
- 日本語・英語のバイリンガルキーワード抽出
- 期間フィルター（1時間 / 24時間 / 1週間 / 1ヶ月 / 1年）
- 検索先切り替え（ブックマーク / 履歴）
- AI 非対応環境でもキーワード検索にフォールバック
- 外部 API キー不要、サインアップ不要

---

### English

**VoiceMarkets — Navigate your browser by voice**

Have thousands of bookmarks but struggle to find what you need? VoiceMarkets lets you speak a topic, place, or keyword and instantly surfaces the page from your own bookmarks and browsing history — no search engine, no external API.

**How it works**
1. Click the extension icon to open the popup
2. Press the mic button and speak what you're looking for
3. Click a result to jump to the page

**Two-stage search**
- Stage 1: Keyword frequency + recency scoring (always runs)
- Stage 2: Gemini Nano semantic re-ranking (when available in Chrome)

**Privacy-first**
- Your bookmarks and history never leave the browser
- Gemini Nano ranking runs fully on-device
- Voice transcription uses the Web Speech API (routed through Google's servers, same as Chrome's built-in speech input)

**Features**
- Bilingual keyword extraction (Japanese + English)
- Period filter (1h / 24h / 1 week / 1 month / 1 year)
- Source toggle (bookmarks / history)
- Silent fallback to keyword ranking when AI is unavailable
- No API key, no sign-up, no external service

---

## Category

- Primary: **Productivity**
- Secondary: **Accessibility**

## Language

- Japanese (ja) — primary
- English (en) — secondary

---

## Screenshots required

Chrome Web Store requires screenshots at **1280×800** or **640×400** px.

| # | 説明 | ファイル名 |
|---|------|-----------|
| 1 | ポップアップ初期状態（クリックして話す） | screenshot-01-idle.png |
| 2 | 音声認識中（パルスアニメーション） | screenshot-02-listening.png |
| 3 | 検索結果表示（上位5件） | screenshot-03-results.png |
| 4 | AI バッジ表示（Gemini Nano 使用） | screenshot-04-ai-badge.png |
| 5 | エラー状態（マイク未許可） | screenshot-05-error.png |

**Promotional tile (optional):** 440×280 px

---

## Privacy policy URL

https://sakamoto66.github.io/voicemarkets/privacy

---

## Single-purpose justification

This extension has a single purpose: allow users to navigate their existing bookmarks
and browser history using voice input, with optional on-device AI ranking via Gemini Nano.
No browsing data is transmitted to external servers controlled by this extension.
