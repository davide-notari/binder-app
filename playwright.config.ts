import { defineConfig, devices } from '@playwright/test';

// Own port, never reused: the tests must not attach to a dev server that Davide started with other cards.
const PORT = 5174;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // Test cards by default; CARDS_DIR=../binder-cards runs the same tests on the real cards (local only).
    env: { VITE_LOCAL_CARDS: process.env.CARDS_DIR ?? 'tests/fixtures/cards-repo' },
  },
});
