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

/** ['en'] or ['en', '<ui-lang>'] — deduped, always includes 'en'. */
const inputLanguages = () => {
  const ui = chrome.i18n.getUILanguage().split('-')[0]; // 'ja-JP' → 'ja'
  return ui === 'en' ? ['en'] : ['en', ui];
};

// ── Translator API ─────────────────────────────────────────────────────────────

/**
 * Translate text using the Chrome built-in Translator API.
 * Returns the translated string, or null if unavailable / failed.
 *
 * @param {string} text
 * @param {string} sourceLang - BCP 47 language code (e.g. 'en', 'ja', 'ko')
 * @param {string} targetLang - BCP 47 language code (e.g. 'en', 'ja', 'ko')
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

/** Translate to the opposite language (ui-lang↔en), auto-detecting source. */
export function translateToOppositeLanguage(text) {
  const ui = chrome.i18n.getUILanguage().split('-')[0];
  if (ui === 'en') return Promise.resolve(null);
  return hasCJKText(text)
    ? translateQuery(text, ui, 'en')
    : translateQuery(text, 'en', ui);
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
 * Returns { keywords } on success, null if unavailable / failed.
 *
 * @param {Array<{transcript: string, confidence: number}>} alternatives
 * @param {string[]} bookmarkDictionary
 * @param {(msg: string) => void} onStatus
 * @returns {Promise<{keywords: string[]}|null>}
 */
export async function parseIntent(alternatives, bookmarkDictionary, onStatus = () => {}) {
  if (typeof LanguageModel === 'undefined') return null;

  try {
    const availability = await LanguageModel.availability({
      expectedInputs:  [{ type: 'text', languages: inputLanguages() }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability !== 'available') return null;

    onStatus(t('status_loading_ai'));
    const systemPrompt = buildIntentSystemPrompt(bookmarkDictionary);

    // Use all alternatives with confidence >= 0.1 as keyword sources
    const usable      = alternatives.filter(a => a.confidence >= 0.1);
    if (usable.length === 0) usable.push(alternatives[0]);
    const primaryText = usable[0].transcript;
    const translationHint = await translateToOppositeLanguage(primaryText);

    let session;
    session = await Promise.race([
      LanguageModel.create({
        systemPrompt,
        expectedInputs:  [{ type: 'text', languages: inputLanguages() }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      }),
      makeTimeout(60000),
    ]);

    const schema = {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      },
      required: ['keywords'],
    };

    onStatus(t('status_parsing_query'));
    const altLines = usable
      .map((a, i) => `${i + 1}. "${a.transcript.slice(0, 80)}" (confidence: ${a.confidence.toFixed(2)})`)
      .join('\n');
    const translationLine = translationHint
      ? `\nAlso expand keywords using this translation: "${translationHint}"`
      : '';
    const intentPrompt = `User query candidates:\n${altLines}${translationLine}`;
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
      // Merge AI keywords with keyword-extracted terms from all usable alternatives
      const extra = usable.flatMap(a => [
        ...extractKeywords(a.transcript),
        ...(translationHint && a === usable[0] ? extractKeywords(translationHint) : []),
      ]);
      intent.keywords = [...new Set([...intent.keywords, ...extra])].slice(0, 5);
    }

    console.debug('[VoiceMarkets] Parsed intent:', intent);
    return intent;
  } catch (e) {
    console.debug('[VoiceMarkets] parseIntent failed:', e);
    return null;
  }
}

function buildIntentSystemPrompt(bookmarkDictionary) {
  const uiLang = chrome.i18n.getUILanguage().split('-')[0];
  const isEnglish = uiLang === 'en';
  const nativeLangNote = isEnglish
    ? 'Bookmarks have titles in English or other languages.'
    : `Bookmarks have titles in ${uiLang}, English, or both.`;
  const nativeEquivalentNote = isEnglish
    ? '4. Native-language equivalent for any English term when the UI language is not English'
    : `4. ${uiLang} equivalent for any English term (e.g. transliterated form for the UI language)`;
  const bilingualNote = isEnglish
    ? 'Target 5 items. Include both the original form and English equivalents for every concept.'
    : `Target 5 items. Always include both ${uiLang} and English forms for every concept.`;

  return [
    'You are a multilingual search keyword expander for a browser bookmark/history search tool.',
    nativeLangNote,
    'Generate keywords in BOTH the UI language and English so the search matches regardless of how the page was titled.',
    '',
    '## keywords',
    'You are given multiple query candidates for the same user utterance. Extract topic concepts from ALL of them.',
    `NEVER include words from the prompt structure itself (e.g. "query", "candidate", "translation", "confidence", "alternative", "recognition", "speech", language codes like "${uiLang.toUpperCase()}"/"EN").`,
    'For every topic concept found across any candidate, generate ALL of the following variants:',
    '1. Drop stop words, grammatical particles, and search meta-terms (history, bookmarks, favorites, search, today, etc.)',
    '2. Original surface form as spoken (from every alternative)',
    '3. English equivalent for any non-English term',
    nativeEquivalentNote,
    '5. Resolve phonetic brand/product names to their canonical spelling (e.g. spoken sound → "github", "react", "typescript")',
    '6. Common abbreviations and expansions: JS↔javascript, TS↔typescript, AI↔artificial intelligence, ML↔machine learning',
    '7. Related sub-terms: e.g. react → jsx, component, hook; docker → container, compose',
    '8. Spelling variants and common typos that a speech recognizer might produce',
    bilingualNote,
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
      expectedInputs:  [{ type: 'text', languages: inputLanguages() }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability !== 'available') {
      console.debug('[VoiceMarkets] LanguageModel not available:', availability);
      return null;
    }

    let session;
    session = await Promise.race([
      LanguageModel.create({
        systemPrompt: 'Rank browser history items by relevance to a query. Output ONLY a JSON array [{url,score}] sorted by score descending.',
        expectedInputs:  [{ type: 'text', languages: inputLanguages() }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
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
      expectedInputs:  [{ type: 'text', languages: inputLanguages() }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    console.debug('[VoiceMarkets] Gemini Nano availability:', availability);
  } catch (e) {
    console.debug('[VoiceMarkets] Gemini Nano capability check failed:', e);
  }
}
