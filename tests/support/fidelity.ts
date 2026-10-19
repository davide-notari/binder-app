// Image comparison exactly as binder-cards/tools/verify_card.py:
// mean = mean absolute difference over all RGB values; p99 = 99th percentile of the per-pixel max channel
// difference (numpy's default linear interpolation).
import type { RgbImage } from './png';

/** RENDERING.md §8. Never loosen these to make a test pass. */
export const FIDELITY_MAX_MEAN = 1.0;
export const FIDELITY_MAX_P99 = 16;

export interface FidelityMetrics {
  readonly mean: number;
  readonly p99: number;
  readonly max: number;
}

export function rgbaToRgb(rgba: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i] ?? 0;
    rgb[j + 1] = rgba[i + 1] ?? 0;
    rgb[j + 2] = rgba[i + 2] ?? 0;
  }
  return rgb;
}

/** Per-pixel max channel difference. */
export function diffMap(a: RgbImage, b: RgbImage): Uint8Array {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const out = new Uint8Array(a.width * a.height);
  for (let p = 0, i = 0; p < out.length; p++, i += 3) {
    out[p] = Math.max(
      Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
      Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
      Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
    );
  }
  return out;
}

function percentileFromHistogram(histogram: readonly number[], count: number, q: number): number {
  // numpy.percentile (linear): value at fractional rank q · (n − 1) of the sorted data
  const rank = q * (count - 1);
  const lower = Math.floor(rank);
  const valueAtRank = (r: number): number => {
    let seen = 0;
    for (let v = 0; v < histogram.length; v++) {
      seen += histogram[v] ?? 0;
      if (seen > r) return v;
    }
    return histogram.length - 1;
  };
  const lo = valueAtRank(lower);
  const hi = valueAtRank(Math.min(lower + 1, count - 1));
  return lo + (hi - lo) * (rank - lower);
}

export function compareImages(rendered: RgbImage, reference: RgbImage): FidelityMetrics {
  const map = diffMap(rendered, reference);
  let sum = 0;
  for (let i = 0; i < rendered.data.length; i++) {
    sum += Math.abs((rendered.data[i] ?? 0) - (reference.data[i] ?? 0));
  }
  const histogram = new Array<number>(256).fill(0);
  let max = 0;
  for (const d of map) {
    histogram[d] = (histogram[d] ?? 0) + 1;
    if (d > max) max = d;
  }
  return {
    mean: sum / rendered.data.length,
    p99: percentileFromHistogram(histogram, map.length, 0.99),
    max,
  };
}

/** Heatmap of the per-pixel difference (×8, black → red → yellow → white), like verify_card.py --save-diff. */
export function heatmap(rendered: RgbImage, reference: RgbImage): RgbImage {
  const map = diffMap(rendered, reference);
  const data = new Uint8Array(map.length * 3);
  map.forEach((d, p) => {
    const v = Math.min(255, d * 8) / 255;
    data[p * 3] = Math.round(255 * Math.min(1, v * 3));
    data[p * 3 + 1] = Math.round(255 * Math.min(1, Math.max(0, v * 3 - 1)));
    data[p * 3 + 2] = Math.round(255 * Math.min(1, Math.max(0, v * 3 - 2)));
  });
  return { width: rendered.width, height: rendered.height, data };
}

/** Images side by side: rendered | reference | heatmap. */
export function sideBySide(images: readonly RgbImage[]): RgbImage {
  const height = Math.max(...images.map((i) => i.height));
  const width = images.reduce((w, i) => w + i.width, 0);
  const data = new Uint8Array(width * height * 3);
  let x0 = 0;
  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      data.set(image.data.subarray(y * image.width * 3, (y + 1) * image.width * 3), (y * width + x0) * 3);
    }
    x0 += image.width;
  }
  return { width, height, data };
}
