import { expect, type Page } from '@playwright/test';

/** Expansion of the fixture that holds testcard and testcard-promo. */
export const TEST_SET = 'espansione-prova';

/** From the collection, opens the binder of an expansion and waits until it has slid in. */
export async function openSet(page: Page, setId = TEST_SET): Promise<void> {
  await page.click(`[data-set="${setId}"]`);
  await expect(page.locator('.binder')).toBeVisible();
  await page.waitForTimeout(350);
}
