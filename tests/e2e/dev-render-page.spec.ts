// Dev render page interactions used for the comparison on the iPhone: press and hold shows the reference frame
// (preloaded), a short tap hides or shows the panel.
import { expect, test } from '@playwright/test';

test('press and hold shows the reference frame, a tap toggles the panel', async ({ page }) => {
  await page.goto('/?dev=render&card=testcard&t=3.7333');
  await page.waitForFunction(() => document.documentElement.dataset.renderState === 'ready');
  const reference = page.locator('.dev-render-ref');
  // preloaded before any press
  await expect.poll(() => reference.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1080);
  await expect(reference).toBeHidden();

  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await expect(reference).toBeVisible();
  await expect(page.locator('.dev-render-badge')).toHaveText('RIFERIMENTO');
  await page.mouse.up();
  await expect(reference).toBeHidden();
  await expect(page.locator('.dev-render-panel')).toBeVisible(); // a hold does not toggle the panel

  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.dev-render-panel')).toBeHidden();
});
