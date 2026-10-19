// RENDERING.md §1: iOS drops the WebGL context when the app goes to the background. After the context is
// restored the card must be reloaded and render exactly as before.
import { expect, test } from '@playwright/test';
import '../support/dev-api';

test('the card renders identically after a context loss', async ({ page }) => {
  await page.goto('/?dev=render&card=testcard&res=full&w=540&h=742&ui=0');
  await page.waitForFunction(() => document.documentElement.dataset.renderState === 'ready');
  const render = () =>
    page.evaluate(() => {
      const dev = window.__binderDev!;
      dev.renderAt(3.7333);
      return dev.readPixelsBase64();
    });
  const before = await render();

  await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    setTimeout(() => {
      ext.restoreContext();
    }, 100);
  });
  await page.waitForFunction(() => document.documentElement.dataset.renderState === 'lost');
  await page.waitForFunction(() => document.documentElement.dataset.renderState === 'ready');
  const after = await render();
  expect(after.length).toBe(before.length);
  expect(after === before, 'pixels differ after context restore').toBe(true);
});
