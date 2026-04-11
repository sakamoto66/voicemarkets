# Changelog

## [0.2.1] — 2026-04-12

### Changed
- Voice recognition language and HTML `lang` attribute now follow Chrome's UI language setting (`chrome.i18n.getUILanguage()`) instead of being hardcoded to `ja-JP`

### Added
- Unit tests for `voice.js` language detection

## [0.2.0] — 2026-04-11

### Added
- **Phase 1**: Voice input scaffold — Web Speech API (`ja-JP`), mic button with pulse animation, popup blur cleanup
- **Phase 2**: Two-stage search pipeline — keyword extraction, bookmark + history fetch, dedup, score-and-rank, top-20 candidates
- **Phase 3**: Gemini Nano semantic ranking (Stage 2) with silent keyword-ranking fallback; Stage 0 intent parsing (period, source, keyword expansion via `LanguageModel`)
- **Phase 4**: Full error UX — mic permission denied, no-speech, keyword extraction failure, zero results, AI parse failure (silent fallback + badge)
- Chrome Translator API for bilingual keyword extraction (ja↔en)
- Period filter pills (`1h / 24h / 1w / 1m / 1y / all`) and source toggles (Bookmarks / History)
- AI / Keyword ranking badge in results footer
- Search state persistence across popup open/close via `chrome.storage.session`
- Standalone window mode (service worker opens a persistent window instead of the popup, so Web Speech API survives the mic permission prompt)
- i18n support for Japanese and English (`_locales/ja`, `_locales/en`)
- Vitest unit test suite — 52 tests covering all pure functions in `search.js`

### Fixed
- Missing `"windows"` permission in `manifest.json` — `chrome.windows.update()` would fail silently when switching to an existing tab
- Unhandled promise rejection in `openItem()` when Chrome tab APIs throw (e.g., permission error)

### Changed
- Keyword scoring uses length-weighted multipliers: `≤2 → ×0.5 | 3–4 → ×1 | 5–7 → ×1.5 | ≥8 → ×2`
- History fetch uses `text: ''` + client-side filter (Chrome `history.search` text filter is broken for Japanese)
