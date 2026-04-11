import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  scoreItem,
  filterByKeywords,
  parseAIResponse,
  getPeriodStartTime,
  extractBookmarkKeywords,
  hasCJKText,
} from '../popup/search.js';

// ── extractKeywords ───────────────────────────────────────────────────────────
describe('extractKeywords', () => {
  it('returns empty array for empty input', () => {
    expect(extractKeywords('')).toEqual([]);
    expect(extractKeywords(null)).toEqual([]);
    expect(extractKeywords(undefined)).toEqual([]);
  });

  it('lowercases tokens', () => {
    const kws = extractKeywords('GitHub Actions');
    expect(kws).toContain('github');
    expect(kws).toContain('actions');
  });

  it('strips Japanese punctuation', () => {
    const kws = extractKeywords('東京、大阪。京都');
    expect(kws.join('')).not.toMatch(/[、。]/);
  });

  it('strips English punctuation', () => {
    const kws = extractKeywords('hello, world! foo-bar');
    expect(kws.join('')).not.toMatch(/[,!-]/);
  });

  it('filters out English stop words', () => {
    const kws = extractKeywords('the quick brown fox');
    expect(kws).not.toContain('the');
    expect(kws).toContain('quick');
    expect(kws).toContain('brown');
    expect(kws).toContain('fox');
  });

  it('filters out Japanese stop words', () => {
    const kws = extractKeywords('東京の観光地');
    expect(kws).not.toContain('の');
  });

  it('filters out single-character tokens', () => {
    const kws = extractKeywords('a b c hello');
    expect(kws).not.toContain('a');
    expect(kws).not.toContain('b');
    expect(kws).not.toContain('c');
    expect(kws).toContain('hello');
  });

  it('deduplicates keywords', () => {
    const kws = extractKeywords('github github github');
    expect(kws.filter(k => k === 'github').length).toBe(1);
  });

  it('returns meaningful keywords from a typical query', () => {
    const kws = extractKeywords('GitHub Actions CI CD pipeline');
    expect(kws).toContain('github');
    expect(kws).toContain('actions');
    expect(kws).toContain('pipeline');
  });
});

