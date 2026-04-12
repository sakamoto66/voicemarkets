/**
 * translator.js — Chrome built-in Translator API helpers.
 *
 * Provides bilingual keyword extraction by translating the user's query
 * to English so results match regardless of the language pages were saved in.
 */

import { extractKeywords } from './search.js';
import { uiLanguage } from './ai-utils.js';

/**
 * Translate text using the Chrome built-in Translator API.
 * Returns the translated string, or null if unavailable / failed.
 *
 * @param {string} text
 * @param {string} sourceLang - BCP 47 language tag (e.g. 'ja', 'zh', 'fr')
 * @param {string} targetLang - BCP 47 language tag
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

/**
 * Translate text to English using the Chrome UI language as the source.
 * Returns null if the UI language is already English or translation fails.
 */
export function translateToEnglish(text) {
  const lang = uiLanguage();
  if (lang === 'en') return Promise.resolve(null);
  return translateQuery(text, lang, 'en');
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
  const translated = await translateToEnglish(transcript);
  if (!translated) return original;

  const merged = [...new Set([...original, ...extractKeywords(translated)])];
  console.debug('[VoiceMarkets] bilingual keywords:', merged);
  return merged;
}
