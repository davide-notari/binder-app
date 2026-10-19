// Texture level choice of the reference renderer (anteprima_hd.py, reproduced by binder-cards/tools/verify_card.py).
// The approved frames are sampled with ONE pyramid level per layer and frame, chosen from the texture
// magnification at the centre of the frame, then bicubic-interpolated. The fragment shader reproduces the
// sampling; this module reproduces the level choice (see docs/RENDERING.md §2a).
import type { CardLayer, Vec3 } from '../data/card-format';
import type { CameraPose } from './camera';
import { at, rotationFromQuat } from './math';

/** Pyramid levels of the reference: base + up to 3, only while the smaller side is > 256 texels. */
export const MAX_PYRAMID_LEVELS = 4;
const PYRAMID_MIN_SIDE = 256;
/** A level is used while its magnification stays ≤ 1.4 (screen pixels per texel). */
const LEVEL_MAX_MAGNIFICATION = 1.4;

function textureCoords(m: CardLayer['texFromWorld'], p: Vec3): [number, number] {
  const [r0, r1, r2] = m;
  const q = r2[0] * p[0] + r2[1] * p[1] + r2[2] * p[2] + r2[3];
  return [
    (r0[0] * p[0] + r0[1] * p[1] + r0[2] * p[2] + r0[3]) / q,
    (r1[0] * p[0] + r1[1] * p[1] + r1[2] * p[2] + r1[3]) / q,
  ];
}

/**
 * Mirrored margin (texels) that the reference adds around "mirror" textures: the extent of the quad beyond
 * the texture. It only matters for the number of pyramid levels.
 */
export function mirrorMargin(layer: CardLayer, size: readonly [number, number]): [number, number] {
  const uvs = layer.quad.map((c) => textureCoords(layer.texFromWorld, c));
  const minU = Math.min(...uvs.map((uv) => uv[0]));
  const minV = Math.min(...uvs.map((uv) => uv[1]));
  return [
    layer.wrap[0] === 'mirror' ? Math.round(Math.max(0, -minU) * size[0]) : 0,
    layer.wrap[1] === 'mirror' ? Math.round(Math.max(0, -minV) * size[1]) : 0,
  ];
}

/** Number of pyramid levels the reference builds for a texture of this size. */
export function pyramidLevels(layer: CardLayer, size: readonly [number, number]): number {
  const [mx, my] = mirrorMargin(layer, size);
  let w = size[0] + 2 * mx;
  let h = size[1] + 2 * my;
  let levels = 1;
  while (Math.min(w, h) > PYRAMID_MIN_SIDE && levels < MAX_PYRAMID_LEVELS) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    levels++;
  }
  return levels;
}

export interface ScreenSetup {
  readonly pose: CameraPose;
  readonly fovy: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Texture position (texels) seen by screen pixel (x, y) (pixel centres on integer coordinates, as the
 * reference), or null when the pixel's ray does not hit the layer plane in front of the camera.
 */
function texelAt(
  layer: CardLayer,
  size: readonly [number, number],
  s: ScreenSetup,
  x: number,
  y: number,
): [number, number] | null {
  const f = s.heightPx / 2 / Math.tan(s.fovy / 2);
  const dc: Vec3 = [(x - s.widthPx / 2) / f, -(y - s.heightPx / 2) / f, -1];
  const r = rotationFromQuat(s.pose.rotation);
  const d: Vec3 = [
    at(r, 0, 0) * dc[0] + at(r, 0, 1) * dc[1] + at(r, 0, 2) * dc[2],
    at(r, 1, 0) * dc[0] + at(r, 1, 1) * dc[1] + at(r, 1, 2) * dc[2],
    at(r, 2, 0) * dc[0] + at(r, 2, 1) * dc[1] + at(r, 2, 2) * dc[2],
  ];
  const [q0, q1, , q3] = layer.quad;
  const a: Vec3 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const b: Vec3 = [q3[0] - q0[0], q3[1] - q0[1], q3[2] - q0[2]];
  const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const p = s.pose.position;
  const denom = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(denom) < 1e-12) return null;
  const t = (n[0] * (q0[0] - p[0]) + n[1] * (q0[1] - p[1]) + n[2] * (q0[2] - p[2])) / denom;
  if (t <= 0) return null;
  const uv = textureCoords(layer.texFromWorld, [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]]);
  return [uv[0] * size[0], uv[1] * size[1]];
}

/** Pyramid level the reference renderer uses for this layer in this frame. */
export function referenceLevel(layer: CardLayer, size: readonly [number, number], s: ScreenSetup): number {
  const cx = s.widthPx / 2;
  const cy = s.heightPx / 2;
  const c0 = texelAt(layer, size, s, cx, cy);
  const c1 = texelAt(layer, size, s, cx + 1, cy);
  const c2 = texelAt(layer, size, s, cx, cy + 1);
  if (!c0 || !c1 || !c2) return 0;
  const e1 = [c1[0] - c0[0], c1[1] - c0[1]] as const;
  const e2 = [c2[0] - c0[0], c2[1] - c0[1]] as const;
  const magnification = 1 / Math.sqrt(Math.abs(e1[0] * e2[1] - e1[1] * e2[0]) + 1e-12);
  const levels = pyramidLevels(layer, size);
  let level = 0;
  while (level + 1 < levels && magnification * 2 ** (level + 1) <= LEVEL_MAX_MAGNIFICATION) level++;
  return level;
}
