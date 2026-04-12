/**
 * ai.js — Re-export facade for Chrome built-in AI helpers.
 *
 * Split into focused modules:
 *   translator.js  — Translator API (bilingual keyword extraction)
 *   intent.js      — Gemini Nano Stage 0 (intent parsing)
 *   rank.js        — Gemini Nano Stage 2 (ranking + availability)
 */

export { translateQuery, translateToEnglish, extractKeywordsBilingual } from './translator.js';
export { parseIntent } from './intent.js';
export { rankWithAI, checkAIAvailability } from './rank.js';
