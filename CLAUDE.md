# CLAUDE.md

## Project Overview

VoiceMarkets: Chrome MV3 extension for voice-driven bookmark/history navigation. All processing is local — Web Speech API + Chrome built-in AI (Gemini Nano, Translator API). No external services.

## Tech Stack

- Chrome MV3, Web Speech API (lang: `chrome.i18n.getUILanguage()`), `LanguageModel` global (Gemini Nano), `Translator` global
- Permissions: `bookmarks`, `history`, `tabs`, `storage`, `windows`
- Tests: `npm test` (Vitest, pure functions) · `npm run test:e2e` (Playwright)

## Architecture: Three-Stage Search

1. **Stage 0 — Intent parsing** (Gemini Nano, optional): select best speech alternative, detect time period, expand keywords bilingually, determine sources; falls back to Stage 1 on failure
2. **Stage 1 — Keyword filter**: `chrome.bookmarks.search()` + per-keyword `chrome.history.search()` calls, score by frequency+recency, top 20 candidates
3. **Stage 2 — Semantic ranking** (Gemini Nano, optional): re-rank top **5** candidates; silent fallback to Stage 1 if unavailable

Translator API also used for bilingual keyword extraction (ja↔en) during Stage 0/1.

## Critical Constraints

- **Gemini Nano JSON**: always `try/catch` + strip markdown fences before `JSON.parse()` (even with `responseConstraint`)
- **Keyword tokenization**: `extractKeywords()` uses `Intl.Segmenter(undefined, { granularity: 'word' })` — same ICU engine as `chrome.history.search()` internally. This makes tokens match what Chrome indexed, enabling direct per-keyword API calls for any language including Japanese. Do NOT revert to whitespace splitting.
- **History `startTime`**: always pass `startTime` explicitly to `chrome.history.search()` — omitting it triggers an undocumented 24-hour default (`SetRecentDayRange(1)` in Chromium source). Use `Date.now() - 90 * 86_400_000` as the fallback when period is 'all'.
- **Popup blur**: attach `window.onblur` to stop Web Speech API recognition
- **Token budget**: top-5 limit in Stage 2 is a measured tradeoff — test before increasing

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
