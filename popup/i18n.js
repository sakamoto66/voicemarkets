/**
 * i18n.js — thin wrapper around chrome.i18n for VoiceMarkets popup.
 */

/**
 * Get a translated message. Falls back to the key if the message is not found.
 * Supports chrome.i18n substitution placeholders ($1, $2, …).
 *
 * @param {string} key
 * @param {...string} substitutions
 * @returns {string}
 */
export const t = (key, ...substitutions) =>
  chrome.i18n.getMessage(key, substitutions) || key;

/**
 * Apply i18n to all elements with data-i18n* attributes under the given root.
 *
 *   data-i18n="key"             → el.textContent
 *   data-i18n-placeholder="key" → el.placeholder
 *   data-i18n-aria="key"        → el.setAttribute('aria-label', …)
 *
 * @param {Document|Element} [root=document]
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}
