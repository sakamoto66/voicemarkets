/**
 * popup.js — VoiceMarkets popup orchestrator.
 *
 * Owns all application state; delegates to:
 *   voice.js  — Web Speech API
 *   ai.js     — Translator + Gemini Nano intent / ranking
 *   cache.js  — bookmark + history data
 *   render.js — DOM manipulation
 *   search.js — pure scoring / filtering functions
 */

import { scoreItem, filterByKeywords, getPeriodStartTime } from './search.js';
import { SpeechRecognition, createVoice } from './voice.js';
import { parseIntent, rankWithAI, extractKeywordsBilingual, checkAIAvailability } from './ai.js';
import { buildBookmarkDictionary, buildHistoryCache } from './cache.js';
import { setStatus, renderResults, hideResults } from './render.js';
import { t, applyI18n } from './i18n.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const micBtn        = document.getElementById('micBtn');
const searchBtn     = document.getElementById('searchBtn');
const statusEl      = document.getElementById('status');
const spinnerEl     = document.getElementById('spinner');
const transcriptEl  = document.getElementById('transcript');
const resultsList   = document.getElementById('results');
const rankingInfo   = document.getElementById('ranking-info');
const periodPills   = document.querySelectorAll('.period-pill');
const sourceToggles = document.querySelectorAll('.source-toggle');

// ── State ─────────────────────────────────────────────────────────────────────
let isListening        = false;
let currentVoice       = null;   // active voice session, if any
let currentPeriod      = 'all';
let activeSources      = new Set(['bookmarks', 'history']);
let bookmarkDictionary = [];
let bookmarkCache      = [];
let historyCache       = [];

// ── Shorthand ─────────────────────────────────────────────────────────────────
const status = (text, isError = false) => setStatus(statusEl, text, isError);

function showMicPermissionError() {
  statusEl.textContent = '';
  statusEl.style.color = '#ef4444';

  const msg = document.createElement('span');
  msg.textContent = t('error_mic_permission') + ' ';

  const link = document.createElement('a');
  link.textContent = t('error_mic_open_settings');
  link.href = '#';
  link.style.cssText = 'color:inherit;text-decoration:underline;cursor:pointer';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    // Open the site-specific settings for this extension so the user
    // can toggle the mic permission directly without hunting through the list.
    const extOrigin = encodeURIComponent(`chrome-extension://${chrome.runtime.id}`);
    chrome.tabs.create({
      url: `chrome://settings/content/siteDetails?site=${extOrigin}`,
    });
  });

  statusEl.appendChild(msg);
  statusEl.appendChild(link);
}

// ── Voice recognition ─────────────────────────────────────────────────────────

/**
 * Check mic permission state and, if unprompted, show the browser permission
 * dialog via getUserMedia before starting Web Speech API.
 *
 * Returns true if we can proceed, false if permission is denied.
 */
async function ensureMicPermission() {
  // Permissions API not available (non-standard environment)
  if (!navigator.permissions) return true;

  let state;
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    state = result.state;
  } catch {
    // query not supported for 'microphone' — fall through to Web Speech API
    return true;
  }

  if (state === 'denied') {
    showMicPermissionError();
    return false;
  }

  if (state === 'prompt') {
    // Chrome extension popups cannot reliably show the getUserMedia dialog.
    // Open a dedicated full-page tab where the dialog works correctly.
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/permission.html') });
    status(t('status_mic_permission_needed'));
    return false;
  }

  return true;
}

async function startListening() {
  if (isListening) return;

  if (!SpeechRecognition) {
    status(t('error_no_speech_api'), true);
    return;
  }

  const canListen = await ensureMicPermission();
  if (!canListen) return;

  currentVoice = createVoice({
    onStart: () => {
      isListening = true;
      micBtn.classList.add('listening');
      status(t('status_listening'));
      transcriptEl.value = '';
      hideResults(resultsList, rankingInfo, transcriptEl);
    },
    onResult: (event) => {
      const result       = event.results[event.results.length - 1];
      const alternatives = Array.from({ length: result.length }, (_, i) => ({
        transcript: result[i].transcript,
        confidence: result[i].confidence ?? 1,
      }));
      transcriptEl.value = alternatives[0].transcript;

      if (result.isFinal) {
        stopListening();
        runSearch(alternatives);
      }
    },
    onError: (event) => {
      isListening = false;
      micBtn.classList.remove('listening');
      if (event.error === 'not-allowed') {
        showMicPermissionError();
      } else if (event.error === 'no-speech') {
        status(t('error_no_speech'));
      } else {
        status(t('error_speech_recognition', event.error), true);
      }
    },
    // onEnd fires only when there was no error (see voice.js).
    // If isListening is still true here, the session ended unexpectedly.
    onEnd: () => {
      if (isListening) stopListening();
    },
  });

  try {
    currentVoice.start();
  } catch (_) {
    status(t('error_start_failed'), true);
    currentVoice = null;
  }
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove('listening');
  status(transcriptEl.value ? '' : t('status_idle'));
  currentVoice?.stop();
  currentVoice = null;
}

