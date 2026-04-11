/**
 * popup.js — VoiceMarkets popup main logic.
 * Phase 1: Voice input via Web Speech API
 * Phase 2: Keyword pre-filter search pipeline
 * Phase 3: Gemini Nano semantic ranking (when available)
 */

import { extractKeywords, scoreItem, filterByKeywords, getPeriodStartTime, extractBookmarkKeywords } from './search.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const micBtn        = document.getElementById('micBtn');
const statusEl      = document.getElementById('status');
const spinnerEl     = document.getElementById('spinner');
const transcriptEl  = document.getElementById('transcript');
const resultsList   = document.getElementById('results');
const rankingInfo   = document.getElementById('ranking-info');
const periodPills   = document.querySelectorAll('.period-pill');
const sourceToggles = document.querySelectorAll('.source-toggle');

// ── State ─────────────────────────────────────────────────────────────────────
let recognition       = null;
let isListening       = false;
let currentPeriod     = 'all';
let activeSources     = new Set(['bookmarks', 'history']);
let bookmarkDictionary = []; // populated at startup from bookmark titles
let bookmarkCache      = []; // flat list of all bookmark nodes (url + title + dateAdded)
let historyCache       = []; // recent history items fetched once at popup startup

// ── Web Speech API setup ──────────────────────────────────────────────────────
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

function initRecognition() {
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.maxAlternatives = 3;
  r.continuous = false;

  // Track whether onerror already set a status so onend doesn't overwrite it.
  let errorOccurred = false;

  r.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    statusEl.textContent = '聞いています…';
    transcriptEl.value = '';
    hideResults();
  };

  r.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const alternatives = Array.from({ length: result.length }, (_, i) => ({
      transcript: result[i].transcript,
      confidence: result[i].confidence ?? 1,
    }));
    transcriptEl.value = alternatives[0].transcript;

    if (result.isFinal) {
      stopListening();
      runSearch(alternatives);
    }
  };

  r.onerror = (event) => {
    errorOccurred = true;
    isListening = false;
    micBtn.classList.remove('listening');

    if (event.error === 'not-allowed') {
      setStatus('マイク許可が必要です。chrome://settings/content/microphone で許可してください', true);
    } else if (event.error === 'no-speech') {
      setStatus('音声が検出されませんでした。もう一度試してください');
    } else {
      setStatus(`音声認識エラー: ${event.error}`, true);
    }
  };

  r.onend = () => {
    // If onerror already displayed a message, don't overwrite it.
    // Also skip if stopListening() was already called from onresult (isListening already false).
    if (!errorOccurred && isListening) {
      stopListening();
    }
  };

  return r;
}

function startListening() {
  if (isListening) return;

  if (!SpeechRecognition) {
    setStatus('このブラウザは音声認識に対応していません', true);
    return;
  }

  recognition = initRecognition();
  try {
    recognition.start();
  } catch (_) {
    setStatus('音声認識を開始できませんでした', true);
  }
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove('listening');
  if (!transcriptEl.value) {
    setStatus('クリックして話す');
  } else {
    setStatus('');
  }
  try {
    recognition?.stop();
  } catch (_) {
    // already stopped — ignore
  }
}

// ── Search pipeline ───────────────────────────────────────────────────────────
/**
 * @param {Array<{transcript: string, confidence: number}>|string} input
 *   Either an array of recognition alternatives (from onresult) or a plain string (from manual input).
 */
