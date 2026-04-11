# VoiceMarkets

音声入力でブックマークや履歴を検索し、目的のページを開く Chrome 拡張機能。
外部サービス不要 — 音声認識（Web Speech API）と AI ランキング（Gemini Nano）はすべてブラウザ内で動作します。

## 機能

- マイクボタンを押して話すだけで検索
- ブックマーク・履歴をキーワードでスコアリング（Stage 1）
- Gemini Nano によるセマンティックランキング（Stage 2、利用可能な場合）
- AI 未対応環境でもキーワード検索にフォールバック

## インストール方法

### 1. 拡張機能を読み込む

1. `chrome://extensions/` を開く
2. 右上の「デベロッパー モード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリのディレクトリを選択する

### 2. AI ランキングを有効にする（オプション）

Gemini Nano による AI ランキングを使用するには、以下の設定が必要です。
**未設定でもキーワード検索は動作します。**

#### Chrome フラグの設定

1. `chrome://flags/#prompt-api-for-gemini-nano` を開き、**Enabled** に設定
2. `chrome://flags/#optimization-guide-on-device-model` を開き、**Enabled BypassPerfRequirement** に設定
3. Chrome を再起動する

#### モデルのダウンロード

1. `chrome://components/` を開く
2. **Optimization Guide On Device Model** を探す
3. 「アップデートを確認」をクリックしてモデルをダウンロードする
4. ステータスが `Version: 2024.x.x.x` のように表示されれば完了

> **注意:** モデルのダウンロードには数分かかる場合があります。また、Gemini Nano は現在 Origin Trial 段階のため、将来的にフラグ設定が不要になる予定です。

## 動作確認

拡張機能のポップアップを開き、コンソールに以下が表示されれば AI ランキングが有効です：

```
[VoiceMarkets] Gemini Nano availability: available
```

`unavailable` と表示された場合はキーワード検索モードで動作します。

## 開発

```bash
# 依存関係のインストール
npm install

# ユニットテストの実行
npm test
```

テスト対象の純粋関数: `scoreItem()`, `extractKeywords()`, `parseAIResponse()`

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
