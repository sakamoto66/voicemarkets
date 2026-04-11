# VoiceMarkets

**Navigate your bookmarks and history by voice — no typing, no external API.**

音声入力でブックマークや履歴を検索し、目的のページを開く Chrome 拡張機能。
外部サービス不要 — 音声認識（Web Speech API）と AI ランキング（Gemini Nano）はすべてブラウザ内で動作します。

---

## Screenshots

| 音声入力中 | 結果表示 |
|-----------|---------|
| *(screenshot: voice-listening.png)* | *(screenshot: results.png)* |

---

## 機能

- マイクボタンを押して話すだけで検索
- ブックマーク・履歴をキーワードでスコアリング（Stage 1）
- Gemini Nano によるセマンティックランキング（Stage 2、利用可能な場合）
- AI 未対応環境でもキーワード検索にフォールバック
- 日本語・英語の両方に対応（バイリンガルキーワード抽出）
- 期間フィルター・検索先切り替え（ブックマーク / 履歴）

---

## インストール方法

### 1. 拡張機能を読み込む

1. `chrome://extensions/` を開く
2. 右上の「デベロッパー モード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリのディレクトリを選択する

### 2. AI ランキングについて

Gemini Nano は新しい Chrome では**フラグ設定なしで自動的に利用可能**な場合があります。
**利用できない環境でも、キーワード検索にフォールバックして動作します。**

#### 動作確認

拡張機能のポップアップを開き、コンソールに以下が表示されれば AI ランキングが有効です：

```
[VoiceMarkets] Gemini Nano availability: available
```

`chrome://components/` を開き、**Optimization Guide On Device Model** のバージョンが表示されていればモデルがインストール済みです。

#### AI ランキングが使えない場合（手動設定）

上記で `unavailable` と表示される場合は、以下を試してください：

1. `chrome://flags/#prompt-api-for-gemini-nano` を開き、**Enabled** に設定
2. `chrome://flags/#optimization-guide-on-device-model` を開き、**Enabled BypassPerfRequirement** に設定
3. Chrome を再起動する
4. `chrome://components/` で **Optimization Guide On Device Model** の「アップデートを確認」をクリック
5. バージョンが表示されたら完了（数分かかる場合あり）

> **注意:** Gemini Nano の提供状況は Chrome のバージョン・チャンネル・デバイスのスペックによって異なります。

---

## English

### What it does

VoiceMarkets is a Chrome extension that lets you navigate your bookmarks and browser history by voice. Speak a topic, a place, or a keyword — it finds the page you were looking for, without typing or scrolling through hundreds of results.

**No external API calls.** Voice recognition runs via the Web Speech API (routes through Google's servers for transcription). Semantic re-ranking runs via Gemini Nano — fully on-device inside Chrome.

### Why it exists

Every voice-in-browser extension treats voice as a **web search trigger** — you speak, it queries Google. VoiceMarkets treats voice as **personal navigation** — you speak, it finds something in your *own* browsing history.

Power users with thousands of bookmarks already have the information they want. They just can't get back to it fast enough. Voice + local AI makes recall near-instant.

### How to install

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this directory
4. Click the VoiceMarkets icon in the toolbar

### Privacy

- No data is sent to any server owned by this extension
- Voice transcription routes through Google's Web Speech API (same as the browser's built-in speech input)
- Gemini Nano ranking runs fully on-device — your bookmarks and history never leave the browser
- See the [Privacy Policy](https://sakamoto66.github.io/voicemarkets/privacy) for details

---

## 開発

```bash
# 依存関係のインストール
npm install
```

### ユニットテスト

純粋関数（`scoreItem()`, `extractKeywords()`, `parseAIResponse()` など）を対象とした Vitest テスト。

```bash
npm test          # 1回実行
npm run test:watch  # ウォッチモード
```

### E2E テスト

Playwright を使用して、Chrome 拡張機能のポップアップを実際のブラウザで動作確認します。
Chrome API（bookmarks / history / storage など）はモックデータに差し替えて実行されます。

```bash
npm run test:e2e          # ヘッドレス実行（通常）
npm run test:e2e:headed   # ブラウザ表示あり（デバッグ用）
npm run test:e2e:ui       # Playwright UI モード（インタラクティブ）
```

テスト結果レポートは `e2e/reports/` に HTML 形式で出力されます。

#### CI での実行

Chrome 拡張機能はヘッドレスモードでは動作しないため、CI 環境では `xvfb-run` が必要です。

```bash
xvfb-run npm run test:e2e
```

---

## アーキテクチャ

```
voicemarkets/
├── manifest.json              # MV3, permissions: bookmarks, history
├── popup/
│   ├── popup.html             # ポップアップ UI (360px)
│   ├── popup.js               # メインロジック: 音声入力・検索・ランキング
│   └── popup.css
├── background/
│   └── service-worker.js      # MV3 サービスワーカー（最小限）
└── icons/
```

### 2段階検索

**Stage 1 — キーワード検索（常時実行）**
1. 音声テキストからキーワードを抽出
2. `chrome.bookmarks.search()` でブックマーク検索
3. `chrome.history.search()` で履歴を取得しクライアント側でフィルタリング
4. キーワード頻度・再訪問率でスコアリング、上位 20 件を抽出

**Stage 2 — Gemini Nano セマンティックランキング（オプション）**
- `window.ai?.languageModel` の可否を確認してから呼び出し
- 上位候補 + 音声テキストを渡し、JSON 形式でスコアを受け取る
- 利用不可・失敗時は Stage 1 結果にサイレントフォールバック
