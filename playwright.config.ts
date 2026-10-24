import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  // Starts the app for you locally. In CI, point E2E_BASE_URL at a staging deploy instead.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run build && npm run start', url: baseURL, reuseExistingServer: true, timeout: 240_000 },
});
