// Card view (SPEC.md §6, RENDERING.md §5): modes, 3D tilt without jumps, immersive flight back to home,
// repeated opening of cards on the shared WebGL context.
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __binderCard?: {
      mode(): string;
      ready(): boolean;
      feedOrientation(beta: number, gamma: number): void;
      renderBase64(): string;
    };
  }
}

const pixels = (page: Page) => page.evaluate(() => window.__binderCard!.renderBase64());
const mode = (page: Page) => page.evaluate(() => window.__binderCard!.mode());

async function openArtwork(page: Page, cardId: string): Promise<void> {
  await page.click(`[data-card="${cardId}"]`);
  await expect(page.locator('.card-view')).toHaveAttribute('data-mode', 'card');
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
}

test('3D on and off returns exactly to the flat view; tilting moves the scene', async ({ page }) => {
  await page.goto('/');
  await openArtwork(page, 'testcard');
  expect(await mode(page)).toBe('artwork-flat');
  const flat = await pixels(page);

  await page.getByRole('button', { name: '3D' }).click();
  await expect.poll(() => mode(page)).toBe('artwork-tilt');
  await page.evaluate(() => {
    window.__binderCard!.feedOrientation(45, 0); // neutral reference
  });
  await page.waitForTimeout(500); // transition 0.35 s
  // phone held still: the test card needs no tilt zoom, so the tilt camera at rest is the home camera
  expect((await pixels(page)) === flat, 'resting tilt view differs from the flat view').toBe(true);

  await page.evaluate(() => {
    window.__binderCard!.feedOrientation(45, 20);
  });
  await page.waitForTimeout(400);
  expect((await pixels(page)) === flat, 'tilting did not move the scene').toBe(false);

  await page.getByRole('button', { name: '3D' }).click();
  await expect.poll(() => mode(page)).toBe('artwork-flat');
  await page.waitForTimeout(500);
  expect((await pixels(page)) === flat, 'after 3D off the view did not return to the flat view').toBe(true);
});

test('long press plays the immersive flight and ends at home', async ({ page }) => {
  await page.goto('/?speed=10'); // 15 s track in 1.5 s
  await openArtwork(page, 'testcard');
  const flat = await pixels(page);
  await expect(page.getByText('Tieni premuto')).toBeVisible();

  const box = (await page.locator('.artwork-frame').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => mode(page), { timeout: 2000 }).toBe('immersive');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Carta' })).toBeDisabled();
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('artwork-flat');
  expect((await pixels(page)) === flat, 'the flight did not end exactly at home').toBe(true);
});

test('the card mode shows the front image, or the artwork when the card has none', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-card="testcard"]');
  await expect(page.locator('.card-front')).toHaveAttribute('alt', 'Carta di prova');
  await page.getByRole('button', { name: /Indietro/ }).click();
  await page.click('[data-card="testcard-promo"]');
  await expect(page.locator('.card-front')).toBeVisible();
  await page.getByRole('button', { name: 'Artwork' }).click();
  await expect(page.locator('.card-view')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await expect(page.getByText('Tieni premuto')).toHaveCount(0); // tilt-only card: no immersive hint
});

test('opening cards repeatedly keeps working on the shared WebGL context', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  for (let i = 0; i < 6; i++) {
    await openArtwork(page, i % 2 === 0 ? 'testcard' : 'testcard-promo');
    await page.getByRole('button', { name: /Indietro/ }).click();
    await expect(page.locator('.card-list')).toBeVisible();
  }
  const contexts = await page.evaluate(() => document.querySelectorAll('canvas').length);
  expect(contexts).toBe(0); // the shared canvas is detached when no card is open
  expect(errors).toEqual([]);
});
