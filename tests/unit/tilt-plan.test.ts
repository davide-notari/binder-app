import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '../../src/data/card-format';
import { homePose, tiltPose, viewMatrix, zoomedFovy } from '../../src/render/camera';
import { finestLevels } from '../../src/render/level-plan';
import { multiply, perspective, transform } from '../../src/render/math';
import { keptBytes, levelBytes, planTextures } from '../../src/render/memory';
import { referenceLevel } from '../../src/render/sampling';
import { fitTilt, MAX_TILT_ZOOM } from '../../src/render/tilt-fit';

function loadCard(dir: string, id: string): Card {
  return parseCard(JSON.parse(readFileSync(path.join(dir, 'cards', `${id}.card`, 'card.json'), 'utf8')));
}

const fixtures = 'tests/fixtures/cards-repo';
const cards: Card[] = [loadCard(fixtures, 'testcard'), loadCard(fixtures, 'testcard-promo')];
// CARDS_DIR=../binder-cards also checks the real cards (read only, nothing is copied)
const realDir = process.env.CARDS_DIR;
if (realDir && existsSync(path.join(realDir, 'index.json'))) {
  const index = JSON.parse(readFileSync(path.join(realDir, 'index.json'), 'utf8')) as { cards: { id: string }[] };
  for (const c of index.cards) cards.push(loadCard(realDir, c.id));
}

// iPhone 15 and 13 mini card viewports (device pixels), and a small one
const SCREENS = [
  { widthPx: 1083, heightPx: 1489 },
  { widthPx: 1029, heightPx: 1415 },
  { widthPx: 540, heightPx: 742 },
];

/** Independent check: at many random offsets inside the tilt box, no cut edge is inside the zoomed viewport. */
function cutEdgeVisible(card: Card, maxOffset: number, zoom: number, widthPx: number, heightPx: number): string | null {
  const proj = perspective(
    zoomedFovy(card.camera.vfovRad, zoom),
    widthPx / heightPx,
    card.camera.near,
    card.camera.far,
  );
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let k = 0; k < 400; k++) {
    const offset = k < 4 ? { x: k & 1 ? 1 : -1, y: k & 2 ? 1 : -1 } : { x: random(), y: random() };
    const vp = multiply(proj, viewMatrix(tiltPose(card, offset, maxOffset)));
    for (const layer of card.layers) {
      const sides: [string, number, number, number][] = [
        ['left', 0, 3, 0],
        ['right', 1, 2, 0],
        ['top', 0, 1, 1],
        ['bottom', 3, 2, 1],
      ];
      for (const [side, a, b, axis] of sides) {
        const constrained = layer.wrap[axis] === 'mirror' || layer.touchesEdge[side as 'left'];
        if (!constrained) continue;
        for (let s = 0; s <= 10; s++) {
          const ca = layer.quad[a]!;
          const cb = layer.quad[b]!;
          const p = [0, 1, 2].map((i) => ca[i]! + ((cb[i]! - ca[i]!) * s) / 10);
          const [x, y, , w] = transform(vp, [p[0]!, p[1]!, p[2]!, 1]);
          const nx = x / w;
          const ny = y / w;
          // a point of the edge inside the viewport (both coordinates within ±1) would show the cut
          if (Math.abs(nx) < 1 && Math.abs(ny) < 1) return `${layer.id} ${side} at offset ${JSON.stringify(offset)}`;
        }
      }
    }
  }
  return null;
}

describe('tilt fit (RENDERING.md §5.2)', () => {
  it.each(cards.map((c) => [c.id, c] as const))('%s: no cut edge ever visible, zoom ≤ 1.12', (_id, card) => {
    for (const screen of SCREENS) {
      const fit = fitTilt(card, 0.06, screen.widthPx, screen.heightPx);
      expect(fit.zoom).toBeGreaterThanOrEqual(1);
      expect(fit.zoom).toBeLessThanOrEqual(MAX_TILT_ZOOM);
      expect(fit.maxOffset).toBeGreaterThan(0);
      expect(cutEdgeVisible(card, fit.maxOffset, fit.zoom, screen.widthPx, screen.heightPx)).toBeNull();
      console.log(
        `${card.id} ${screen.widthPx}×${screen.heightPx}: zoom ${fit.zoom.toFixed(4)}, maxOffset ${fit.maxOffset.toFixed(4)}${fit.reduced ? ' (reduced)' : ''}`,
      );
    }
  });

  it('the tilt camera at zero offset is exactly the home camera', () => {
    const card = cards[0]!;
    expect(tiltPose(card, { x: 0, y: 0 }, 0.06)).toEqual(homePose(card.camera));
    // and the look-at construction agrees with the home rotation for an infinitesimal offset
    const near = tiltPose(card, { x: 1e-9, y: 0 }, 0.06);
    near.rotation.forEach((v, i) => {
      expect(v).toBeCloseTo(homePose(card.camera).rotation[i]!, 9);
    });
  });
});

describe('level plan and memory (RENDERING.md §6a)', () => {
  it.each(cards.map((c) => [c.id, c] as const))('%s: planned levels cover every view', (_id, card) => {
    const screen = SCREENS[0]!;
    const fit = fitTilt(card, 0.06, screen.widthPx, screen.heightPx);
    const finest = finestLevels(card, 'full', screen, fit);
    // spot-check: home and a few track times never need a finer level than planned
    const poses = [homePose(card.camera)];
    card.layers.forEach((layer, i) => {
      for (const pose of poses) {
        const level = referenceLevel(layer, layer.size.full, { pose, fovy: card.camera.vfovRad, ...screen });
        expect(level).toBeGreaterThanOrEqual(finest[i]!);
      }
    });
    const all = keptBytes(
      card,
      'full',
      card.layers.map(() => 0),
    );
    const kept = keptBytes(card, 'full', finest);
    expect(kept).toBeLessThanOrEqual(all);
    const plan = planTextures(card, screen, fit, 450e6, 16384);
    console.log(
      `${card.id}: full ${(all / 1e6).toFixed(0)} MB, kept ${(kept / 1e6).toFixed(0)} MB, levels ${finest.join(',')}, plan ${plan.resolution} (${(plan.bytes / 1e6).toFixed(0)} MB)`,
    );
  });

  it('falls back to half textures when the budget is too small or a texture is too large', () => {
    const card = cards[0]!;
    const screen = SCREENS[0]!;
    const fit = fitTilt(card, 0.06, screen.widthPx, screen.heightPx);
    expect(planTextures(card, screen, fit, 1, 16384)).toMatchObject({ resolution: 'half', reason: 'half-budget' });
    expect(planTextures(card, screen, fit, 450e6, 1024)).toMatchObject({
      resolution: 'half',
      reason: 'half-texture-size',
    });
    expect(planTextures(card, screen, fit, 450e6, 16384)).toMatchObject({ resolution: 'full', reason: 'full' });
  });

  it('level sizes follow the reference pyramid (ceil halving of the padded texture)', () => {
    const sfondo = cards[0]!.layers[0]!; // 1582×2018 with a 475×605 mirror margin
    expect(levelBytes(sfondo, sfondo.size.full)).toEqual([
      1582 * 2018 * 4,
      1266 * 1614 * 4,
      633 * 807 * 4,
      317 * 404 * 4,
    ]);
  });
});
