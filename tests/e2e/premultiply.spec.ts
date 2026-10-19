// RENDERING.md §2: semi-transparent texels uploaded through the renderer's texture path must read back as the
// exact premultiplied values round(c · a / 255). The same page (/?dev=premultiply) is checked on the iPhone.
import { expect, test } from '@playwright/test';

interface PremultiplyResult {
  texels: number;
  mismatches: number;
  maxError: number;
  examples: [number, number[], number[]][];
  error?: string;
}

test('premultiplied upload is exact', async ({ page }) => {
  await page.goto('/?dev=premultiply');
  const handle = await page.waitForFunction(() => document.documentElement.dataset.premultiplyResult);
  const result = JSON.parse((await handle.jsonValue()) ?? '{}') as PremultiplyResult;
  console.log(`premultiply: ${JSON.stringify(result)}`);
  expect(result.error).toBeUndefined();
  expect(result.texels).toBe(256);
  expect(result.mismatches, JSON.stringify(result.examples)).toBe(0);
});
