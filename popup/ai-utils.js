/**
 * ai-utils.js — Shared helpers for Chrome built-in AI modules.
 */

export const makeTimeout = (ms, label = 'timeout') =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));

export const SUPPORTED_OUTPUT_LANGS = ['en', 'es', 'ja'];

/** BCP 47 base language tag for the browser UI (e.g. 'ja', 'en', 'zh'). */
export const uiLanguage = () => chrome.i18n.getUILanguage().split('-')[0];

/** Return the best supported output language for the given UI language. */
export const resolveOutputLang = (uiLang) =>
  SUPPORTED_OUTPUT_LANGS.includes(uiLang) ? uiLang : 'en';

/** Build LanguageModel expectedInputs/expectedOutputs options. */
export const makeLMOptions = (inputLangs, outputLang) => ({
  expectedInputs:  [{ type: 'text', languages: [...new Set(inputLangs)] }],
  expectedOutputs: [{ type: 'text', languages: [outputLang] }],
});