async function runSearch(input) {
  // Normalize: manual text input arrives as a string
  const alternatives = typeof input === 'string'
    ? [{ transcript: input, confidence: 1 }]
    : input;

  spinnerEl.classList.remove('hidden');
  setStatus('AIモデルを読み込み中…');

  try {
    // Stage 0: Parse intent with AI, fall back to keyword extraction silently
    const intent = await parseIntent(alternatives, setStatus);
    if (intent) applyIntentToUI(intent);

    // Use the transcript selected by AI, or the highest-confidence alternative
    const selectedIndex = (intent?.selected != null && alternatives[intent.selected - 1])
      ? intent.selected - 1
      : 0;
    const bestTranscript = alternatives[selectedIndex].transcript;
    const corrected = selectedIndex > 0;
    const lowConfidence = alternatives[0].confidence < 0.6;

    transcriptEl.value = bestTranscript;
    transcriptEl.classList.toggle('low-confidence', lowConfidence && !corrected);

    const keywords = (intent?.keywords?.length > 0)
      ? intent.keywords
      : await extractKeywordsBilingual(bestTranscript);

    // Allow empty keywords only when AI detected a non-'all' period (temporal-only query)
    const hasTemporalIntent = intent && intent.period && intent.period !== 'all';
    if (keywords.length === 0 && !hasTemporalIntent) {
      setStatus('認識できませんでした。もう一度お試しください');
      return;
    }

    if (activeSources.size === 0) {
      setStatus('検索先を選択してください');
      return;
    }

    setStatus('検索中…');

    const candidates = await fetchCandidates(keywords, currentPeriod, activeSources);

    if (candidates.length === 0) {
      setStatus('一致するページが見つかりませんでした');
      return;
    }

    // Stage 2: Try Gemini Nano ranking, fall back to Stage 1 keyword order silently
    const aiResult = await rankWithAI(candidates, bestTranscript);
    const ranked = aiResult ?? candidates;
    const usedAI = aiResult !== null;

    renderResults(ranked.slice(0, 5), usedAI, corrected);
    setStatus('');
  } catch (_) {
    setStatus('検索中にエラーが発生しました。もう一度お試しください');
  } finally {
    spinnerEl.classList.add('hidden');
  }
}

/**
 * Stage 1: Fetch and score bookmark + history candidates.
 * Returns top 20 items sorted by score, descending.
 *
 * Each item is tagged with _source: 'bookmark' | 'history'.
 * Period filter uses dateAdded for bookmarks, lastVisitTime for history.
 */
