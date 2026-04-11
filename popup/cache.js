/**
 * cache.js — Bookmark and history data fetching for VoiceMarkets popup.
 * Called once at popup startup; results are passed to the search pipeline.
 */

import { extractBookmarkKeywords } from './search.js';

/**
 * Fetch all bookmarks and build a keyword dictionary from their titles.
 * Returns { bookmarkCache, bookmarkDictionary } — both are empty arrays on failure.
 *
 * @returns {Promise<{ bookmarkCache: Array, bookmarkDictionary: string[] }>}
 */
export async function buildBookmarkDictionary() {
  try {
    const tree = await chrome.bookmarks.getTree();
    const bookmarkCache = [];
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
    const bookmarkDictionary = extractBookmarkKeywords(titles);
    console.debug('[VoiceMarkets] Bookmark dictionary:', bookmarkDictionary.length, 'words');
    console.debug('[VoiceMarkets] Bookmark cache:', bookmarkCache.length, 'items');
    return { bookmarkCache, bookmarkDictionary };
  } catch (e) {
    console.debug('[VoiceMarkets] buildBookmarkDictionary failed:', e);
    return { bookmarkCache: [], bookmarkDictionary: [] };
  }
}

/**
 * Fetch recent history once at popup startup.
 * 90-day window, up to 5,000 items — covers typical browsing without
 * making the cache unwieldy.
 *
 * @returns {Promise<Array>}
 */
export async function buildHistoryCache() {
  try {
    const historyCache = await chrome.history.search({
      text: '',
      maxResults: 5000,
      startTime: Date.now() - 90 * 86_400_000,
    });
    console.debug('[VoiceMarkets] History cache:', historyCache.length, 'items');
    return historyCache;
  } catch (e) {
    console.debug('[VoiceMarkets] buildHistoryCache failed:', e);
    return [];
  }
}
