/**
 * search.js — pure functions with no chrome API dependencies.
 * Testable with Vitest; imported by popup.js at runtime.
 */

// Japanese and English stop words to strip from transcripts
const STOP_WORDS = new Set([
  // Japanese particles / auxiliaries
  'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ',
  'ある', 'いる', 'も', 'する', 'から', 'な', 'こと', 'として', 'い', 'や',
  'れる', 'など', 'なり', 'もの', 'という', 'ず', 'ない', 'しかし', 'まだ',
  'って', 'けど', 'だ', 'です', 'ます', 'ました',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'and', 'or', 'but', 'if', 'this', 'that', 'it', 'its',
]);

/**
 * Extract meaningful keywords from a speech transcript.
 * @param {string} transcript
 * @returns {string[]}
 */
export function extractKeywords(transcript) {
  if (!transcript || typeof transcript !== 'string') return [];

  const normalized = transcript
    .toLowerCase()
    .replace(/[。、！？「」『』【】・…]/g, ' ')
    .replace(/[.,!?;:"'()\[\]{}\-]/g, ' ')
    .trim();

  const tokens = normalized.split(/\s+/).filter(Boolean);

  const keywords = tokens.filter(t => t.length >= 2 && !STOP_WORDS.has(t));

  return [...new Set(keywords)];
}

/**
 * Score a bookmark or history item against extracted keywords.
 * Returns 0 if no keywords match (caller should filter these out).
 *
 * Scoring:
 *   +3 per keyword found in title
 *   +1 per keyword found in URL only
 *   +0–2 recency bonus (history items only, via lastVisitTime)
 *
 * @param {{ title?: string, url?: string, lastVisitTime?: number }} item
 * @param {string[]} keywords
 * @returns {number}
 */
export function scoreItem(item, keywords) {
  if (!item || !keywords || keywords.length === 0) return 0;

  const title = (item.title || '').toLowerCase();
  const url = (item.url || '').toLowerCase();

  let matchScore = 0;
  for (const kw of keywords) {
    if (title.includes(kw)) {
      matchScore += 3;
    } else if (url.includes(kw)) {
      matchScore += 1;
    }
  }

  if (matchScore === 0) return 0;

  let recencyScore = 0;
  if (item.lastVisitTime) {
    const ageDays = (Date.now() - item.lastVisitTime) / 86_400_000;
    if (ageDays < 1) recencyScore = 2;
    else if (ageDays < 7) recencyScore = 1;
    else if (ageDays < 30) recencyScore = 0.5;
  }

  return matchScore + recencyScore;
}

/**
 * Filter items client-side by keyword presence (title or URL).
 * Used for Japanese history search where chrome.history.search text filter is broken.
 *
 * @param {Array<{ title?: string, url?: string }>} items
 * @param {string[]} keywords
 * @returns {Array}
 */
export function filterByKeywords(items, keywords) {
  if (!keywords || keywords.length === 0) return items;
  return items.filter(item => {
    const text = `${(item.title || '').toLowerCase()} ${(item.url || '').toLowerCase()}`;
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  });
}

/**
 * Get the start timestamp for a period filter.
 * Returns 0 for 'all' (no filter).
 *
 * @param {string} period - 'all' | '1h' | '24h' | '1w' | '1m' | '1y'
 * @returns {number} millisecond timestamp (0 = no filter)
 */
export function getPeriodStartTime(period) {
  if (!period || period === 'all') return 0;
  const durations = {
    '1h':  3_600_000,
    '24h': 86_400_000,
    '1w':  7 * 86_400_000,
    '1m':  30 * 86_400_000,
    '1y':  365 * 86_400_000,
  };
  const ms = durations[period];
  return ms !== undefined ? Date.now() - ms : 0;
}

/**
 * Extract significant keywords from bookmark titles to build a correction dictionary.
 * Keeps English words, katakana sequences, and kanji compounds — the kinds of terms
 * most likely to be misrecognized by speech input.
 * Returns unique words sorted by frequency (most common first), capped at 100.
 *
 * @param {string[]} titles - Array of bookmark title strings
 * @returns {string[]}
 */
export function extractBookmarkKeywords(titles) {
  const freq = new Map();

  for (const title of titles) {
    if (!title) continue;

    const words = title
      .replace(/[|／｜_:：\[\]【】「」『』()（）・…]/g, ' ')
      .split(/[\s\-\/]+/)
      .filter(Boolean);

    for (const word of words) {
      const isEnglish  = /^[a-zA-Z][a-zA-Z0-9.]{1,}$/.test(word);  // 2+ chars, starts with letter
      const isKatakana = /^[\u30A0-\u30FF]{3,}$/.test(word);         // 3+ katakana chars
      const isKanji    = /^[\u4E00-\u9FFF]{2,}$/.test(word);         // 2+ kanji chars

      if (isEnglish || isKatakana || isKanji) {
        freq.set(word, (freq.get(word) || 0) + 1);
      }
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 100);
}

/**
 * Parse Gemini Nano AI response, stripping markdown code fences before parsing.
 * Always wrap in try/catch — the model does not guarantee valid JSON.
 *
 * @param {string} text
 * @returns {Array|null} parsed array, or null on any failure
 */
export function parseAIResponse(text) {
  if (!text || typeof text !== 'string') return null;

  const stripped = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
