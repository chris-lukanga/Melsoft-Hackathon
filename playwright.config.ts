import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', fullyParallel: false, workers: 1,
  timeout: 120_000, expect: { timeout: 15_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `"${process.execPath}" tests/e2e-server.mjs`,
    url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 180_000,
  },
});
