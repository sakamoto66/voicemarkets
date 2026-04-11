# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VoiceMarkets is a Chrome MV3 extension that lets users open bookmarked pages and browser history via voice input. No external services — voice recognition (Web Speech API) and AI ranking (Gemini Nano) run in the browser. Target user: browser power users with thousands of bookmarks.

## Extension Structure (Planned)

```
voicemarkets/
├── manifest.json              # MV3, permissions: bookmarks, history
├── popup/
│   ├── popup.html             # Extension popup UI (360px wide)
│   ├── popup.js               # Main logic: voice input, search, ranking
│   └── popup.css
├── background/
│   └── service-worker.js      # MV3 service worker (minimal)
└── icons/
```

## Loading and Testing

**Load in Chrome (developer mode):**
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory

**Unit tests** (planned with Vitest, pure functions only):
```bash
npm test
```
Unit-testable functions: `scoreItem(item, keywords)`, `extractKeywords(transcript)`, `parseAIResponse(text)`

## Core Architecture: Two-Stage Search

**Stage 1 — Keyword Pre-filter (always runs)**
1. Extract keywords from speech transcript
2. `chrome.bookmarks.search(keywords)` for bookmark matches
3. `chrome.history.search({ text: '', maxResults: 1000 })` — fetch ALL history (the `text` filter is broken for Japanese; do client-side filtering on title+url)
4. Score by keyword frequency + recency, keep top 20 candidates

**Stage 2 — Gemini Nano Semantic Ranking (optional)**
- Check `window.ai?.languageModel` availability before calling
- Pass top candidates + original transcript; prompt returns JSON array with title, url, score
- If unavailable or fails: fall back silently to Stage 1 results
- Display top 5 results with scores

## Critical Implementation Constraints

- **Gemini Nano does not guarantee valid JSON** — always wrap `JSON.parse()` in try/catch and strip markdown code fences before parsing. Fallback to Stage 1 on any parse error.
- **Web Speech API is interrupted on popup blur** — attach `window.onblur` to stop/cleanup recognition when the popup loses focus.
- **Japanese history search**: `chrome.history.search({ text: '...' })` does not work for Japanese text. Always fetch with `text: ''` and filter client-side.
- **Token budget**: Measure actual token counts with real data before Phase 3 ships. Default of 20 candidates is a placeholder; hitting the model's context limit causes silent failure.
- **Web Speech API in Chrome routes through Google's servers** — not truly offline despite no user-configured API key. This is an accepted tradeoff.

## Current Implementation Status

- **Phase 1** (Voice input scaffold): Not started
- **Phase 2** (Search + keyword ranking): Not started
- **Phase 3** (Gemini Nano ranking): Blocked on Phase 2; token budget measurement required before ship
- **Phase 4** (Error UX): Error states to specify before implementation — mic denied (NotAllowedError), silence timeout, zero results, AI JSON parse failure

## manifest.json Key Fields

```json
{
  "manifest_version": 3,
  "permissions": ["bookmarks", "history"],
  "action": { "default_popup": "popup/popup.html" },
  "trial_tokens": ["<CHROME_BUILT_IN_AI_ORIGIN_TRIAL_TOKEN>"]
}
```
