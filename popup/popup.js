/**
 * popup.js — VoiceMarkets popup main logic.
 * Phase 1: Voice input via Web Speech API
 * Phase 2: Keyword pre-filter search pipeline
 * Phase 3: Gemini Nano semantic ranking (when available)
 */

import { extractKeywords, scoreItem, filterByKeywords, parseAIResponse } from './search.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const micBtn       = document.getElementById('micBtn');
const statusEl     = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const resultsList  = document.getElementById('results');
const rankingInfo  = document.getElementById('ranking-info');

// ── State ─────────────────────────────────────────────────────────────────────
let recognition = null;
let isListening = false;

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
    transcriptEl.textContent = '';
    hideResults();
  };

  r.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const transcript = result[0].transcript;
    transcriptEl.textContent = transcript;

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
    if (!errorOccurred) {
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
  if (!transcriptEl.textContent) {
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
  const keywords = extractKeywords(transcript);

  if (keywords.length === 0) {
    setStatus('認識できませんでした。もう一度お試しください');
    return;
  }

  setStatus('検索中…');

  try {
    const candidates = await fetchCandidates(keywords);

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
  }
}

/**
 * Stage 1: Fetch and score bookmark + history candidates.
 * Returns top 20 items sorted by score, descending.
 */
async function fetchCandidates(keywords) {
  const [bookmarks, historyItems] = await Promise.all([
    fetchBookmarks(keywords),
    fetchHistory(keywords),
  ]);

  const all = [...bookmarks, ...historyItems];

  // Deduplicate by URL
  const seen = new Set();
  const deduped = all.filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Score and filter
  return deduped
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
    return results.flat();
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
    return filterByKeywords(items, keywords);
  } catch (_) {
    return [];
  }
}

// ── Gemini Nano (Stage 2) ─────────────────────────────────────────────────────
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

    const prompt = `Query:"${transcript.slice(0, 50)}"\nItems:\n${itemList}\nReturn JSON:[{i,score}] i=item number,score=0-10`;

    // Phase 3: log estimated payload size for token budget measurement
    console.debug('[VoiceMarkets] AI prompt length (chars):', prompt.length, '| candidates:', candidates.length);

    const response = await Promise.race([session.prompt(prompt), makeTimeout(30000)]);
    session.destroy();

    console.debug('[VoiceMarkets] AI raw response:', response);

    const parsed = parseAIResponse(response);
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
      window.close();
    };

    a.addEventListener('click', (e) => { e.preventDefault(); openItem(); });
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); }
    });

    const title = document.createElement('span');
    title.className   = 'result-title';
    title.textContent = item.title || item.url;

    const url = document.createElement('span');
    url.className   = 'result-url';
    url.textContent = item.url;

    a.append(title, url);
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

checkAIAvailability();
