// GitHub source, key screen and card cache (SPEC.md §4–5), against a mock of api.github.com that serves the
// fixture repository: ETag / 304, wrong or revoked keys, no network, re-exported cards, LRU eviction.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, devices, expect, webkit, type Page } from '@playwright/test';
import { openSet } from './helpers';

// Playwright's default (ephemeral) WebKit contexts lose the Cache API on reload, unlike Safari on the iPhone:
// these tests run in a persistent profile so that "reopen the app" behaves like the real device.
const test = base.extend<{ page: Page }>({
  page: async ({ baseURL }, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'binder-test-'));
    const { defaultBrowserType: _browser, ...device } = devices['iPhone 15'];
    const context = await webkit.launchPersistentContext(dir, { ...device, ...(baseURL ? { baseURL } : {}) });
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

const FIXTURES = 'tests/fixtures/cards-repo';
const TOKEN = 'github_pat_test_0123456789';

interface MockState {
  revoked: boolean;
  offline: boolean;
  noAccess: boolean;
  overrides: Map<string, Buffer>;
  requests: { path: string; ifNoneMatch: string | undefined; status: number }[];
}

function newState(): MockState {
  return { revoked: false, offline: false, noAccess: false, overrides: new Map(), requests: [] };
}

async function mockGitHub(page: Page, state: MockState): Promise<void> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, accept, x-github-api-version, if-none-match',
    'access-control-allow-methods': 'GET',
    'access-control-expose-headers': 'ETag',
  };
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    if (state.offline) return route.abort('internetdisconnected');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const match = /^\/repos\/davide-notari\/binder-cards\/contents\/(.+)$/.exec(url.pathname);
    const file = match ? decodeURIComponent(match[1]!) : '';
    const record = (status: number) => {
      state.requests.push({ path: file, ifNoneMatch: request.headers()['if-none-match'], status });
    };
    if (request.headers().authorization !== `Bearer ${TOKEN}` || state.revoked) {
      record(401);
      return route.fulfill({ status: 401, headers: cors, body: '{"message":"Bad credentials"}' });
    }
    // "testcard-ter" (added by a test) is served with the files of testcard
    const local = path.join(FIXTURES, file.replace(/^cards\/testcard-ter\.card\//, 'cards/testcard.card/'));
    const body = state.overrides.get(file) ?? (existsSync(local) ? readFileSync(local) : null);
    if (!match || url.searchParams.get('ref') !== 'main' || state.noAccess || !body) {
      record(404);
      return route.fulfill({ status: 404, headers: cors, body: '{"message":"Not Found"}' });
    }
    // Playwright cannot fulfil a 304, so the mock always answers 200; the conditional request itself is checked
    // here (If-None-Match) and the 304 handling in tests/unit/github-source.test.ts.
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    record(200);
    return route.fulfill({
      status: 200,
      headers: { ...cors, etag, 'content-type': 'application/vnd.github.raw+json' },
      body,
    });
  });
}

const APP = '/?source=github&browser=1';

async function enterKey(page: Page, key: string): Promise<void> {
  await page.getByLabel('Chiave').fill(key);
  await page.getByRole('button', { name: 'Continua' }).click();
}

/** Cache API keys of the card cache, as "<id>/<version>/<file>". */
function cachedFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const cache = await caches.open('binder-cards-v1');
    return (await cache.keys()).map((r) => r.url.split('/__cards/')[1] ?? r.url).sort();
  });
}

/** Base files of the fixture: 3 cards (the promo card has no front image) + cover and 2 symbols. */
const BASE_FILES = 4 + 3 + 4 + 3;

async function onboard(page: Page): Promise<void> {
  await page.goto(APP);
  await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  await enterKey(page, TOKEN);
  await expect(page.locator('.collection-tile')).toHaveCount(2);
  await expect.poll(() => cachedFiles(page).then((f) => f.length), { message: 'base files' }).toBe(BASE_FILES);
  await openSet(page);
}

