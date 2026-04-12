import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chrome API mock ───────────────────────────────────────────────────────────
const mockGetUILanguage = vi.fn(() => 'en-US');
global.chrome = { i18n: { getUILanguage: mockGetUILanguage } };

import {
  makeTimeout,
  uiLanguage,
  resolveOutputLang,
  makeLMOptions,
  SUPPORTED_OUTPUT_LANGS,
} from '../popup/ai-utils.js';

beforeEach(() => {
  mockGetUILanguage.mockReturnValue('en-US');
});

// ── makeTimeout ───────────────────────────────────────────────────────────────
describe('makeTimeout', () => {
  it('rejects after specified ms', async () => {
    await expect(makeTimeout(10)).rejects.toThrow('timeout');
  });

  it('uses custom label when provided', async () => {
    await expect(makeTimeout(10, 'AI timeout')).rejects.toThrow('AI timeout');
  });
});

// ── uiLanguage ────────────────────────────────────────────────────────────────
describe('uiLanguage', () => {
  it('returns base language tag (strips region)', () => {
    mockGetUILanguage.mockReturnValue('en-US');
    expect(uiLanguage()).toBe('en');
  });

  it('returns ja for Japanese locale', () => {
    mockGetUILanguage.mockReturnValue('ja-JP');
    expect(uiLanguage()).toBe('ja');
  });

  it('returns es for Spanish locale', () => {
    mockGetUILanguage.mockReturnValue('es-ES');
    expect(uiLanguage()).toBe('es');
  });

  it('returns plain language code unchanged', () => {
    mockGetUILanguage.mockReturnValue('zh');
    expect(uiLanguage()).toBe('zh');
  });
});

// ── resolveOutputLang ─────────────────────────────────────────────────────────
describe('resolveOutputLang', () => {
  it('returns supported lang as-is', () => {
    expect(resolveOutputLang('en')).toBe('en');
    expect(resolveOutputLang('ja')).toBe('ja');
    expect(resolveOutputLang('es')).toBe('es');
  });

  it('falls back to en for unsupported lang', () => {
    expect(resolveOutputLang('zh')).toBe('en');
    expect(resolveOutputLang('fr')).toBe('en');
    expect(resolveOutputLang('ko')).toBe('en');
  });

  it('SUPPORTED_OUTPUT_LANGS contains en, es, ja', () => {
    expect(SUPPORTED_OUTPUT_LANGS).toContain('en');
    expect(SUPPORTED_OUTPUT_LANGS).toContain('es');
    expect(SUPPORTED_OUTPUT_LANGS).toContain('ja');
  });
});

// ── makeLMOptions ─────────────────────────────────────────────────────────────
describe('makeLMOptions', () => {
  it('builds expected options structure', () => {
    const opts = makeLMOptions(['en', 'ja'], 'en');
    expect(opts).toHaveProperty('expectedInputs');
    expect(opts).toHaveProperty('expectedOutputs');
  });

  it('deduplicates input languages', () => {
    const opts = makeLMOptions(['en', 'en', 'ja'], 'en');
    const langs = opts.expectedInputs[0].languages;
    expect(langs).toEqual([...new Set(langs)]);
    expect(langs.length).toBe(2);
  });

  it('sets correct output language', () => {
    const opts = makeLMOptions(['en'], 'ja');
    expect(opts.expectedOutputs[0].languages).toEqual(['ja']);
  });

  it('sets input type to text', () => {
    const opts = makeLMOptions(['en'], 'en');
    expect(opts.expectedInputs[0].type).toBe('text');
  });
});
