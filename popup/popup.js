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
    setStatus('キーワードが見つかりませんでした');
    return;
  }

  setStatus('検索中…');

  try {
    const candidates = await fetchCandidates(keywords);

    if (candidates.length === 0) {
      setStatus('結果が見つかりませんでした');
      return;
    }

    // Stage 2: Try Gemini Nano ranking, fall back to Stage 1 order silently
    const ranked = await rankWithAI(candidates, transcript) ?? candidates;

    renderResults(ranked.slice(0, 5));
    setStatus('');
  } catch (_) {
    setStatus('検索中にエラーが発生しました');
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
async function rankWithAI(candidates, transcript) {
  if (!window.ai?.languageModel) return null;

  try {
    const session = await window.ai.languageModel.create({
      systemPrompt:
        'You are a browser history search assistant. Given a voice query and a list of browser items, return a JSON array of the most relevant items sorted by relevance. Include only items from the input list. Output ONLY a JSON array with objects containing "title", "url", and "score" (0–10).',
    });

    const itemList = candidates
      .map((item, i) => `${i + 1}. ${item.title || '(no title)'} — ${item.url}`)
      .join('\n');

    const prompt = `Voice query: "${transcript}"\n\nItems:\n${itemList}\n\nReturn top 5 as JSON array.`;

    const response = await session.prompt(prompt);
    session.destroy();

    const parsed = parseAIResponse(response);
    if (!parsed) return null;

    // Map AI results back to original candidate objects by URL
    const byUrl = Object.fromEntries(candidates.map(c => [c.url, c]));
    return parsed
      .filter(r => r.url && byUrl[r.url])
      .map(r => byUrl[r.url]);
  } catch (_) {
    return null;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults(items) {
  clearChildren(resultsList);

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
  clearChildren(resultsList);
}

/** Remove all child nodes without using innerHTML. */
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#ef4444' : '';
}

// ── Event listeners ───────────────────────────────────────────────────────────
micBtn.addEventListener('click', () => {
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
});
