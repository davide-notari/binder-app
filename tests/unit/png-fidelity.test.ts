import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareImages } from '../support/fidelity';
import { decodePng, encodePng, type RgbImage } from '../support/png';

describe('png', () => {
  it('decodes the fixture reference frames', () => {
    const image = decodePng(readFileSync('tests/fixtures/cards-repo/refs/testcard/f_0001.png'));
    expect([image.width, image.height]).toEqual([1080, 1484]);
    expect(image.data).toHaveLength(1080 * 1484 * 3);
  });

  it('round-trips an encoded image', () => {
    const data = Uint8Array.from({ length: 7 * 5 * 3 }, (_, i) => (i * 37) & 0xff);
    const image: RgbImage = { width: 7, height: 5, data };
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(7);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });
});

describe('compareImages (same metrics as verify_card.py)', () => {
  it('is zero for identical images', () => {
    const image = decodePng(readFileSync('tests/fixtures/cards-repo/refs/testcard/f_0143.png'));
    expect(compareImages(image, image)).toEqual({ mean: 0, p99: 0, max: 0 });
  });

  it('mean over all channels, p99 of the per-pixel max channel (numpy linear percentile)', () => {
    // 100 pixels; pixel k differs by k in the red channel only
    const a: RgbImage = { width: 100, height: 1, data: new Uint8Array(300) };
    const b: RgbImage = { width: 100, height: 1, data: new Uint8Array(300) };
    for (let k = 0; k < 100; k++) b.data[k * 3] = k;
    const m = compareImages(a, b);
    expect(m.mean).toBeCloseTo(4950 / 300, 12);
    expect(m.p99).toBeCloseTo(98.01, 9); // numpy.percentile(range(100), 99)
    expect(m.max).toBe(99);
  });
});
