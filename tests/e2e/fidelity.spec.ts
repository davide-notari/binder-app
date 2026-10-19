// Fidelity test (RENDERING.md §8): renders every reference frame of every card that has references and compares
// it with the approved frame. Default: the synthetic test card. CARDS_DIR=../binder-cards runs it on the real
// cards: their frames are only read; comparison images go to test-results/ (git-ignored, wiped at every run).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  compareImages,
  FIDELITY_MAX_MEAN,
  FIDELITY_MAX_P99,
  heatmap,
  rgbaToRgb,
  sideBySide,
} from '../support/fidelity';
import '../support/dev-api';
import { decodePng, encodePng, type RgbImage } from '../support/png';

interface IndexJson {
  cards: { id: string; version: string }[];
}
interface RefsJson {
  card: string;
  version: string;
  resolution: [number, number];
  frames: { file: string; sourceFrame: number; trackTime: number }[];
}

const cardsDir = path.resolve(process.env.CARDS_DIR ?? 'tests/fixtures/cards-repo');
const saveAll = process.env.FIDELITY_SAVE === '1';
// FIDELITY_RES=half: report how half textures compare (informational, thresholds not enforced)
const resolution = process.env.FIDELITY_RES === 'half' ? 'half' : 'full';
const index = JSON.parse(readFileSync(path.join(cardsDir, 'index.json'), 'utf8')) as IndexJson;
const cardsWithRefs = index.cards.filter((c) => existsSync(path.join(cardsDir, 'refs', c.id, 'refs.json')));

test('at least one card has reference frames', () => {
  expect(cardsWithRefs.length).toBeGreaterThan(0);
});

for (const card of cardsWithRefs) {
  test(`fidelity ${card.id}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const refsDir = path.join(cardsDir, 'refs', card.id);
    const refs = JSON.parse(readFileSync(path.join(refsDir, 'refs.json'), 'utf8')) as RefsJson;
    expect(refs.version, 'reference frames belong to another export of this card').toBe(card.version);
    const [width, height] = refs.resolution;

    await page.goto(`/?dev=render&card=${card.id}&res=${resolution}&w=${width}&h=${height}&ui=0`);
    await page.waitForFunction(() => document.documentElement.dataset.renderState !== undefined, null, {
      timeout: 200_000,
    });
    expect(await page.evaluate(() => document.documentElement.dataset.renderState)).toBe('ready');
    const info = await page.evaluate(() => window.__binderDev?.info());
    console.log(`${card.id}: ${JSON.stringify(info)}`);

    for (const frame of refs.frames) {
      const base64 = await page.evaluate((t) => {
        const dev = window.__binderDev;
        if (!dev) throw new Error('dev API missing');
        dev.renderAt(t);
        return dev.readPixelsBase64();
      }, frame.trackTime);
      const rendered: RgbImage = { width, height, data: rgbaToRgb(Buffer.from(base64, 'base64')) };
      const reference = decodePng(readFileSync(path.join(refsDir, frame.file)));
      const m = compareImages(rendered, reference);
      const line = `frame ${String(frame.sourceFrame).padStart(4)} (t=${frame.trackTime.toFixed(3)}s): mean ${m.mean.toFixed(3)}  p99 ${m.p99.toFixed(1)}  max ${m.max}`;
      console.log(`${card.id} ${line}`);
      testInfo.annotations.push({ type: 'fidelity', description: `${card.id} ${line}` });
      const ok = m.mean <= FIDELITY_MAX_MEAN && m.p99 <= FIDELITY_MAX_P99;
      if (!ok || saveAll) {
        const file = testInfo.outputPath(`${card.id}-f${String(frame.sourceFrame).padStart(4, '0')}.png`);
        writeFileSync(file, encodePng(sideBySide([rendered, reference, heatmap(rendered, reference)])));
        console.log(`  saved ${path.relative(process.cwd(), file)}`);
      }
      if (resolution === 'half') continue;
      expect
        .soft(m.mean, `${card.id} frame ${frame.sourceFrame}: mean abs diff`)
        .toBeLessThanOrEqual(FIDELITY_MAX_MEAN);
      expect.soft(m.p99, `${card.id} frame ${frame.sourceFrame}: p99`).toBeLessThanOrEqual(FIDELITY_MAX_P99);
    }
  });
}