test('key screen: wrong key, then the right one; next start uses the cache and a conditional request', async ({
  page,
}) => {
  const state = newState();
  await mockGitHub(page, state);
  const authorizedHosts = new Set<string>();
  page.on('request', (r) => {
    if (r.headers().authorization) authorizedHosts.add(new URL(r.url()).host);
  });

  await page.goto(APP);
  await enterKey(page, 'github_pat_wrong');
  await expect(page.getByRole('alert')).toHaveText('Chiave non valida. Controlla di averla copiata tutta.');
  await enterKey(page, TOKEN);
  await expect(page.locator('.collection-tile')).toHaveCount(2);
  await expect.poll(() => cachedFiles(page).then((f) => f.length)).toBe(BASE_FILES);

  const indexEtag = `"${createHash('sha1')
    .update(readFileSync(path.join(FIXTURES, 'index.json')))
    .digest('hex')}"`;
  state.requests = [];
  await page.reload();
  await expect(page.locator('.collection-cover img')).toHaveCount(1); // the cover, from the cache
  await openSet(page);
  await expect(page.locator('.binder-thumb img')).toHaveCount(2);
  await expect.poll(() => state.requests.find((r) => r.path === 'index.json')?.ifNoneMatch).toBe(indexEtag);
  expect(state.requests.filter((r) => r.path !== 'index.json').map((r) => r.path)).toEqual([]); // all from the cache

  expect([...authorizedHosts]).toEqual(['api.github.com']);
  const inLocalStorage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(inLocalStorage).not.toContain(TOKEN);
});

test('a re-exported card replaces its cached files; new cards are announced', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  const index = JSON.parse(readFileSync(path.join(FIXTURES, 'index.json'), 'utf8')) as {
    cards: { id: string; version: string; path: string }[];
  };
  const testcard = index.cards.find((c) => c.id === 'testcard')!;
  expect((await cachedFiles(page)).filter((f) => f.startsWith(`testcard/${testcard.version}/`))).toHaveLength(4);
  testcard.version = 'aaaaaaaaaaaa';
  index.cards.push({ ...testcard, id: 'testcard-ter', path: 'cards/testcard-ter.card', version: 'bbbbbbbbbbbb' });
  state.overrides.set('index.json', Buffer.from(JSON.stringify(index)));

  await page.reload();
  await expect(page.getByText('1 carta nuova')).toBeVisible();
  await expect(page.locator('[data-set="espansione-prova"] .collection-new')).toHaveText(' · 1 nuova');
  await openSet(page);
  await expect(page.locator('.binder-card')).toHaveCount(3);
  await expect
    .poll(async () => (await cachedFiles(page)).filter((f) => f.startsWith('testcard/')).sort())
    .toEqual([
      'testcard/aaaaaaaaaaaa/artwork.webp',
      'testcard/aaaaaaaaaaaa/card.json',
      'testcard/aaaaaaaaaaaa/front.webp',
      'testcard/aaaaaaaaaaaa/thumb.webp',
    ]);
});

