import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 拡張機能コンテキストは順番に作成する
  retries: 1,
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/reports', open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
