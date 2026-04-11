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

// ── Web Speech API setup ──────────────────────────────────────────────────────
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

function initRecognition() {
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.maxAlternatives = 1;
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
    const transcript = result[0].transcript;
    transcriptEl.value = transcript;

    if (result.isFinal) {
      stopListening();
      runSearch(transcript);
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
async function runSearch(transcript) {
  spinnerEl.classList.remove('hidden');
  setStatus('AIモデルを読み込み中…');

  try {
    // Stage 0: Parse intent with AI, fall back to keyword extraction silently
    const intent = await parseIntent(transcript, setStatus);
    if (intent) applyIntentToUI(intent);

    const keywords = (intent?.keywords?.length > 0)
      ? intent.keywords
      : extractKeywords(transcript);

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
    const aiResult = await rankWithAI(candidates, transcript);
    const ranked = aiResult ?? candidates;
    const usedAI = aiResult !== null;

    renderResults(ranked.slice(0, 5), usedAI);
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

async function fetchBookmarks(keywords) {
  try {
    const results = await Promise.all(
      keywords.map(kw => chrome.bookmarks.search(kw))
    );
    return results.flat().map(item => ({ ...item, _source: 'bookmark' }));
  } catch (_) {
    return [];
  }
}

async function fetchHistory(keywords) {
  try {
    // Fetch ALL history — chrome.history.search text filter is broken for Japanese
    const items = await chrome.history.search({
      text: '',
      maxResults: 1000,
      startTime: 0,
    });
    return filterByKeywords(items, keywords).map(item => ({ ...item, _source: 'history' }));
  } catch (_) {
    return [];
  }
}

// ── Gemini Nano (Stage 0) — Intent parsing ────────────────────────────────────
/**
 * Parse search intent from a voice transcript using Gemini Nano.
 * Returns { period, keywords, sources } on success, null if unavailable or fails.
 *
 * period:   'all' | '1h' | '24h' | '1w' | '1m' | '1y'
 * keywords: string[] — expanded keyword variants (multilingual, spelling variations)
 * sources:  ('bookmarks' | 'history')[]
 */
async function parseIntent(transcript, onStatus = () => {}) {
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
      'You are a search keyword expander for a browser history/bookmark search tool.',
      '',
      '## period',
      'Detect the time range from the query:',
      '  "直近" "さっき" "今さっき" → 1h',
      '  "今日" "今朝" "昨日" "最近" → 24h',
      '  "今週" "先週" → 1w',
      '  "今月" → 1m',
      '  "今年" → 1y',
      '  no time expression → all',
      '',
      '## keywords',
      'Steps (ALWAYS follow all steps):',
      '1. Extract core topic words; drop time/source words (今日,履歴,ブックマーク,見た,お気に入り,etc.)',
      '2. For EVERY katakana word, generate its romaji by sounding out each mora:',
      '   "オープンクローズ" → "opunkurozu"  "ギットハブ" → "gittohab"  "リアクト" → "riakuto"',
      '3. For EVERY katakana word, guess the English brand/product name it likely transcribes:',
      '   "オープンクローズ" → try "openclaw","open claw","open close"',
      '   "ツイッター" → "twitter"  "ユーチューブ" → "youtube"  "ギットハブ" → "github"',
      '   "リアクト" → "react"  "ネクスト" → "next"  "タイプスクリプト" → "typescript"',
      '4. Add English ↔ Japanese translations (e.g. "ニュース" → add "news")',
      '5. Add abbreviations/full forms (e.g. "AI" → add "artificial intelligence")',
      'Return ALL generated forms as a flat string array. Max 10 items.',
      '',
      '## sources',
      '["bookmarks"] if user says bookmark/お気に入り/ブックマーク.',
      '["history"] if user says 履歴/見た/visited/閲覧.',
      '["bookmarks","history"] otherwise.',
      ...(bookmarkDictionary.length > 0 ? [
        '',
        '## known terms from user\'s bookmarks',
        'If a spoken word sounds like one of these, prefer it as the corrected spelling:',
        bookmarkDictionary.slice(0, 60).join(', '),
      ] : []),
    ].join('\n');
    console.debug('[VoiceMarkets] parseIntent systemPrompt:\n', systemPrompt);

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
        period:   { type: 'string', enum: ['all', '1h', '24h', '1w', '1m', '1y'] },
        keywords: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        sources:  { type: 'array', items: { type: 'string', enum: ['bookmarks', 'history'] } },
      },
      required: ['period', 'keywords', 'sources'],
    };

    onStatus('クエリを解析中…');
    const intentPrompt = `Query: "${transcript.slice(0, 100)}"`;
    console.debug('[VoiceMarkets] parseIntent prompt:', intentPrompt);
    const response = await Promise.race([
      session.prompt(intentPrompt, { responseConstraint: schema }),
      makeTimeout(60000),
    ]);
    session.destroy();

    const intent = JSON.parse(response);
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
 */
function renderResults(items, usedAI = false) {
  clearChildren(resultsList);

  // Show ranking method badge using safe DOM API (no innerHTML)
  clearChildren(rankingInfo);
  rankingInfo.appendChild(document.createTextNode(`${items.length}件`));
  const badge = document.createElement('span');
  badge.className = usedAI ? 'badge badge-ai' : 'badge badge-keyword';
  badge.textContent = usedAI ? 'AI' : 'キーワード順';
  rankingInfo.appendChild(badge);
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
        if (node.url && node.title) titles.push(node.title);
        if (node.children) walk(node.children);
      }
    }

    walk(tree);
    bookmarkDictionary = extractBookmarkKeywords(titles);
    console.debug('[VoiceMarkets] Bookmark dictionary:', bookmarkDictionary.length, 'words');
  } catch (e) {
    console.debug('[VoiceMarkets] buildBookmarkDictionary failed:', e);
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
