/**
 * ai.js — Chrome built-in AI helpers for VoiceMarkets popup.
 *
 * Covers three capabilities:
 *   1. Translator API  — bilingual keyword extraction
 *   2. Gemini Nano (Stage 0) — intent parsing (period, sources, keyword expansion)
 *   3. Gemini Nano (Stage 2) — semantic candidate ranking
 *
 * All functions return null / empty array on failure so callers can fall back
 * silently to keyword-based results.
 */

import { extractKeywords, hasCJKText } from './search.js';
import { t } from './i18n.js';

// ── Shared helper ─────────────────────────────────────────────────────────────

const makeTimeout = (ms, label = 'timeout') =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));

// ── Translator API ─────────────────────────────────────────────────────────────

/**
 * Translate text using the Chrome built-in Translator API.
 * Returns the translated string, or null if unavailable / failed.
 *
 * @param {string} text
 * @param {'ja'|'en'} sourceLang
 * @param {'ja'|'en'} targetLang
 * @returns {Promise<string|null>}
 */
export async function translateQuery(text, sourceLang, targetLang) {
  const TranslatorAPI = globalThis['Translator'];
  if (!TranslatorAPI) return null;
  try {
    const availability = await TranslatorAPI.availability({ sourceLanguage: sourceLang, targetLanguage: targetLang });
    if (availability === 'unavailable') return null;

    const translator = await TranslatorAPI.create({ sourceLanguage: sourceLang, targetLanguage: targetLang });
    const result = await translator.translate(text.slice(0, 200));
    translator.destroy();
    console.debug(`[VoiceMarkets] Translator ${sourceLang}→${targetLang}:`, result);
    return result || null;
  } catch (e) {
    console.debug('[VoiceMarkets] translateQuery failed:', e);
    return null;
  }
}

/** Translate to the opposite language (ja↔en), auto-detecting source. */
export function translateToOppositeLanguage(text) {
  return hasCJKText(text)
    ? translateQuery(text, 'ja', 'en')
    : translateQuery(text, 'en', 'ja');
}

/**
 * Extract keywords in both the original and translated language.
 * Falls back to single-language extraction if Translator API is unavailable.
 *
 * @param {string} transcript
 * @returns {Promise<string[]>}
 */
export async function extractKeywordsBilingual(transcript) {
  const original   = extractKeywords(transcript);
  const translated = await translateToOppositeLanguage(transcript);
  if (!translated) return original;

  const merged = [...new Set([...original, ...extractKeywords(translated)])];
  console.debug('[VoiceMarkets] bilingual keywords:', merged);
  return merged;
}

// ── Gemini Nano (Stage 0) — Intent parsing ────────────────────────────────────

/**
 * Parse search intent from voice recognition alternatives using Gemini Nano.
 * Returns { selected, period, keywords, sources } on success, null if unavailable / failed.
 *
 * @param {Array<{transcript: string, confidence: number}>} alternatives
 * @param {string[]} bookmarkDictionary
 * @param {(msg: string) => void} onStatus
 * @returns {Promise<{selected: number, period: string, keywords: string[], sources: string[]}|null>}
 */
export async function parseIntent(alternatives, bookmarkDictionary, onStatus = () => {}) {
  if (typeof LanguageModel === 'undefined') return null;

  try {
    const availability = await LanguageModel.availability({
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['en'],
    });
    if (availability !== 'available') return null;

    onStatus(t('status_loading_ai'));
    const systemPrompt = buildIntentSystemPrompt(bookmarkDictionary);
    console.debug('[VoiceMarkets] parseIntent systemPrompt:\n', systemPrompt);

    const primaryText     = alternatives[0].transcript;
    const translationHint = await translateToOppositeLanguage(primaryText);

    let session;
    session = await Promise.race([
      LanguageModel.create({
        systemPrompt,
        expectedInputLanguages: ['ja', 'en'],
        expectedOutputLanguages: ['en'],
      }),
      makeTimeout(60000),
    ]);

    const schema = {
      type: 'object',
      properties: {
        selected: { type: 'number' },
        period:   { type: ['string', 'null'], enum: ['1h', '24h', '1w', '1m', '1y', null] },
        keywords: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 20 },
        sources:  { type: ['array', 'null'], items: { type: 'string', enum: ['bookmarks', 'history'] } },
      },
      required: ['selected', 'keywords'],
    };

    onStatus(t('status_parsing_query'));
    const altLines = alternatives
      .map((a, i) => `${i + 1}. "${a.transcript.slice(0, 80)}" (confidence: ${a.confidence.toFixed(2)})`)
      .join('\n');
    const translationLine = translationHint
      ? `\nTranslation (${hasCJKText(primaryText) ? 'EN' : 'JA'}) — you MUST include words from this in keywords: "${translationHint}"`
      : '';
    const intentPrompt = `Speech recognition alternatives:\n${altLines}${translationLine}`;
    console.debug('[VoiceMarkets] parseIntent prompt:', intentPrompt);

    let response;
    try {
      response = await Promise.race([
        session.prompt(intentPrompt, { responseConstraint: schema }),
        makeTimeout(60000),
      ]);
    } finally {
      session.destroy();
    }

    const intent = JSON.parse(response);

    if (Array.isArray(intent.keywords)) {
      const extra = [
        ...extractKeywords(primaryText),
        ...(translationHint ? extractKeywords(translationHint) : []),
      ];
      intent.keywords = [...new Set([...intent.keywords, ...extra])].slice(0, 20);
    }

    console.debug('[VoiceMarkets] Parsed intent:', intent);
    return intent;
  } catch (e) {
    console.debug('[VoiceMarkets] parseIntent failed:', e);
    return null;
  }
}

