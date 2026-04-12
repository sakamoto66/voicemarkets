/**
 * intent.js — Gemini Nano Stage 0: voice intent parsing.
 *
 * Selects the best speech recognition alternative, detects time period,
 * expands keywords bilingually, and determines search sources.
 */

import { extractKeywords } from './search.js';
import { t } from './i18n.js';
import { makeTimeout, uiLanguage, resolveOutputLang, makeLMOptions } from './ai-utils.js';
import { translateToEnglish } from './translator.js';

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

  const lang = uiLanguage();
  const lmOpts = makeLMOptions(['en', lang], resolveOutputLang(lang));

  try {
    const availability = await LanguageModel.availability(lmOpts);
    if (availability !== 'available') return null;

    onStatus(t('status_loading_ai'));
    const systemPrompt = buildIntentSystemPrompt(bookmarkDictionary);
    console.debug('[VoiceMarkets] parseIntent systemPrompt:\n', systemPrompt);

    const primaryText     = alternatives[0].transcript;
    const translationHint = await translateToEnglish(primaryText);

    const session = await Promise.race([
      LanguageModel.create({ systemPrompt, ...lmOpts }),
      makeTimeout(60000),
    ]);

    const schema = {
      type: 'object',
      properties: {
        selected: { type: 'number' },
        period:   { type: 'string', enum: ['all', '1h', '24h', '1w', '1m', '1y'] },
        keywords: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 20 },
        sources:  { type: 'array', items: { type: 'string', enum: ['bookmarks', 'history'] } },
      },
      required: ['selected', 'period', 'keywords', 'sources'],
    };

    onStatus(t('status_parsing_query'));
    const altLines = alternatives
      .map((a, i) => `${i + 1}. "${a.transcript.slice(0, 80)}" (confidence: ${a.confidence.toFixed(2)})`)
      .join('\n');
    const translationLine = translationHint
      ? `\nTranslation (EN) — you MUST include words from this in keywords: "${translationHint}"`
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

    let intent;
    try {
      const stripped = response.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
      intent = JSON.parse(stripped);
    } catch {
      return null;
    }

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
    'The user speaks in any language. Bookmarks and history pages may be titled in any language.',
    'Generate search keywords in BOTH the original language AND English so results match regardless of how pages were saved.',
    '',
    '## selected',
    'Pick the most natural-sounding speech-recognition alternative (1-based index).',
    '',
    '## period',
    'Detect the time range from the chosen alternative (handle expressions in any language):',
    '  "just now / a moment ago / very recently (minutes)" → 1h',
    '  "today / this morning / yesterday / lately / recently (days)" → 24h',
    '  "this week / last week" → 1w',
    '  "this month" → 1m',
    '  "this year" → 1y',
    '  no time expression → all',
    '',
    '## keywords',
    'For every topic concept in the query, generate ALL of the following variants:',
    '1. Drop filler and meta-search words (grammatical particles, search-action terms like "bookmark", "history", "favorites", "open", "search", "find", and temporal words already captured in period)',
    '2. Original surface form as heard/spoken',
    '3. English equivalent if the query is in another language',
    '4. Native-language equivalent if the query is in English (most common local translation)',
    '5. Resolve phonetically spelled brand/product names to their canonical form (e.g. spoken "githyubu" → "github", "riaakuto" → "react", "taiipusukuriputo" → "typescript")',
    '6. Common abbreviations and expansions: JS↔javascript, TS↔typescript, AI↔artificial intelligence, ML↔machine learning',
    '7. Related sub-terms: e.g. "react" → also add "jsx", "component", "hook"; "docker" → "container", "compose"',
    '8. Spelling variants and common mis-recognitions that a speech recognizer might produce',
    'Target 20 items. Always include both the original language and English forms for every concept.',
    '',
    '## sources',
    '["bookmarks"] if user mentions bookmarks / favorites / saved pages.',
    '["history"] if user mentions browsing history / visited / viewed pages.',
    '["bookmarks","history"] otherwise.',
    ...(bookmarkDictionary.length > 0 ? [
      '',
      '## known terms from user\'s bookmarks (prefer these spellings when a spoken word sounds similar)',
      bookmarkDictionary.slice(0, 60).join(', '),
    ] : []),
  ].join('\n');
}
