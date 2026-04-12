/**
 * rank.js — Gemini Nano Stage 2: semantic candidate ranking + availability check.
 */

import { parseAIResponse } from './search.js';
import { makeTimeout, uiLanguage, resolveOutputLang, makeLMOptions } from './ai-utils.js';

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

  const lang = uiLanguage();
  const lmOpts = makeLMOptions(['en', lang], resolveOutputLang(lang));

  try {
    const availability = await LanguageModel.availability(lmOpts);
    if (availability !== 'available') {
      console.debug('[VoiceMarkets] LanguageModel not available:', availability);
      return null;
    }

    const session = await Promise.race([
      LanguageModel.create({
        systemPrompt: 'Rank browser history items by relevance to a query. Output ONLY a JSON array [{url,score}] sorted by score descending.',
        ...lmOpts,
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

    const parsed = parseAIResponse(response);
    if (!parsed) return null;

    const ranked = parsed
      .filter(r => r.i != null && top[r.i - 1])
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(r => top[r.i - 1]);

    console.debug('[VoiceMarkets] AI ranked count:', ranked.length);
    return ranked.length > 0 ? ranked : null;
  } catch (_) {
    console.debug('[VoiceMarkets] rankWithAI failed:', _);
    return null;
  }
}

export async function checkAIAvailability() {
  if (typeof LanguageModel === 'undefined') {
    console.debug('[VoiceMarkets] LanguageModel unavailable — running in keyword-only mode');
    return;
  }
  try {
    const lang = uiLanguage();
    const availability = await LanguageModel.availability(makeLMOptions(['en', lang], resolveOutputLang(lang)));
    console.debug('[VoiceMarkets] Gemini Nano availability:', availability);
  } catch (e) {
    console.debug('[VoiceMarkets] Gemini Nano capability check failed:', e);
  }
}
