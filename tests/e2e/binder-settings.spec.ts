// Binder grid and settings (SPEC.md §5–6), on the mocked GitHub source (see github.spec.ts) where needed.
import { expect, test } from '@playwright/test';

test('binder: promo section first, numbers as printed, flight badge on immersive cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Raccoglitore' })).toBeVisible();
  await expect(page.getByText('2 carte')).toBeVisible();
  await expect(page.locator('.binder-section h2')).toHaveText(['Promo', 'Carte']);
  await expect(page.locator('.binder-card .binder-number')).toHaveText(['10-05-2026', '1']);
  await expect(page.locator('[data-card="testcard"] .binder-badge.flight')).toHaveCount(1);
  await expect(page.locator('[data-card="testcard-promo"] .binder-badge.flight')).toHaveCount(0);
  await expect(page.locator('.binder-badge.cloud')).toHaveCount(0); // online: no cloud badges
});

test('card view: a swipe from the left edge goes back to the binder', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-card="testcard"]');
  await expect(page.locator('.card-view')).toBeVisible();
  const height = page.viewportSize()!.height;
  await page.mouse.move(4, height / 2);
  await page.mouse.down();
  await page.mouse.move(80, height / 2 + 5, { steps: 5 });
  await page.mouse.move(160, height / 2 + 8, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.binder')).toBeVisible();
});

test('settings: 3D space, clear, limit, download all, debug switch', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  // open the 3D of one card, so there is something in the cache
  await page.click('[data-card="testcard"]');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.getByRole('button', { name: /Indietro/ }).click();

  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await expect(page.getByTestId('layer-bytes')).not.toHaveText('0 MB');
  await expect(page.getByTestId('layer-bytes')).not.toHaveText('…');

  await page.getByRole('button', { name: 'Svuota cache 3D' }).click();
  await expect(page.getByText('Cache 3D svuotata.')).toBeVisible();
  await expect(page.getByTestId('layer-bytes')).toHaveText('0 MB');

  await page.getByRole('button', { name: '250 MB' }).click();
  await expect(page.getByRole('button', { name: '250 MB' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Scarica tutto per l’uso offline/ }).click();
  await expect(page.getByText('Il 3D di tutte le carte è sul telefono.')).toBeVisible({ timeout: 30_000 });
  const layers = await page.evaluate(
    async () => (await (await caches.open('binder-cards-v1')).keys()).filter((r) => r.url.includes('/layers/')).length,
  );
  expect(layers).toBe(12); // 6 layers × 2 cards

  await expect(page.locator('.debug-chip')).toHaveCount(0);
  await page.getByText('Pannello di debug').click();
  await expect(page.locator('.debug-chip')).toBeVisible();
  await page.getByText('Pannello di debug').click();
  await expect(page.locator('.debug-chip')).toHaveCount(0);

  await page.getByRole('button', { name: /Indietro/ }).click();
  await expect(page.locator('.binder')).toBeVisible();
});