async function fetchCandidates(keywords, period, sources) {
  const startTime = getPeriodStartTime(period);

  const [bookmarks, historyItems] = await Promise.all([
    sources.has('bookmarks') ? fetchBookmarks(keywords) : Promise.resolve([]),
    sources.has('history')   ? fetchHistory(keywords)   : Promise.resolve([]),
  ]);

  const all = [...bookmarks, ...historyItems];

  // Deduplicate by URL (bookmark wins over history for the same URL)
  const seen = new Set();
  const deduped = all.filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Apply period filter
  const periodFiltered = startTime === 0 ? deduped : deduped.filter(item => {
    const time = item._source === 'bookmark'
      ? (item.dateAdded || 0)
      : (item.lastVisitTime || 0);
    return time >= startTime;
  });

  // Temporal-only query (no keywords): sort by recency instead of keyword score
  if (keywords.length === 0) {
    return periodFiltered
      .sort((a, b) => {
        const ta = a._source === 'bookmark' ? (a.dateAdded || 0) : (a.lastVisitTime || 0);
        const tb = b._source === 'bookmark' ? (b.dateAdded || 0) : (b.lastVisitTime || 0);
        return tb - ta;
      })
      .slice(0, 20);
  }

  // Score and filter by keywords
  return periodFiltered
    .map(item => ({ item, score: scoreItem(item, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ item }) => item);
}

function fetchBookmarks(keywords) {
  return filterByKeywords(bookmarkCache, keywords)
    .map(item => ({ ...item, _source: 'bookmark' }));
}

function fetchHistory(keywords) {
  return filterByKeywords(historyCache, keywords)
    .map(item => ({ ...item, _source: 'history' }));
}

// ── Translator API helper ─────────────────────────────────────────────────────
/**
 * Translate text using the Chrome built-in Translator API.
 * Returns the translated string on success, null if unavailable or fails.
 *
 * @param {string} text
 * @param {'ja'|'en'} sourceLang
 * @param {'ja'|'en'} targetLang
 * @returns {Promise<string|null>}
 */
async function translateQuery(text, sourceLang, targetLang) {
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
 * Extract keywords from a transcript in both its original language and the opposite language.
 * Falls back to single-language extraction if Translator API is unavailable.
 *
 * @param {string} transcript
 * @returns {Promise<string[]>}
 */
async function extractKeywordsBilingual(transcript) {
  const original = extractKeywords(transcript);

  const hasCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(transcript);
  const translated = await translateQuery(
    transcript,
    hasCJK ? 'ja' : 'en',
    hasCJK ? 'en' : 'ja',
  );

  if (!translated) return original;

  const fromTranslation = extractKeywords(translated);
  // Merge, deduplicate, preserve original-language terms first
  const merged = [...original];
  for (const kw of fromTranslation) {
    if (!merged.includes(kw)) merged.push(kw);
  }
  console.debug('[VoiceMarkets] bilingual keywords:', merged);
  return merged;
}

// ── Gemini Nano (Stage 0) — Intent parsing ────────────────────────────────────
/**
 * Parse search intent from voice recognition alternatives using Gemini Nano.
 * Returns { selected, period, keywords, sources } on success, null if unavailable or fails.
 *
 * selected: number — 1-based index of the best alternative chosen by AI
 * period:   'all' | '1h' | '24h' | '1w' | '1m' | '1y'
 * keywords: string[] — expanded keyword variants (multilingual, spelling variations)
 * sources:  ('bookmarks' | 'history')[]
 *
 * @param {Array<{transcript: string, confidence: number}>} alternatives
 */
async function parseIntent(alternatives, onStatus = () => {}) {
  if (typeof LanguageModel === 'undefined') return null;

  try {
    const availability = await LanguageModel.availability({
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['en'],
    });
    if (availability !== 'available') return null;

    const makeTimeout = (ms) => new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    );

    onStatus('AIモデルを読み込み中…');
    const systemPrompt = [
      'You are a multilingual search keyword expander for a browser bookmark/history search tool.',
      'Bookmarks have titles in Japanese, English, or both.',
      'Generate keywords in BOTH languages so the search matches regardless of how the page was titled.',
      '',
      '## selected',
      'Pick the most natural-sounding speech-recognition alternative (1-based index).',
      '',
      '## period',
      'Detect time range from the chosen alternative:',
      '  "直近" "さっき" "今さっき" → 1h',
      '  "今日" "今朝" "昨日" "最近" → 24h',
      '  "今週" "先週" → 1w | "今月" → 1m | "今年" → 1y | otherwise → all',
      '',
      '## keywords',
      'For every topic concept in the query, generate ALL of the following variants:',
      '1. Drop stop/meta words: の,を,に,は,た,こと,見た,今日,履歴,ブックマーク,お気に入り,検索,開いた',
      '2. Original surface form (e.g. "ニュース", "react")',
      '3. English equivalent for Japanese ("ニュース"→"news", "設定"→"settings", "入門"→"introduction", "機械学習"→"machine learning")',
      '4. Japanese/katakana equivalent for English ("news"→"ニュース", "settings"→"設定", "react"→"リアクト")',
      '5. Resolve katakana to actual English brand/product name:',
      '   "ギットハブ"→"github" | "リアクト"→"react" | "タイプスクリプト"→"typescript"',
      '   "ツイッター"→"twitter" | "ユーチューブ"→"youtube" | "ネクスト"→"nextjs"',
      '   "パイソン"→"python" | "ドッカー"→"docker" | "クロード"→"claude" | "オープンエーアイ"→"openai"',
      '6. Common abbreviations and expansions: "JS"↔"javascript", "TS"↔"typescript", "AI"↔"artificial intelligence", "ML"↔"machine learning"',
      '7. Related sub-terms: e.g. "react" → also add "jsx", "component", "hook"; "docker" → "container", "compose"',
      '8. Spelling variants and common typos that a speech recognizer might produce',
      'Target 20 items. Always include both Japanese and English forms for every concept.',
      '',
      '## sources',
      '["bookmarks"] if user says お気に入り/ブックマーク/bookmark/favorite.',
      '["history"] if user says 履歴/見た/visited/閲覧/browsed.',
      '["bookmarks","history"] otherwise.',
      ...(bookmarkDictionary.length > 0 ? [
        '',
        '## known terms from user\'s bookmarks (prefer these spellings when a spoken word sounds similar)',
        bookmarkDictionary.slice(0, 60).join(', '),
      ] : []),
    ].join('\n');
    console.debug('[VoiceMarkets] parseIntent systemPrompt:\n', systemPrompt);

    // Try Translator API to get a translation hint for the primary alternative
    const primaryText = alternatives[0].transcript;
    const hasCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(primaryText);
    const translationHint = await translateQuery(
      primaryText,
      hasCJK ? 'ja' : 'en',
      hasCJK ? 'en' : 'ja',
    );

    const session = await Promise.race([
      LanguageModel.create({
        systemPrompt,
        expectedInputLanguages: ['ja', 'en'],
        expectedOutputLanguages: ['en'],
      }),
      makeTimeout(60000),
    ]);

    const schema = {
      type: 'object',
      properties: {
        selected: { type: 'number' },
        period:   { type: 'string', enum: ['all', '1h', '24h', '1w', '1m', '1y'] },
        keywords: { type: 'array', items: { type: 'string' }, minIndex: 5, maxItems: 20 },
        sources:  { type: 'array', items: { type: 'string', enum: ['bookmarks', 'history'] } },
      },
      required: ['selected', 'period', 'keywords', 'sources'],
    };

    onStatus('クエリを解析中…');
    const altLines = alternatives
      .map((a, i) => `${i + 1}. "${a.transcript.slice(0, 80)}" (confidence: ${a.confidence.toFixed(2)})`)
      .join('\n');
    const translationLine = translationHint
      ? `\nTranslation (${hasCJK ? 'EN' : 'JA'}) — you MUST include words from this in keywords: "${translationHint}"`
      : '';
    const intentPrompt = `Speech recognition alternatives:\n${altLines}${translationLine}`;
    console.debug('[VoiceMarkets] parseIntent prompt:', intentPrompt);
    const response = await Promise.race([
      session.prompt(intentPrompt, { responseConstraint: schema }),
      makeTimeout(60000),
    ]);
    session.destroy();

    const intent = JSON.parse(response);

    // Guarantee both the original-form and translated-form keywords are present,
    // regardless of what the AI returned.
    if (Array.isArray(intent.keywords)) {
      const origKeywords = extractKeywords(primaryText);
      const transKeywords = translationHint ? extractKeywords(translationHint) : [];
      for (const kw of [...origKeywords, ...transKeywords]) {
        if (!intent.keywords.includes(kw)) intent.keywords.push(kw);
      }
      intent.keywords = intent.keywords.slice(0, 20);
    }

    console.debug('[VoiceMarkets] Parsed intent:', intent);
    return intent;
  } catch (e) {
    console.debug('[VoiceMarkets] parseIntent failed:', e);
    return null;
  }
}

/**
 * Apply a parsed intent to the UI (period pills + source toggles).
 * Also updates currentPeriod and activeSources so fetchCandidates picks them up.
 */
function applyIntentToUI(intent) {
  if (intent.period) {
    currentPeriod = intent.period;
    for (const p of periodPills) {
      p.classList.toggle('active', p.dataset.period === intent.period);
    }
  }
  if (intent.sources && intent.sources.length > 0) {
    activeSources = new Set(intent.sources);
    for (const t of sourceToggles) {
      const active = activeSources.has(t.dataset.source);
      t.classList.toggle('active', active);
      t.setAttribute('aria-pressed', String(active));
    }
  }
}

// ── Gemini Nano (Stage 2) — Ranking ──────────────────────────────────────────
/**
 * Rank candidates using Gemini Nano.
 * Returns ranked array on success, null if AI is unavailable or fails.
 * Caller uses null to distinguish "AI used" from "AI skipped/failed".
 */
async function rankWithAI(candidates, transcript) {
  if (typeof LanguageModel === 'undefined') return null;

  try {
    const availability = await LanguageModel.availability({
      expectedInputLanguages: ['ja', 'en'],
      expectedOutputLanguages: ['en'],
    });
    if (availability !== 'available') {
      console.debug('[VoiceMarkets] LanguageModel not available:', availability);
      return null;
    }

    const makeTimeout = (ms) => new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI timeout')), ms)
    );

    const session = await Promise.race([
      LanguageModel.create({
        systemPrompt: 'Rank browser history items by relevance to a query. Output ONLY a JSON array [{url,score}] sorted by score descending.',
        expectedInputLanguages: ['ja', 'en'],
        expectedOutputLanguages: ['en'],
      }),
      makeTimeout(30000),
    ]);

    // Use top 5 candidates only to keep prompt short for Gemini Nano
    const top = candidates.slice(0, 5);
    const itemList = top
      .map((item, i) => `${i + 1}. ${(item.title || '').slice(0, 40)}`)
      .join('\n');

    const prompt = `Query:"${transcript.slice(0, 50)}"\nItems:\n${itemList}\nRank by relevance. i=item number(1-based), score=0-10`;

    // Phase 3: log estimated payload size for token budget measurement
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

    const response = await Promise.race([
      session.prompt(prompt, { responseConstraint }),
      makeTimeout(30000),
    ]);
    session.destroy();

    console.debug('[VoiceMarkets] AI raw response:', response);

    let parsed;
    try {
      parsed = JSON.parse(response);
      if (!Array.isArray(parsed)) parsed = null;
    } catch {
      parsed = null;
    }
    console.debug('[VoiceMarkets] AI parsed:', parsed);
    if (!parsed) return null;

    // Map AI results back to candidates by index (i) or URL
    const ranked = parsed
      .filter(r => r.i != null ? top[r.i - 1] : r.url && top.find(c => c.url === r.url))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(r => r.i != null ? top[r.i - 1] : top.find(c => c.url === r.url))
      .filter(Boolean);

    console.debug('[VoiceMarkets] AI ranked count:', ranked.length);
    return ranked.length > 0 ? ranked : null;
  } catch (_) {
    console.debug('[VoiceMarkets] rankWithAI failed:', _);
    return null;
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function createSourceIcon(source) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('result-source-icon', source === 'bookmark' ? 'bookmark' : 'history');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', source === 'bookmark'
    ? 'M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z'
    : 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5v5.25l4.5 2.67-.75 1.23L11 13V7h1.5z'
  );
  svg.appendChild(path);
  return svg;
}

