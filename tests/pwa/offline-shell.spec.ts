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

async function startPreview(): Promise<ChildProcess> {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return server;
    } catch {
      // not up yet
    }
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
    );
    const manifest = (await (await page.request.get('manifest.webmanifest')).json()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: 'Raccoglitore',
      display: 'standalone',
      start_url: '/binder-app/',
      scope: '/binder-app/',
    });

    server.kill();
    await expect
      .poll(() =>
        fetch(BASE).then(
          () => 'up',
          () => 'down',
        ),
      )
      .toBe('down');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  } finally {
    server.kill();
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
