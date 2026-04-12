/**
 * search.js — pure functions with no chrome API dependencies.
 * Testable with Vitest; imported by popup.js at runtime.
 */

// CJK scripts (Han, Hiragana, Katakana, Hangul) use a shorter minimum length
// because meaningful words can be 2 characters. Latin-script function words
// (of, in, to, or, …) are typically ≤2 chars, so a threshold of 3 filters
// most of them without a language-specific stop word list.
const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const minSegmentLength = (seg) => CJK_RE.test(seg) ? 2 : 3;

/**
 * Extract meaningful keywords from a speech transcript.
 * Uses Intl.Segmenter for ICU-aligned word tokenization — matches the same
 * segmentation that chrome.history.search() uses internally, so extracted
 * tokens work as search queries for any language without special-casing.
 *
 * @param {string} transcript
 * @returns {string[]}
 */
export function extractKeywords(transcript) {
  if (!transcript || typeof transcript !== 'string') return [];

  const normalized = transcript.toLowerCase();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const words = [];

  for (const { segment, isWordLike } of segmenter.segment(normalized)) {
    if (isWordLike && segment.length >= minSegmentLength(segment)) {
      words.push(segment);
    }
  }

  return [...new Set(words)];
}

/**
 * Score a bookmark or history item against extracted keywords.
 * Returns 0 if no keywords match (caller should filter these out).
 *
 * Scoring:
 *   +3 per keyword found in title (weighted by keyword length)
 *   +1 per keyword found in URL only (weighted by keyword length)
 *   +0–2 recency bonus (history items only, via lastVisitTime)
 *   +0–2 visit frequency bonus (history items only, via visitCount)
 *
 * Keyword length weighting: longer keywords are more specific and score higher.
 *   len ≤ 2 → ×0.5  |  len 3–4 → ×1  |  len 5–7 → ×1.5  |  len ≥ 8 → ×2
 *
 * @param {{ title?: string, url?: string, lastVisitTime?: number, visitCount?: number }} item
 * @param {string[]} keywords
 * @returns {number}
 */
export function scoreItem(item, keywords) {
  if (!item || !keywords || keywords.length === 0) return 0;

  const title = (item.title || '').toLowerCase();
  const url = (item.url || '').toLowerCase();

  let matchScore = 0;
  for (const kw of keywords) {
    const weight = kw.length <= 2 ? 0.5 : kw.length <= 4 ? 1 : kw.length <= 7 ? 1.5 : 2;
    if (title.includes(kw)) {
      matchScore += 3 * weight;
    } else if (url.includes(kw)) {
      matchScore += 1 * weight;
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

  // Visit frequency bonus: log scale so a page visited 100× doesn't dominate over 10×
  let frequencyScore = 0;
  if (item.visitCount && item.visitCount > 0) {
    frequencyScore = Math.min(2, Math.log10(item.visitCount + 1));
  }

  return matchScore + recencyScore + frequencyScore;
}

/**
 * Filter items client-side by keyword presence (title or URL).
 * Used for bookmark search where the full set is already loaded in memory.
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
/**
 * Returns true if the text contains CJK characters (Japanese/Chinese/katakana/fullwidth).
 * @param {string} text
 * @returns {boolean}
 */
export function hasCJKText(text) {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(text);
}

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