test('offline: the binder and cached cards still work; uncached 3D asks for the connection', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  await page.click('[data-card="testcard"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.getByRole('button', { name: /Indietro/ }).click();

  state.offline = true;
  await page.reload();
  await expect(page.getByText('Sei offline: vedi le carte salvate su questo iPhone.')).toBeVisible();
  await expect(page.locator('.collection-cover img')).toHaveCount(1); // cover from the cache
  await openSet(page);
  await expect(page.locator('.binder-thumb img')).toHaveCount(2); // thumbnails from the cache

  await page.click('[data-card="testcard"]');
  await expect(page.locator('.card-front')).toBeVisible();
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.getByRole('button', { name: /Indietro/ }).click();

  await page.click('[data-card="testcard-promo"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.getByText('Serve la connessione per scaricare il 3D.')).toBeVisible();
  await expect(page.locator('.artwork-flat')).toBeVisible(); // the flat artwork is there anyway
});

test('offline: a cloud badge marks the cards whose 3D is not on the phone', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  await page.click('[data-card="testcard"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.getByRole('button', { name: /Indietro/ }).click();
  await expect(page.locator('.binder-badge.cloud')).toHaveCount(0);

  state.offline = true;
  await page.reload();
  await expect(page.getByText('Sei offline: vedi le carte salvate su questo iPhone.')).toBeVisible();
  await openSet(page);
  await expect(page.locator('[data-card="testcard-promo"] .binder-badge.cloud')).toHaveCount(1);
  await expect(page.locator('[data-card="testcard"] .binder-badge.cloud')).toHaveCount(0);
});

test('settings: replace the key (or cancel), remove the key', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  page.on('dialog', (dialog) => void dialog.accept());
  await onboard(page);
  await page.getByRole('button', { name: 'Impostazioni' }).click();

  await page.getByRole('button', { name: 'Sostituisci chiave' }).click();
  await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  await page.getByRole('button', { name: 'Annulla' }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();

  await page.getByRole('button', { name: 'Sostituisci chiave' }).click();
  await enterKey(page, TOKEN);
  await expect(page.locator('.collection-tile')).toHaveCount(2);

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Rimuovi chiave' }).click();
  await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible(); // really removed
});

test('a revoked key brings back the key screen', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  state.revoked = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chiave di accesso' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('La chiave non è più valida: inseriscine una nuova.');
});

test('a key without access to the repository is refused', async ({ page }) => {
  const state = newState();
  state.noAccess = true;
  await mockGitHub(page, state);
  await page.goto(APP);
  await enterKey(page, TOKEN);
  await expect(page.getByRole('alert')).toHaveText('Questa chiave non dà accesso alle carte.');
});

test('the 3D layer cache evicts the least recently opened card beyond its limit', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  // a 1-byte limit: only the card being opened keeps its layers
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('binder');
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          tx.objectStore('settings').put(1, 'layerCacheLimit');
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error(String(tx.error)));
          };
        };
      }),
  );
  const layersOf = async (id: string) =>
    (await cachedFiles(page)).filter((f) => f.startsWith(`${id}/`) && f.includes('/layers/'));

  for (const id of ['testcard', 'testcard-promo']) {
    await page.click(`[data-card="${id}"]`);
    await page.getByRole('button', { name: 'Artwork' }).click();
    await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
    await page.getByRole('button', { name: /Indietro/ }).click();
  }
  expect(await layersOf('testcard')).toEqual([]);
  expect(await layersOf('testcard-promo')).toHaveLength(6);
});

test('storage full: the 3D of other cards is freed, then the card is shown without being kept', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await onboard(page);
  await page.click('[data-card="testcard"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.getByRole('button', { name: /Indietro/ }).click();
  await expect(page.locator('.card-view')).toHaveCount(0);

  // from now on every new file is refused, as on a full phone
  await page.evaluate(() => {
    Cache.prototype.put = () => Promise.reject(new DOMException('full', 'QuotaExceededError'));
  });
  await page.click('[data-card="testcard-promo"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 }); // still works
  const layers = (await cachedFiles(page)).filter((f) => f.includes('/layers/'));
  expect(layers).toEqual([]); // the other card's 3D was freed to make room
  await page.getByRole('button', { name: /Indietro/ }).click();
  await expect(page.getByText(/Lo spazio sull’iPhone è quasi finito/)).toBeVisible();
});

test('outside the Home Screen app the installation guide is shown', async ({ page }) => {
  const state = newState();
  await mockGitHub(page, state);
  await page.goto('/?source=github');
  await expect(page.getByRole('heading', { name: 'Installa il Raccoglitore' })).toBeVisible();
  expect(state.requests).toEqual([]);
});
