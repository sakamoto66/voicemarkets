import { describe, it, expect } from 'vitest';
import {
  extractKeywords,
  scoreItem,
  filterByKeywords,
  parseAIResponse,
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

  it('gives +1 per keyword found only in URL', () => {
    const item = { title: 'Some page', url: 'https://github.com/actions' };
    expect(scoreItem(item, ['github'])).toBe(1);
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
    // base: 3 (title) + 1 (recency < 7d)
    expect(scoreItem(item, ['github'])).toBe(4);
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
