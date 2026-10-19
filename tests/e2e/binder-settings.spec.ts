// Binder grid and settings (SPEC.md §5–6), on the mocked GitHub source (see github.spec.ts) where needed.
import { expect, test } from '@playwright/test';

test('binder: promo section first, numbers as printed, immersive badge on immersive cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Raccoglitore' })).toBeVisible();
  await expect(page.getByText('2 carte')).toBeVisible();
  await expect(page.locator('.binder-section h2')).toHaveText(['Promo', 'Carte']);
  await expect(page.locator('.binder-card .binder-number')).toHaveText(['10-05-2026', '1']);
  await expect(page.locator('[data-card="testcard"] .binder-badge.immersive')).toHaveCount(1);
  await expect(page.locator('[data-card="testcard-promo"] .binder-badge.immersive')).toHaveCount(0);
  await expect(page.locator('.binder-badge.cloud')).toHaveCount(0); // online: no cloud badges
});

test('card view: a swipe from the left edge goes back to the binder', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-card="testcard"]');
  await expect(page.locator('.card-view')).toBeVisible();
  await page.waitForTimeout(400); // the view has finished sliding in
  const height = page.viewportSize()!.height;
  await page.mouse.move(4, height / 2);
  await page.mouse.down();
  await page.mouse.move(80, height / 2 + 5, { steps: 5 });
  await page.mouse.move(160, height / 2 + 8, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.card-view')).toHaveCount(0);
});

async function drag(page: import('@playwright/test').Page, fromX: number, toX: number, y: number): Promise<void> {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, y + 3, { steps: 6 });
  await page.mouse.move(toX, y + 5, { steps: 6 });
  await page.mouse.up();
}

test('card view: swiping inside the card goes to the next / previous card, with a rubber band at the ends', async ({
  page,
}) => {
  await page.goto('/');
  await page.click('[data-card="testcard-promo"]'); // first card (promo section)
  await expect(page.locator('.card-view-name')).toHaveText('Promo di prova');
  await page.waitForTimeout(400); // the view has finished sliding in
  const { width, height } = page.viewportSize()!;

  await drag(page, width * 0.4, width * 0.95, height / 2); // to the right: there is no previous card
  await page.waitForTimeout(400);
  await expect(page.locator('.card-view-name')).toHaveText('Promo di prova');

  await drag(page, width * 0.8, width * 0.2, height / 2); // to the left: next card
  await expect(page.locator('.card-view-name')).toHaveText('Carta di prova');
  await expect(page.locator('.card-front')).toBeVisible(); // still in Carta mode

  await page.getByRole('button', { name: 'Artwork' }).click();
  await drag(page, width * 0.2, width * 0.8, height / 2); // back to the promo, keeping Artwork
  await expect(page.locator('.card-view-name')).toHaveText('Promo di prova');
  await expect(page.locator('.card-view')).toHaveAttribute('data-mode', 'artwork-flat');
});

test('card view: a short pull from the edge springs back', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-card="testcard"]');
  await page.waitForTimeout(400); // the view has finished sliding in
  const height = page.viewportSize()!.height;
  await page.mouse.move(4, height / 2);
  await page.mouse.down();
  await page.mouse.move(40, height / 2, { steps: 10 });
  await page.waitForTimeout(200); // slow: no fling
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page.locator('.card-view')).toHaveCount(1);
});

test('long names scroll to show all of them', async ({ page }) => {
  await page.route('**/dev-cards/index.json', async (route) => {
    const response = await route.fetch();
    const index = (await response.json()) as { cards: { name: string }[] };
    index.cards[1]!.name = 'Carta di prova con un nome davvero molto lungo';
    await route.fulfill({ response, json: index });
  });
  await page.goto('/');
  await expect(page.locator('[data-card="testcard"] .marquee.overflowing')).toHaveCount(1);
  await expect(page.locator('[data-card="testcard-promo"] .marquee.overflowing')).toHaveCount(0);
  await page.click('[data-card="testcard"]');
  await expect(page.locator('.card-view-title .marquee.overflowing')).toHaveCount(1);
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
  await expect(page.locator('.card-view')).toHaveCount(0);
});
