# VoiceMarkets TODOS

## Phase 3
- [x] **Gemini Nano トークン予算の実測**
  - What: 実際の payload (transcript + 20件候補) のトークン数を計測して候補数を調整
  - Why: 現在20件は仮定値。モデルのコンテキスト上限に当たると AI 呼び出しがサイレント失敗する
  - Status: `console.debug('[VoiceMarkets] AI prompt length (chars):', ...)` を追加済み。
    Chromeの開発者ツール Console でポップアップを開いて実測すること。
    20件候補でプロンプト全体が概ね 2,000–4,000 chars → ~500–1,000 tokens 見込み。

## Phase 4
- [x] **エラー UX 仕様化と実装**
  - マイク拒否 (NotAllowedError): 「マイク許可が必要です。chrome://settings/content/microphone で許可してください」
  - 音声認識タイムアウト (no-speech): 「音声が検出されませんでした。もう一度試してください」
  - キーワード抽出失敗: 「認識できませんでした。もう一度お試しください」
  - 結果0件: 「一致するページが見つかりませんでした」
  - Gemini Nano JSON パース失敗: **サイレントフォールバック** + 結果バッジで「キーワード順」表示
  - 検索例外: 「検索中にエラーが発生しました。もう一度お試しください」