function buildIntentSystemPrompt(bookmarkDictionary) {
  return [
    'You are a multilingual search keyword expander for a browser bookmark/history search tool.',
    'Bookmarks have titles in Japanese, English, or both.',
    'Generate keywords in BOTH languages so the search matches regardless of how the page was titled.',
    '',
    '## selected',
    'Pick the most natural-sounding speech-recognition alternative (1-based index).',
    '',
    '## period',
    'Detect time range ONLY when the query explicitly contains a time expression:',
    '  very recent / just now / moments ago → 1h',
    '  today / this morning / yesterday / recently → 24h',
    '  this week / last week → 1w | this month → 1m | this year → 1y',
    '  No time expression in the query → omit this field (null)',
    '',
    '## keywords',
    'For every topic concept in the query, generate ALL of the following variants:',
    '1. Drop stop words, grammatical particles, and search meta-terms (history, bookmarks, favorites, search, today, etc.)',
    '2. Original surface form as spoken',
    '3. English equivalent for any non-English term',
    '4. Non-English equivalent for any English term (katakana for Japanese context)',
    '5. Resolve phonetic brand/product names to their canonical spelling (e.g. spoken sound → "github", "react", "typescript")',
    '6. Common abbreviations and expansions: JS↔javascript, TS↔typescript, AI↔artificial intelligence, ML↔machine learning',
    '7. Related sub-terms: e.g. react → jsx, component, hook; docker → container, compose',
    '8. Spelling variants and common typos that a speech recognizer might produce',
    'Target 20 items. Always include both Japanese and English forms for every concept.',
    '',
    '## sources',
    '["bookmarks"] if user refers to bookmarks or favorites.',
    '["history"] if user refers to browsing history or visited pages.',
    'No source keyword in the query → omit this field (null).',
    ...(bookmarkDictionary.length > 0 ? [
      '',
      '## known terms from user\'s bookmarks (prefer these spellings when a spoken word sounds similar)',
      bookmarkDictionary.slice(0, 60).join(', '),
    ] : []),
  ].join('\n');
}

// ── Gemini Nano (Stage 2) — Ranking ──────────────────────────────────────────

/**
 * Rank candidates using Gemini Nano.
 * Returns ranked array on success, null if AI is unavailable / failed.
 * Caller uses null to distinguish "AI used" from "AI skipped/failed".
 *
 * @param {Array} candidates
 * @param {string} transcript
 * @returns {Promise<Array|null>}
 */
export async function rankWithAI(candidates, transcript) {
  if (typeof LanguageModel === 'undefined') return null;

  try {
    const availability = await LanguageModel.availability({
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['en'],
    });
    if (availability !== 'available') {
      console.debug('[VoiceMarkets] LanguageModel not available:', availability);
      return null;
    }

    let session;
    session = await Promise.race([
      LanguageModel.create({
        systemPrompt: 'Rank browser history items by relevance to a query. Output ONLY a JSON array [{url,score}] sorted by score descending.',
        expectedInputLanguages: ['ja', 'en'],
        expectedOutputLanguages: ['en'],
      }),
      makeTimeout(30000, 'AI timeout'),
    ]);

    // Use top 5 candidates only to keep prompt short for Gemini Nano
    const top      = candidates.slice(0, 5);
    const itemList = top.map((item, i) => `${i + 1}. ${(item.title || '').slice(0, 40)}`).join('\n');
    const prompt   = `Query:"${transcript.slice(0, 50)}"\nItems:\n${itemList}\nRank by relevance. i=item number(1-based), score=0-10`;

    console.debug('[VoiceMarkets] AI prompt length (chars):', prompt.length, '| candidates:', candidates.length);

    const responseConstraint = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i:     { type: 'number' },
          score: { type: 'number' },
        },
        required: ['i', 'score'],
      },
    };

    let response;
    try {
      response = await Promise.race([
        session.prompt(prompt, { responseConstraint }),
        makeTimeout(30000, 'AI timeout'),
      ]);
    } finally {
      session.destroy();
    }

    console.debug('[VoiceMarkets] AI raw response:', response);

    let parsed;
    try {
      parsed = JSON.parse(response);
      if (!Array.isArray(parsed)) parsed = null;
    } catch {
      parsed = null;
    }
    if (!parsed) return null;

    const ranked = parsed
      .filter(r => r.i != null ? top[r.i - 1] : r.url && top.find(c => c.url === r.url))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(r => r.i != null ? top[r.i - 1] : top.find(c => c.url === r.url))
      .filter(Boolean);

    console.debug('[VoiceMarkets] AI ranked count:', ranked.length);
    return ranked.length > 0 ? ranked : null;
  } catch (_) {
    console.debug('[VoiceMarkets] rankWithAI failed:', _);
    return null;
  }
}

// ── Availability check ────────────────────────────────────────────────────────

export async function checkAIAvailability() {
  if (typeof LanguageModel === 'undefined') {
    console.debug('[VoiceMarkets] LanguageModel unavailable — falling back to keyword ranking');
    return;
  }
  try {
    const availability = await LanguageModel.availability({
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['en'],
    });
    console.debug('[VoiceMarkets] Gemini Nano availability:', availability);
  } catch (e) {
    console.debug('[VoiceMarkets] Gemini Nano capability check failed:', e);
  }
}
