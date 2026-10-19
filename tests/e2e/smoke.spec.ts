import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const cardsDir = path.resolve(process.env.CARDS_DIR ?? 'tests/fixtures/cards-repo');
const index = JSON.parse(readFileSync(path.join(cardsDir, 'index.json'), 'utf8')) as { sets?: unknown[] };

test('development home shows the collection of the local cards', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Raccoglitore');
  await expect(page.getByRole('heading', { name: 'Raccoglitore' })).toBeVisible();
  await expect(page.locator('.collection-tile')).toHaveCount(index.sets?.length ?? 1);
});

test('dev server serves the local card repository', async ({ request }) => {
  const response = await request.get('/dev-cards/index.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  const json = (await response.json()) as { schema: number; cards: unknown[] };
  expect([1, 2]).toContain(json.schema);
  expect(json.cards.length).toBeGreaterThan(0);
});

test('dev server refuses paths outside the card repository', async ({ request }) => {
  // The HTTP client normalises "%2e%2e" segments before sending; an encoded slash reaches the middleware intact.
  for (const url of ['/dev-cards/cards/..%2f..%2fpackage.json', '/dev-cards/.git/config', '/dev-cards/missing.json']) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(404);
  }
});

// The renderer and the fidelity tests need WebGL2 in Playwright's WebKit.
test('WebGL2 is available in WebKit', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    return {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      renderer: gl.getParameter(gl.RENDERER) as string,
    };
  });
  expect(info, 'webgl2 context').not.toBeNull();
  expect(info?.maxTextureSize).toBeGreaterThanOrEqual(4096);
});
