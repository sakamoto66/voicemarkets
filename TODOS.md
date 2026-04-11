# VoiceMarkets TODOS

## Phase 3
- [ ] **Gemini Nano トークン予算の実測**
  - What: 実際の payload (transcript + 20件候補) のトークン数を計測して候補数を調整
  - Why: 現在20件は仮定値。モデルのコンテキスト上限に当たると AI 呼び出しがサイレント失敗する
  - Depends on: Phase 2 完了 (候補リストの実データが必要)

## Phase 4
- [ ] **エラー UX 仕様化** (Phase 4 開始前に決める)
  - What: 以下のエラー状態の表示文言と挙動を決める
    - マイク拒否 (NotAllowedError)
    - 音声認識タイムアウト (ユーザーが無言)
    - 結果0件
    - Gemini Nano JSON パース失敗 (サイレントフォールバック or 通知?)
  - Why: 実装中に場当たり的に決めると一貫性がなくなる
