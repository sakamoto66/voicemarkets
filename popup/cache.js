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

