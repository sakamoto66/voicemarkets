# CLAUDE.md

## Project Overview

VoiceMarkets: Chrome MV3 extension for voice-driven bookmark/history navigation. All processing is local — Web Speech API + Chrome built-in AI (Gemini Nano, Translator API). No external services.

## Tech Stack

- Chrome MV3 (Manifest V3)
- Web Speech API (`lang: chrome.i18n.getUILanguage()`)
- `LanguageModel` global — Gemini Nano (Stage 0 intent parsing, Stage 2 ranking)
- `Translator` global — bilingual keyword extraction (UI language ↔ en)
- Permissions: `bookmarks`, `history`, `tabs`, `storage`, `windows`

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Vitest unit tests (pure functions) |
| `npm run test:e2e` | Playwright E2E tests |

## Module Structure

| File | Role |
|------|------|
| `popup/popup.js` | Orchestrator: app state, event wiring |
| `popup/voice.js` | Web Speech API (`createVoice`) |
| `popup/ai.js` | Translator + Gemini Nano (intent / ranking) |
| `popup/search.js` | Pure functions: keyword extraction, scoring, filtering |
| `popup/cache.js` | Startup bookmark fetch via `chrome.bookmarks.getTree()` |
| `popup/i18n.js` | `t()` wrapper + `applyI18n()` |
| `popup/render.js` | DOM helpers |

## Architecture: Three-Stage Search

1. **Stage 0** (Gemini Nano, optional): select best speech alt, detect period, expand keywords bilingually, determine sources
2. **Stage 1**: bookmarks from memory cache filtered client-side; history via per-keyword `chrome.history.search()` (top 8 longest tokens); score + top 20
3. **Stage 2** (Gemini Nano, optional): re-rank top **5**; silent fallback to Stage 1 order

## Critical Constraints

- **Intl.Segmenter**: `extractKeywords()` uses `Intl.Segmenter(undefined, { granularity: 'word' })` — same ICU engine as Chrome's history index. Do NOT revert to whitespace splitting.
- **CJK min length**: Han/Hiragana/Katakana/Hangul → min 2 chars; Latin → min 3.
- **History `startTime`**: always pass explicitly — omitting triggers undocumented 24h default. Fallback: `Date.now() - 90 * 86_400_000`.
- **Gemini Nano JSON**: strip markdown fences + `try/catch` before `JSON.parse()`, even with `responseConstraint`.
- **Top-5 limit** in Stage 2 is a measured tradeoff — test before increasing.

## Behavioral Principles

- 3ステップ以上のタスクは必ずPlanモードで開始する
- コードを読まずに書かない。既存の実装を確認してから変更する
- 動作を証明できるまでタスクを完了とマークしない
- 変更は必要な箇所のみ。影響範囲を最小化する
- コンテキストが逼迫したら正直に伝えて区切りを提案する

## Skill Routing

Invoke skills FIRST, before any other action:

| Trigger | Skill |
|---------|-------|
| bugs / errors / broken | `investigate` |
| ship / PR / deploy | `ship` |
| QA / find bugs | `qa` |
| code review | `review` |
| architecture review | `plan-eng-review` |
| product ideas / brainstorm | `office-hours` |
| checkpoint / resume | `checkpoint` |