// ── Render ────────────────────────────────────────────────────────────────────
/**
 * @param {Array} items
 * @param {boolean} usedAI - true when Gemini Nano ranking was applied
 * @param {boolean} corrected - true when AI picked a non-primary recognition alternative
 */
function renderResults(items, usedAI = false, corrected = false) {
  clearChildren(resultsList);

  // Show ranking method badge using safe DOM API (no innerHTML)
  clearChildren(rankingInfo);
  rankingInfo.appendChild(document.createTextNode(`${items.length}件`));
  const badge = document.createElement('span');
  badge.className = usedAI ? 'badge badge-ai' : 'badge badge-keyword';
  badge.textContent = usedAI ? 'AI' : 'キーワード順';
  rankingInfo.appendChild(badge);
  if (corrected) {
    const correctedBadge = document.createElement('span');
    correctedBadge.className = 'badge badge-corrected';
    correctedBadge.textContent = '補正';
    rankingInfo.appendChild(correctedBadge);
  }
  rankingInfo.classList.remove('hidden');

  for (const item of items) {
    const li = document.createElement('li');
    const a  = document.createElement('a');
    a.className = 'result-item';
    a.href      = item.url;
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';
    a.tabIndex  = 0;

    const openItem = () => {
      chrome.tabs.create({ url: item.url });
    };

    a.addEventListener('click', (e) => { e.preventDefault(); openItem(); });
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); }
    });

    // Title row with source icon
    const header = document.createElement('div');
    header.className = 'result-header';
    header.appendChild(createSourceIcon(item._source));

    const title = document.createElement('span');
    title.className   = 'result-title';
    title.textContent = item.title || item.url;
    header.appendChild(title);

    const url = document.createElement('span');
    url.className   = 'result-url';
    url.textContent = item.url;

    a.append(header, url);
    li.appendChild(a);
    resultsList.appendChild(li);
  }

  resultsList.classList.remove('hidden');
}

