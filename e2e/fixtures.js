/**
 * e2e/fixtures.js — Playwright テスト用フィクスチャ
 *
 * 拡張機能をロードした Chromium コンテキストと、
 * Chrome API をモック済みのポップアップページを提供する。
 */

import { test as base, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(__dirname, '..');

// ── モックデータ ───────────────────────────────────────────────────────────────

const NOW = Date.now();

const MOCK_BOOKMARK_TREE = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'ブックマークバー',
        children: [
          { id: '10', title: 'GitHub', url: 'https://github.com', dateAdded: NOW - 86_400_000 },
          { id: '11', title: 'Google Search', url: 'https://google.com', dateAdded: NOW - 172_800_000 },
          { id: '12', title: 'MDN Web Docs - JavaScript', url: 'https://developer.mozilla.org', dateAdded: NOW - 3_600_000 },
          { id: '13', title: 'Playwright テスト自動化', url: 'https://playwright.dev', dateAdded: NOW - 7_200_000 },
        ],
      },
    ],
  },
];

const MOCK_HISTORY = [
  { id: 'h1', title: 'GitHub - Where the world builds software', url: 'https://github.com', lastVisitTime: NOW - 1_000, visitCount: 50 },
  { id: 'h2', title: 'Google', url: 'https://google.com', lastVisitTime: NOW - 2_000, visitCount: 100 },
  { id: 'h3', title: 'MDN Web Docs', url: 'https://developer.mozilla.org', lastVisitTime: NOW - 5_000, visitCount: 30 },
  { id: 'h4', title: 'Playwright — Testing Library', url: 'https://playwright.dev/docs', lastVisitTime: NOW - 60_000, visitCount: 15 },
];

// ── フィクスチャ定義 ──────────────────────────────────────────────────────────

export const test = base.extend({
  /**
   * 拡張機能をロードした永続コンテキスト。
   * Chrome 拡張は headless モードで動作しないため headless: false を使用する。
   * CI では `xvfb-run npx playwright test` で実行すること。
   */
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  /**
   * バックグラウンドサービスワーカーの URL から拡張機能 ID を取得する。
   */
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];
    await use(extensionId);
  },

  /**
   * Chrome API をモックした状態でポップアップを開いたページ。
   *
   * addInitScript はページのスクリプトより前に実行されるため、
   * popup.js が chrome.bookmarks.getTree() を呼ぶ前にモックが差し込まれる。
   */
  popupPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();

    await page.addInitScript(
      ({ bookmarkTree, history }) => {
        if (typeof chrome === 'undefined') return;

        // ブックマーク / 履歴 API をテストデータで置き換え
        chrome.bookmarks.getTree = () => Promise.resolve(bookmarkTree);
        chrome.bookmarks.search = () => Promise.resolve([]);
        chrome.history.search = () => Promise.resolve(history);

        // セッションストレージ: テスト間の状態汚染を防ぐため常に空を返す
        chrome.storage.session.get = () => Promise.resolve({});
        chrome.storage.session.set = () => Promise.resolve();

        // タブ / ウィンドウ操作 (結果クリック時)
        chrome.tabs.query = () => Promise.resolve([]);
        chrome.tabs.create = () => Promise.resolve({ id: 999 });
        chrome.tabs.update = () => Promise.resolve({ id: 999 });
        chrome.windows.update = () => Promise.resolve({ id: 1 });

        // AI を無効化してキーワード検索フォールバックで動作させる
        try { delete globalThis.LanguageModel; } catch (_) { /* ignore */ }
        try { delete globalThis.Translator; } catch (_) { /* ignore */ }
      },
      { bookmarkTree: MOCK_BOOKMARK_TREE, history: MOCK_HISTORY },
    );

    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.waitForLoadState('domcontentloaded');
    // モック API は即座に解決するが、Promise チェーンの microtask が完了するまで待つ
    await page.waitForFunction(() => document.getElementById('micBtn') !== null);

    await use(page);
    await page.close();
  },
});

export const { expect } = test;
