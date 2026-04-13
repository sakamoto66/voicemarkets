/**
 * render.js — DOM rendering helpers for VoiceMarkets popup.
 * Pure DOM functions; no Chrome API or global state dependencies.
 */

import { t } from './i18n.js';

/** Remove all child nodes without using innerHTML. */
export function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * @param {HTMLElement} statusEl
 * @param {string} text
 * @param {boolean} isError
 */
export function setStatus(statusEl, text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#ef4444' : '';
}

/** @param {'bookmark'|'history'} source */
export function createSourceIcon(source) {
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

/**
 * @param {HTMLElement} resultsList
 * @param {HTMLElement} rankingInfo
 * @param {Array} items
 * @param {boolean} usedAI
 * @param {boolean} corrected
 */
export function renderResults(resultsList, rankingInfo, items, usedAI = false, corrected = false) {
  clearChildren(resultsList);
  clearChildren(rankingInfo);

  rankingInfo.appendChild(document.createTextNode(t('result_count', String(items.length))));
  const badge = document.createElement('span');
  badge.className = usedAI ? 'badge badge-ai' : 'badge badge-keyword';
  badge.textContent = usedAI ? 'AI' : t('badge_keyword');
  rankingInfo.appendChild(badge);
  if (corrected) {
    const correctedBadge = document.createElement('span');
    correctedBadge.className = 'badge badge-corrected';
    correctedBadge.textContent = t('badge_corrected');
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

    const openItem = async () => {
      try {
        // Switch to an existing tab if the URL is already open
        const allTabs = await chrome.tabs.query({});
        const existingTab = allTabs.find(tab => tab.url === item.url);
        if (existingTab) {
          await chrome.tabs.update(existingTab.id, { active: true });
          await chrome.windows.update(existingTab.windowId, { focused: true });
          return;
        }

        // Reuse the current tab if it is a new-tab page
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && (activeTab.url === 'chrome://newtab/' || activeTab.url === 'about:newtab')) {
          await chrome.tabs.update(activeTab.id, { url: item.url });
          return;
        }

        // Otherwise open in a new tab
        await chrome.tabs.create({ url: item.url });
      } catch (e) {
        console.debug('[VoiceMarkets] openItem failed:', e);
      }
    };
    a.addEventListener('click', (e) => { e.preventDefault(); openItem(); });
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); }
    });

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

/**
 * @param {HTMLElement} resultsList
 * @param {HTMLElement} rankingInfo
 * @param {HTMLElement} transcriptEl
 */
export function hideResults(resultsList, rankingInfo, transcriptEl) {
  resultsList.classList.add('hidden');
  rankingInfo.classList.add('hidden');
  transcriptEl.classList.remove('low-confidence');
  clearChildren(resultsList);
  clearChildren(rankingInfo);
}