function hideResults() {
  resultsList.classList.add('hidden');
  rankingInfo.classList.add('hidden');
  transcriptEl.classList.remove('low-confidence');
  clearChildren(resultsList);
  clearChildren(rankingInfo);
}

/** Remove all child nodes without using innerHTML. */
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#ef4444' : '';
}

// ── Bookmark dictionary ───────────────────────────────────────────────────────
/**
 * Fetch all bookmarks and build a keyword dictionary from their titles.
 * Called once at popup startup; result is stored in bookmarkDictionary.
 */
async function buildBookmarkDictionary() {
  try {
    const tree = await chrome.bookmarks.getTree();
    const titles = [];

    function walk(nodes) {
      for (const node of nodes) {
        if (node.url && node.title) {
          titles.push(node.title);
          bookmarkCache.push(node);
        }
        if (node.children) walk(node.children);
      }
    }

    walk(tree);
    bookmarkDictionary = extractBookmarkKeywords(titles);
    console.debug('[VoiceMarkets] Bookmark dictionary:', bookmarkDictionary.length, 'words');
    console.debug('[VoiceMarkets] Bookmark cache:', bookmarkCache.length, 'items');
  } catch (e) {
    console.debug('[VoiceMarkets] buildBookmarkDictionary failed:', e);
  }
}