// ── Search pipeline ───────────────────────────────────────────────────────────
/**
 * @param {Array<{transcript: string, confidence: number}>|string} input
 *   Array of recognition alternatives (from onResult) or plain string (manual input).
 */
async function runSearch(input) {
  const alternatives = typeof input === 'string'
    ? [{ transcript: input, confidence: 1 }]
    : input;

  spinnerEl.classList.remove('hidden');
  status(t('status_loading_ai'));

  try {
    // Stage 0: AI intent parsing — keyword expansion from all alternatives
    const intent = await parseIntent(alternatives, bookmarkDictionary, status);

    const bestTranscript = alternatives[0].transcript;
    const lowConfidence  = alternatives[0].confidence < 0.6;

    transcriptEl.value = bestTranscript;
    transcriptEl.classList.toggle('low-confidence', lowConfidence);

    // Fallback: extract keywords from all alternatives with confidence >= 0.1
    const usableTranscripts = alternatives
      .filter(a => a.confidence >= 0.1)
      .map(a => a.transcript);

    const keywords = (intent?.keywords?.length > 0)
      ? intent.keywords
      : [...new Set((await Promise.all(usableTranscripts.map(extractKeywordsBilingual))).flat())];

    if (keywords.length === 0) {
      status(t('error_no_recognition'));
      return;
    }

    if (activeSources.size === 0) {
      status(t('error_no_sources'), true);
      return;
    }

    status(t('status_searching'));
    const candidates = await fetchCandidates(keywords, currentPeriod, activeSources);

    if (candidates.length === 0) {
      status(t('error_no_results'));
      return;
    }

    // Stage 2: Gemini Nano ranking — falls back to Stage 1 order on failure
    const aiResult = await rankWithAI(candidates, bestTranscript);
    const ranked   = aiResult ?? candidates;

    const displayItems = ranked.slice(0, 5);
    const usedAI = aiResult !== null;
    renderResults(resultsList, rankingInfo, displayItems, usedAI, false);
    saveSearchState(displayItems, bestTranscript, usedAI, false);
    status('');
  } catch (_) {
    status(t('error_search_failed'));
  } finally {
    spinnerEl.classList.add('hidden');
  }
}

async function fetchCandidates(keywords, period, sources) {
  const startTime = getPeriodStartTime(period);

  const [bookmarks, historyItems] = await Promise.all([
    sources.has('bookmarks') ? fetchBookmarks(keywords) : Promise.resolve([]),
    sources.has('history')   ? fetchHistory(keywords)   : Promise.resolve([]),
  ]);

  // Deduplicate by URL (bookmark wins over history for the same URL)
  const seen = new Set();
  const deduped = [...bookmarks, ...historyItems].filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  const periodFiltered = startTime === 0 ? deduped : deduped.filter(item => {
    const time = item._source === 'bookmark'
      ? (item.dateAdded || 0)
      : (item.lastVisitTime || 0);
    return time >= startTime;
  });

  // Temporal-only query (no keywords): sort by recency
  if (keywords.length === 0) {
    return periodFiltered
      .sort((a, b) => {
        const ta = a._source === 'bookmark' ? (a.dateAdded || 0) : (a.lastVisitTime || 0);
        const tb = b._source === 'bookmark' ? (b.dateAdded || 0) : (b.lastVisitTime || 0);
        return tb - ta;
      })
      .slice(0, 20);
  }

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

searchBtn.addEventListener('click', () => {
  if (transcriptEl.value.trim()) {
    if (isListening) stopListening();
    runSearch(transcriptEl.value.trim());
  } else {
    transcriptEl.focus();
  }
});

// ── Search state persistence ──────────────────────────────────────────────────
const STORAGE_KEY = 'lastSearch';

function saveSearchState(items, transcript, usedAI, corrected) {
  chrome.storage.session.set({ [STORAGE_KEY]: { items, transcript, usedAI, corrected } });
}

async function restoreSearchState() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY];
  if (!saved?.items?.length) return;
  transcriptEl.value = saved.transcript ?? '';
  renderResults(resultsList, rankingInfo, saved.items, saved.usedAI, saved.corrected);
}

// ── Startup ───────────────────────────────────────────────────────────────────
document.documentElement.lang = chrome.i18n.getUILanguage();
applyI18n();
checkAIAvailability();
restoreSearchState();

Promise.all([
  buildBookmarkDictionary(),
  buildHistoryCache(),
]).then(([bookmarkResult, history]) => {
  bookmarkCache      = bookmarkResult.bookmarkCache;
  bookmarkDictionary = bookmarkResult.bookmarkDictionary;
  historyCache       = history;
});
