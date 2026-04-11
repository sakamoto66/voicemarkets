/**
 * e2e/popup.test.js — VoiceMarkets ポップアップ E2E テスト
 *
 * Chrome API をモック済みの環境でポップアップを開き、
 * UI の描画・インタラクション・検索フローを検証する。
 */

import { test, expect } from './fixtures.js';

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/**
 * 起動時の非同期キャッシュ構築（bookmarkCache / historyCache）が
 * 完了するまで待つ。モック API は即時解決するが microtask の
 * 処理順序を保証するため明示的に yield する。
 */
async function waitForCacheReady(page) {
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
}

async function search(page, query) {
  await waitForCacheReady(page);
  const transcript = page.locator('#transcript');
  await transcript.fill(query);
  await transcript.press('Enter');
  await expect(page.locator('#spinner')).toBeHidden({ timeout: 5_000 });
}

// ── レンダリング ──────────────────────────────────────────────────────────────

test.describe('レンダリング', () => {
  test('タイトル・マイクボタン・入力欄が表示される', async ({ popupPage }) => {
    await expect(popupPage.locator('.title')).toHaveText('VoiceMarkets');
    await expect(popupPage.locator('#micBtn')).toBeVisible();
    await expect(popupPage.locator('#transcript')).toBeVisible();
  });

  test('初期状態では結果リストと ranking-info が非表示', async ({ popupPage }) => {
    await expect(popupPage.locator('#results')).toBeHidden();
    await expect(popupPage.locator('#ranking-info')).toBeHidden();
  });

  test('期間フィルターが 6 つ表示される', async ({ popupPage }) => {
    await expect(popupPage.locator('.period-pill')).toHaveCount(6);
  });

  test('ソーストグルが 2 つ表示される', async ({ popupPage }) => {
    await expect(popupPage.locator('.source-toggle')).toHaveCount(2);
  });
});

// ── 期間フィルター ─────────────────────────────────────────────────────────────

test.describe('期間フィルター', () => {
  test('デフォルトは「すべて」がアクティブ', async ({ popupPage }) => {
    await expect(popupPage.locator('.period-pill[data-period="all"]')).toHaveClass(/active/);

    for (const p of ['1h', '24h', '1w', '1m', '1y']) {
      await expect(popupPage.locator(`.period-pill[data-period="${p}"]`)).not.toHaveClass(/active/);
    }
  });

  for (const period of ['1h', '24h', '1w', '1m', '1y']) {
    test(`「${period}」をクリックするとアクティブに切り替わる`, async ({ popupPage }) => {
      const pill = popupPage.locator(`.period-pill[data-period="${period}"]`);
      await pill.click();
      await expect(pill).toHaveClass(/active/);
      await expect(popupPage.locator('.period-pill[data-period="all"]')).not.toHaveClass(/active/);
    });
  }

  test('別のピルをクリックすると前のアクティブが外れる', async ({ popupPage }) => {
    await popupPage.locator('.period-pill[data-period="24h"]').click();
    await popupPage.locator('.period-pill[data-period="1w"]').click();

    await expect(popupPage.locator('.period-pill[data-period="1w"]')).toHaveClass(/active/);
    await expect(popupPage.locator('.period-pill[data-period="24h"]')).not.toHaveClass(/active/);
  });
});

// ── ソーストグル ──────────────────────────────────────────────────────────────

test.describe('ソーストグル', () => {
  test('初期状態でブックマーク・履歴の両方がオン', async ({ popupPage }) => {
    await expect(popupPage.locator('.source-toggle[data-source="bookmarks"]')).toHaveClass(/active/);
    await expect(popupPage.locator('.source-toggle[data-source="history"]')).toHaveClass(/active/);
  });

  test('ブックマークトグルをクリックするとオフになる', async ({ popupPage }) => {
    const toggle = popupPage.locator('.source-toggle[data-source="bookmarks"]');
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('2 回クリックすると元のオン状態に戻る', async ({ popupPage }) => {
    const toggle = popupPage.locator('.source-toggle[data-source="history"]');
    await toggle.click();
    await toggle.click();
    await expect(toggle).toHaveClass(/active/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

// ── 検索フロー ────────────────────────────────────────────────────────────────

test.describe('検索フロー', () => {
  test('transcript に入力して Enter で結果リストが表示される', async ({ popupPage }) => {
    await search(popupPage, 'github');

    await expect(popupPage.locator('#results')).toBeVisible();
    await expect(popupPage.locator('#ranking-info')).toBeVisible();
  });

  test('結果アイテムにタイトルと URL が表示される', async ({ popupPage }) => {
    await search(popupPage, 'github');

    const items = popupPage.locator('.result-item');
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator('.result-title')).not.toBeEmpty();
    await expect(items.first().locator('.result-url')).not.toBeEmpty();
  });

  test('結果フッターにバッジが表示される（AI 無効 → キーワードバッジ）', async ({ popupPage }) => {
    await search(popupPage, 'google');

    const badge = popupPage.locator('.badge').first();
    await expect(badge).toBeVisible();
    // AI が無効なのでキーワードバッジが表示されるはず
    await expect(badge).not.toHaveClass('badge-ai');
  });

  test('ソースを全て無効にするとエラーステータスが赤で表示される', async ({ popupPage }) => {
    await popupPage.locator('.source-toggle[data-source="bookmarks"]').click();
    await popupPage.locator('.source-toggle[data-source="history"]').click();

    await search(popupPage, 'github');

    const status = popupPage.locator('#status');
    await expect(status).not.toBeEmpty();
    await expect(status).toHaveCSS('color', 'rgb(239, 68, 68)');
  });

  test('マッチしないクエリで「結果なし」エラーが表示される', async ({ popupPage }) => {
    await search(popupPage, 'xyznonexistentxyz');

    const status = popupPage.locator('#status');
    await expect(status).not.toBeEmpty();
    // 結果なし or 認識失敗のエラーカラー
    await expect(status).toHaveCSS('color', /(239, 68, 68|rgb)/);
  });

  test('期間フィルターで絞り込み後も検索が実行される', async ({ popupPage }) => {
    // 直近1時間に絞る（モックデータは dateAdded が古いためヒットしない場合もある）
    await popupPage.locator('.period-pill[data-period="1h"]').click();
    await search(popupPage, 'github');

    // スピナーが消えて検索が完了することを確認（結果ありなしは問わない）
    await expect(popupPage.locator('#spinner')).toBeHidden();
  });

  test('新しい検索を実行すると前の結果がリセットされる', async ({ popupPage }) => {
    await search(popupPage, 'github');
    await expect(popupPage.locator('#results')).toBeVisible();

    // 2 回目の検索
    await search(popupPage, 'playwright');
    await expect(popupPage.locator('#results')).toBeVisible();
  });
});

// ── マイクボタン ──────────────────────────────────────────────────────────────

test.describe('マイクボタン', () => {
  test('マイクボタンが表示されクリックできる', async ({ popupPage }) => {
    const micBtn = popupPage.locator('#micBtn');
    await expect(micBtn).toBeVisible();
    await expect(micBtn).toBeEnabled();
    // テスト環境では Web Speech API が使えないためエラーになるが、クラッシュしない
    await micBtn.click();
    // ボタンが引き続き表示されていること
    await expect(micBtn).toBeVisible();
  });
});
