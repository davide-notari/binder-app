import { defineConfig } from '@playwright/test';

// The production build: service worker, manifest, offline app shell. Run with `npm run test:pwa` (it builds
// first); the test starts and stops its own `vite preview` server.
export default defineConfig({
  testDir: 'tests/pwa',
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 60_000,
});
