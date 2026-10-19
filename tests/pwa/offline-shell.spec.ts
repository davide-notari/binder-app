// SPEC.md §7: the service worker precaches the app shell, so the installed app opens without network.
// The test serves the build itself and then stops the server: only the service worker can answer the reload.
// It runs in Chromium: Playwright's WebKit registers the service worker but never lets it control the page
// (checked in M3), so the real offline check on iOS is done on the iPhone (airplane mode).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, devices, expect, test } from '@playwright/test';

const PORT = 4175;
const BASE = `http://localhost:${PORT}/binder-app/`;

/** Is the preview server answering? (bounded: a request never hangs the test) */
async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(BASE, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function startPreview(): Promise<ChildProcess> {
  if (await serverUp()) throw new Error(`port ${PORT} is already in use (a preview server left over?)`);
  // vite itself, not through npx: killing npx can leave the real server running
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    {
      stdio: 'ignore',
    },
  );
  for (let i = 0; i < 100; i++) {
    if (await serverUp()) return server;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill();
  throw new Error('vite preview did not start');
}

test('the app shell opens without the server after the first visit; the manifest is valid', async () => {
  const server = await startPreview();
  const dir = mkdtempSync(path.join(tmpdir(), 'binder-pwa-'));
  const { defaultBrowserType: _browser, ...device } = devices['Pixel 7'];
  const context = await chromium.launchPersistentContext(dir, { ...device, baseURL: BASE });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('./?browser=1');
    await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
      undefined,
      { timeout: 15_000 },
    );
    const manifest = (await (await page.request.get('manifest.webmanifest')).json()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: 'Raccoglitore',
      display: 'standalone',
      start_url: '/binder-app/',
      scope: '/binder-app/',
    });

    await page.reload(); // the first load is not controlled yet; from now on the service worker answers
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });

    server.kill();
    await expect.poll(serverUp, { message: 'preview server stopped', timeout: 10_000 }).toBe(false);
    // a short retry: Chromium can refuse a navigation in the instant the server goes away; a missing precache or
    // navigation route fails every attempt
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 8000 });
    // another URL inside the scope: navigation fallback to the precached index.html (the session remembers
    // ?browser=1, so the key screen shows again)
    await page.goto('./?another=1');
    await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  } finally {
    server.kill();
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
