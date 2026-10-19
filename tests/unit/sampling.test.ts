import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCard } from '../../src/data/card-format';
import { poseAtTime } from '../../src/render/camera';
import { halfIsEnough } from '../../src/render/resolution';
import { mirrorMargin, pyramidLevels, referenceLevel } from '../../src/render/sampling';

const card = parseCard(JSON.parse(readFileSync('tests/fixtures/cards-repo/cards/testcard.card/card.json', 'utf8')));

// Expected values computed with the exact code of binder-cards/tools/verify_card.py (OpenCV), M1.
const PYRAMID = [
  { id: 'sfondo', margin: [475, 605], levels: 4 },
  { id: 'acqua', margin: [475, 0], levels: 3 },
  { id: 'goccia', margin: [0, 0], levels: 1 },
  { id: 'rami', margin: [0, 0], levels: 3 },
  { id: 'celebi', margin: [0, 0], levels: 2 },
  { id: 'bolle', margin: [0, 0], levels: 3 },
];
const CASES = [
  { t: 0, size: [1080, 1484], levels: [0, 0, 0, 0, 0, 0] },
  { t: 0, size: [540, 742], levels: [1, 1, 0, 1, 1, 1] },
  { t: 0, size: [270, 371], levels: [2, 2, 0, 2, 1, 2] },
  { t: 0, size: [135, 186], levels: [3, 2, 0, 2, 1, 2] },
  { t: 3.7333, size: [270, 371], levels: [2, 2, 0, 1, 1, 1] },
  { t: 7.5, size: [400, 550], levels: [1, 1, 0, 0, 0, 0] },
  { t: 11.2333, size: [200, 275], levels: [2, 2, 0, 1, 1, 1] },
  { t: 5.0, size: [1080, 1484], levels: [0, 0, 0, 0, 0, 0] },
];

describe('reference pyramid', () => {
  it('mirror margins and level counts match verify_card.py', () => {
    card.layers.forEach((layer, i) => {
      const expected = PYRAMID[i]!;
      expect(layer.id).toBe(expected.id);
      expect(mirrorMargin(layer, layer.size.full)).toEqual(expected.margin);
      expect(pyramidLevels(layer, layer.size.full)).toBe(expected.levels);
    });
  });

  it.each(CASES)('level choice at t=$t, $size matches verify_card.py', ({ t, size, levels }) => {
    const screen = {
      pose: poseAtTime(card.immersive!, t),
      fovy: card.camera.vfovRad,
      widthPx: size[0]!,
      heightPx: size[1]!,
    };
    expect(card.layers.map((layer) => referenceLevel(layer, layer.size.full, screen))).toEqual(levels);
  });
});

describe('halfIsEnough (CARD_FORMAT §5)', () => {
  it('uses 0.95 for tilt and minVisibleFraction for immersive', () => {
    // testcard: artPx height 1600, minVisibleFraction 0.427
    expect(halfIsEnough(card, 760, 'tilt')).toBe(true); // 0.95 · 800 = 760
    expect(halfIsEnough(card, 761, 'tilt')).toBe(false);
    expect(halfIsEnough(card, 341, 'immersive')).toBe(true); // 0.427 · 800 = 341.6
    expect(halfIsEnough(card, 342, 'immersive')).toBe(false);
  });
});
