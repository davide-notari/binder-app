// GPU memory of a card and choice of the texture set (RENDERING.md §6, CARD_FORMAT.md §5).
import type { Card, CardLayer, TextureResolution } from '../data/card-format';
import { finestLevels, type ScreenSize } from './level-plan';
import { mirrorMargin, pyramidLevels } from './sampling';
import type { TiltFit } from './tilt-fit';

/**
 * Starting GPU budget per card. All four current cards fit at full resolution once unused levels are dropped
 * (152–404 MB); the device limit (gpu-limit.ts) lowers it automatically if a phone runs out of memory.
 */
export const DEFAULT_GPU_BUDGET = 450e6;

/** RGBA8 bytes of each pyramid level: [level 0 (texture), level 1, ...] (same sizes as textures.ts). */
export function levelBytes(layer: CardLayer, size: readonly [number, number]): number[] {
  const [mx, my] = mirrorMargin(layer, size);
  const bytes = [size[0] * size[1] * 4];
  let w = size[0] + 2 * mx;
  let h = size[1] + 2 * my;
  const count = pyramidLevels(layer, size);
  for (let k = 1; k < count; k++) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    bytes.push(w * h * 4);
  }
  return bytes;
}

/** Bytes kept on the GPU when each layer keeps its levels from finest[i] up. */
export function keptBytes(card: Card, resolution: TextureResolution, finest: readonly number[]): number {
  return card.layers.reduce((sum, layer, i) => {
    const levels = levelBytes(layer, layer.size[resolution]);
    return sum + levels.slice(Math.min(finest[i] ?? 0, levels.length - 1)).reduce((a, b) => a + b, 0);
  }, 0);
}

export type PlanReason = 'full' | 'half-budget' | 'half-texture-size';

export interface TexturePlan {
  readonly resolution: TextureResolution;
  /** Finest pyramid level kept per layer. */
  readonly finest: readonly number[];
  readonly bytes: number;
  readonly reason: PlanReason;
}

/**
 * Full textures whenever they fit: half textures change the picture visibly (M2 measurement: mean diff 1.1–3.4,
 * p99 up to 72 against the approved frames), so they are only a fallback for memory or texture-size limits.
 */
export function planTextures(
  card: Card,
  screen: ScreenSize,
  tilt: TiltFit,
  budgetBytes: number,
  maxTextureSize: number,
): TexturePlan {
  const fullTooBig = card.layers.some((l) => Math.max(...l.size.full) > maxTextureSize);
  if (!fullTooBig) {
    const finest = finestLevels(card, 'full', screen, tilt);
    const bytes = keptBytes(card, 'full', finest);
    if (bytes <= budgetBytes) return { resolution: 'full', finest, bytes, reason: 'full' };
  }
  const finest = finestLevels(card, 'half', screen, tilt);
  return {
    resolution: 'half',
    finest,
    bytes: keptBytes(card, 'half', finest),
    reason: fullTooBig ? 'half-texture-size' : 'half-budget',
  };
}
