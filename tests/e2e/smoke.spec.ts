import { expect, test } from '@playwright/test';

test('placeholder page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Raccoglitore');
  await expect(page.getByRole('heading', { name: 'Raccoglitore' })).toBeVisible();
  await expect(page.getByText(/^Versione \d+\.\d+\.\d+\+\w+$/)).toBeVisible();
});

test('dev server serves the local card repository', async ({ page, request }) => {
  const response = await request.get('/dev-cards/index.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  const index = (await response.json()) as { schema: number; cards: unknown[] };
  expect(index.schema).toBe(1);
  expect(index.cards.length).toBeGreaterThan(0);

  await page.goto('/');
  await expect(page.getByTestId('dev-cards-status')).toHaveText(/^Sorgente locale: \d+ cart[ae]$/);
});

test('dev server refuses paths outside the card repository', async ({ request }) => {
  // The HTTP client normalises "%2e%2e" segments before sending; an encoded slash reaches the middleware intact.
  for (const url of ['/dev-cards/cards/..%2f..%2fpackage.json', '/dev-cards/.git/config', '/dev-cards/missing.json']) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(404);
  }
});

// Early check for M1: the renderer and the fidelity tests need WebGL2 in Playwright's WebKit.
test('WebGL2 is available in WebKit', async ({ page }) => {
  await page.goto('/');
  const info = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    return {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      maxAnisotropy: aniso ? (gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0,
      renderer: gl.getParameter(gl.RENDERER) as string,
    };
  });
  expect(info, 'webgl2 context').not.toBeNull();
  test.info().annotations.push({ type: 'webgl2', description: JSON.stringify(info) });
  console.log('WebGL2 in WebKit:', JSON.stringify(info));
  expect(info?.maxTextureSize).toBeGreaterThanOrEqual(4096);
});