// ── scoreItem ─────────────────────────────────────────────────────────────────
describe('scoreItem', () => {
  it('returns 0 for null item', () => {
    expect(scoreItem(null, ['test'])).toBe(0);
  });

  it('returns 0 for empty keywords', () => {
    expect(scoreItem({ title: 'Hello', url: 'https://example.com' }, [])).toBe(0);
  });

  it('returns 0 when no keywords match', () => {
    const item = { title: 'Unrelated page', url: 'https://unrelated.com' };
    expect(scoreItem(item, ['github', 'actions'])).toBe(0);
  });

  it('gives +3 per keyword found in title', () => {
    const item = { title: 'GitHub Actions', url: 'https://github.com/actions' };
    const score = scoreItem(item, ['github']);
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it('gives higher score for title match than URL-only match', () => {
    const titleItem = { title: 'GitHub Actions', url: 'https://example.com' };
    const urlItem   = { title: 'Some page', url: 'https://github.com/actions' };
    expect(scoreItem(titleItem, ['github'])).toBeGreaterThan(scoreItem(urlItem, ['github']));
  });

  it('gives weight-adjusted score per keyword found only in URL', () => {
    const item = { title: 'Some page', url: 'https://github.com/actions' };
    // 'github' = 6 chars → weight 1.5; URL-only match: 1 * 1.5 = 1.5
    expect(scoreItem(item, ['github'])).toBe(1.5);
  });

  it('adds recency bonus for items visited less than 1 day ago', () => {
    const recentItem = {
      title: 'GitHub',
      url: 'https://github.com',
      lastVisitTime: Date.now() - 3_600_000, // 1 hour ago
    };
    const oldItem = {
      title: 'GitHub',
      url: 'https://github.com',
      lastVisitTime: Date.now() - 60 * 86_400_000, // 60 days ago
    };
    expect(scoreItem(recentItem, ['github'])).toBeGreaterThan(scoreItem(oldItem, ['github']));
  });

  it('adds recency bonus for items visited less than 7 days ago', () => {
    const item = {
      title: 'GitHub',
      url: 'https://github.com',
      lastVisitTime: Date.now() - 3 * 86_400_000, // 3 days ago
    };
    // 'github' = 6 chars → weight 1.5; title match: 3 * 1.5 = 4.5 + 1 (recency < 7d) = 5.5
    expect(scoreItem(item, ['github'])).toBe(5.5);
  });

  it('accumulates score for multiple matching keywords', () => {
    const item = { title: 'GitHub Actions CI pipeline', url: 'https://github.com' };
    const score = scoreItem(item, ['github', 'actions', 'pipeline']);
    // 3 * 3 title matches + possible recency
    expect(score).toBeGreaterThanOrEqual(9);
  });
});

// ── filterByKeywords ──────────────────────────────────────────────────────────
describe('filterByKeywords', () => {
  const items = [
    { title: 'GitHub Actions', url: 'https://github.com/actions' },
    { title: 'Google Search', url: 'https://google.com' },
    { title: 'Vitest Docs', url: 'https://vitest.dev' },
  ];

  it('returns all items when keywords is empty', () => {
    expect(filterByKeywords(items, [])).toEqual(items);
  });

  it('returns all items when keywords is null', () => {
    expect(filterByKeywords(items, null)).toEqual(items);
  });

  it('filters items that match at least one keyword', () => {
    const result = filterByKeywords(items, ['github']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('GitHub Actions');
  });

  it('matches against URL as well as title', () => {
    const result = filterByKeywords(items, ['vitest.dev']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Vitest Docs');
  });

  it('is case-insensitive', () => {
    const result = filterByKeywords(items, ['GITHUB']);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no items match', () => {
    expect(filterByKeywords(items, ['nonexistent'])).toHaveLength(0);
  });

  it('handles items with missing title or url', () => {
    const edgeCases = [
      { url: 'https://github.com' },
      { title: 'GitHub' },
      {},
    ];
    const result = filterByKeywords(edgeCases, ['github']);
    expect(result).toHaveLength(2);
  });
});

// ── getPeriodStartTime ────────────────────────────────────────────────────────
describe('getPeriodStartTime', () => {
  it('returns 0 for "all"', () => {
    expect(getPeriodStartTime('all')).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(getPeriodStartTime(null)).toBe(0);
    expect(getPeriodStartTime(undefined)).toBe(0);
  });

  it('returns 0 for unknown period string', () => {
    expect(getPeriodStartTime('3d')).toBe(0);
    expect(getPeriodStartTime('')).toBe(0);
  });

  it('returns timestamp ~1h ago for "1h"', () => {
    const expected = Date.now() - 3_600_000;
    expect(getPeriodStartTime('1h')).toBeGreaterThanOrEqual(expected - 50);
    expect(getPeriodStartTime('1h')).toBeLessThanOrEqual(expected + 50);
  });

  it('returns timestamp ~24h ago for "24h"', () => {
    const expected = Date.now() - 86_400_000;
    expect(getPeriodStartTime('24h')).toBeGreaterThanOrEqual(expected - 50);
    expect(getPeriodStartTime('24h')).toBeLessThanOrEqual(expected + 50);
  });

  it('returns timestamp ~1 week ago for "1w"', () => {
    const expected = Date.now() - 7 * 86_400_000;
    expect(getPeriodStartTime('1w')).toBeGreaterThanOrEqual(expected - 50);
    expect(getPeriodStartTime('1w')).toBeLessThanOrEqual(expected + 50);
  });
});

// ── hasCJKText ────────────────────────────────────────────────────────────────
describe('hasCJKText', () => {
  it('returns false for empty string', () => {
    expect(hasCJKText('')).toBe(false);
  });

  it('returns false for ASCII-only text', () => {
    expect(hasCJKText('hello world')).toBe(false);
    expect(hasCJKText('GitHub Actions CI')).toBe(false);
  });

  it('returns true for kanji', () => {
    expect(hasCJKText('東京')).toBe(true);
  });

  it('returns true for katakana', () => {
    expect(hasCJKText('ニュース')).toBe(true);
  });

  it('returns true for hiragana', () => {
    expect(hasCJKText('ひらがな')).toBe(true);
  });

  it('returns true for mixed text containing CJK', () => {
    expect(hasCJKText('GitHub Actions の使い方')).toBe(true);
  });
});

// ── extractBookmarkKeywords ───────────────────────────────────────────────────
describe('extractBookmarkKeywords', () => {
  it('returns empty array for empty input', () => {
    expect(extractBookmarkKeywords([])).toEqual([]);
  });

  it('extracts English words (2+ chars starting with letter)', () => {
    const result = extractBookmarkKeywords(['GitHub Actions CI']);
    expect(result).toContain('GitHub');
    expect(result).toContain('Actions');
  });

  it('extracts katakana sequences of 3+ chars', () => {
    // Space-separated so tokenizer gives a standalone katakana word
    const result = extractBookmarkKeywords(['ニュース サイト']);
    expect(result).toContain('ニュース');
    expect(result).toContain('サイト');
  });

  it('extracts kanji sequences of 2+ chars as a single token', () => {
    // No separator — entire kanji string becomes one token
    const result = extractBookmarkKeywords(['機械学習入門']);
    expect(result).toContain('機械学習入門');
  });

  it('skips single-char and short tokens that do not qualify', () => {
    const result = extractBookmarkKeywords(['A B 東 React']);
    expect(result).not.toContain('A');
    expect(result).not.toContain('B');
    expect(result).not.toContain('東');
    expect(result).toContain('React');
  });

  it('sorts by frequency — most common first', () => {
    const result = extractBookmarkKeywords([
      'GitHub入門',
      'GitHub Actions',
      'React入門',
    ]);
    expect(result[0]).toBe('GitHub');
  });

  it('caps output at 100 entries', () => {
    const titles = Array.from({ length: 200 }, (_, i) => `Page${i < 10 ? '0' + i : i}`);
    expect(extractBookmarkKeywords(titles).length).toBeLessThanOrEqual(100);
  });

  it('ignores null/empty titles gracefully', () => {
    expect(() => extractBookmarkKeywords([null, '', undefined, 'React'])).not.toThrow();
  });
});

// ── parseAIResponse ───────────────────────────────────────────────────────────
describe('parseAIResponse', () => {
  it('returns null for falsy input', () => {
    expect(parseAIResponse('')).toBeNull();
    expect(parseAIResponse(null)).toBeNull();
    expect(parseAIResponse(undefined)).toBeNull();
  });

  it('parses plain JSON array', () => {
    const input = JSON.stringify([{ title: 'A', url: 'https://a.com', score: 9 }]);
    const result = parseAIResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('A');
  });

  it('strips ```json code fences', () => {
    const input = '```json\n[{"title":"A","url":"https://a.com"}]\n```';
    const result = parseAIResponse(input);
    expect(result).not.toBeNull();
    expect(result[0].title).toBe('A');
  });

  it('strips plain ``` code fences', () => {
    const input = '```\n[{"title":"A","url":"https://a.com"}]\n```';
    expect(parseAIResponse(input)).not.toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseAIResponse('{"key":"value"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseAIResponse('not json at all')).toBeNull();
    expect(parseAIResponse('```json\nbroken\n```')).toBeNull();
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseAIResponse('[]')).toEqual([]);
  });
});