// ── History cache ─────────────────────────────────────────────────────────────
/**
 * Fetch recent history once at popup startup and store in historyCache.
 * 90-day window, up to 5 000 items — covers typical browsing without
 * making the cache unwieldy. fetchHistory() reads from this cache instead
 * of making a fresh API call on every search.
 */
async function buildHistoryCache() {
  try {
    historyCache = await chrome.history.search({
      text: '',
      maxResults: 5000,
      startTime: Date.now() - 90 * 86_400_000,
    });
    console.debug('[VoiceMarkets] History cache:', historyCache.length, 'items');
  } catch (e) {
    console.debug('[VoiceMarkets] buildHistoryCache failed:', e);
  }
}

// ── Gemini Nano availability check ───────────────────────────────────────────
async function checkAIAvailability() {
  if (typeof LanguageModel === 'undefined') {
    console.debug('[VoiceMarkets] LanguageModel unavailable — キーワード順で動作します');
    return;
  }
  try {
    const availability = await LanguageModel.availability({ expectedInputLanguages: ['ja', 'en'], expectedOutputLanguages: ['en'] });
    console.debug('[VoiceMarkets] Gemini Nano availability:', availability);
  } catch (e) {
    console.debug('[VoiceMarkets] Gemini Nano capability check failed:', e);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
micBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});

for (const pill of periodPills) {
  pill.addEventListener('click', () => {
    currentPeriod = pill.dataset.period;
    for (const p of periodPills) p.classList.remove('active');
    pill.classList.add('active');
  });
}

for (const toggle of sourceToggles) {
  toggle.addEventListener('click', () => {
    const source = toggle.dataset.source;
    if (activeSources.has(source)) {
      activeSources.delete(source);
      toggle.classList.remove('active');
      toggle.setAttribute('aria-pressed', 'false');
    } else {
      activeSources.add(source);
      toggle.classList.add('active');
      toggle.setAttribute('aria-pressed', 'true');
    }
  });
}

transcriptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && transcriptEl.value.trim()) {
    e.preventDefault();
    if (isListening) stopListening();
    runSearch(transcriptEl.value.trim());
  }
});

checkAIAvailability();
buildBookmarkDictionary();
buildHistoryCache();
