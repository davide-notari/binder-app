// Tilt zoom (RENDERING.md §5.2 point 4): a layer whose texture is cut at the drawing border must keep that quad
// edge outside the viewport while the camera moves. Mirrored layers end at their quad too, so their outer
// edges are kept outside as well.
import type { Card, CardLayer } from '../data/card-format';
import { tiltPose, viewMatrix } from './camera';
import { multiply, perspective, transform } from './math';

/** Above this zoom the tilt amplitude is reduced instead (RENDERING.md §5.2). */
export const MAX_TILT_ZOOM = 1.12;
/** Edges are pushed this many pixels beyond the viewport border (bicubic footprint at the cut). */
const EDGE_MARGIN_PX = 2;

type Side = 'left' | 'right' | 'top' | 'bottom';
/** Quad corners: texture top-left, top-right, bottom-right, bottom-left. */
const EDGE_CORNERS: Readonly<Record<Side, readonly [number, number]>> = {
  left: [0, 3],
  right: [1, 2],
  top: [0, 1],
  bottom: [3, 2],
};

export interface TiltFit {
  /** Zoom factor (≥ 1) applied to the field of view while tilting. */
  readonly zoom: number;
  /** Effective MAX_OFFSET (may be smaller than requested). */
  readonly maxOffset: number;
  /** True when the requested MAX_OFFSET was reduced to keep the zoom ≤ MAX_TILT_ZOOM. */
  readonly reduced: boolean;
}

function constrainedSides(layer: CardLayer): Side[] {
  const sides: Side[] = [];
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const axis = side === 'left' || side === 'right' ? 0 : 1;
    const wrap = layer.wrap[axis];
    if (wrap === 'mirror' || layer.touchesEdge[side]) sides.push(side);
  }
  return sides;
}

/** Zoom needed so that no constrained edge enters the viewport at any extreme tilt offset. */
export function requiredTiltZoom(card: Card, maxOffset: number, widthPx: number, heightPx: number): number {
  const proj = perspective(card.camera.vfovRad, widthPx / heightPx, card.camera.near, card.camera.far);
  const limitX = 1 + (2 * EDGE_MARGIN_PX) / widthPx;
  const limitY = 1 + (2 * EDGE_MARGIN_PX) / heightPx;
  let zoom = 1;
  for (const ox of [-1, 0, 1]) {
    for (const oy of [-1, 0, 1]) {
      const vp = multiply(proj, viewMatrix(tiltPose(card, { x: ox, y: oy }, maxOffset)));
      for (const layer of card.layers) {
        for (const side of constrainedSides(layer)) {
          const ndc = EDGE_CORNERS[side].map((i) => {
            const c = layer.quad[i] ?? [0, 0, 0];
            const [x, y, , w] = transform(vp, [c[0], c[1], c[2], 1]);
            return w > 0 ? [x / w, y / w] : null;
          });
          if (ndc.some((p) => p === null)) return Infinity; // edge behind the camera: cannot be fixed by zoom
          const xs = ndc.map((p) => p?.[0] ?? 0);
          const ys = ndc.map((p) => p?.[1] ?? 0);
          let need: number;
          if (side === 'left') need = Math.max(...xs) < 0 ? -limitX / Math.max(...xs) : Infinity;
          else if (side === 'right') need = Math.min(...xs) > 0 ? limitX / Math.min(...xs) : Infinity;
          else if (side === 'top') need = Math.min(...ys) > 0 ? limitY / Math.min(...ys) : Infinity;
          else need = Math.max(...ys) < 0 ? -limitY / Math.max(...ys) : Infinity;
          zoom = Math.max(zoom, need);
        }
      }
    }
  }
  return zoom;
}

/**
 * Tilt zoom for a requested MAX_OFFSET; if it would exceed MAX_TILT_ZOOM, the largest MAX_OFFSET that fits
 * (binary search). Compute once per card and screen size.
 */
export function fitTilt(card: Card, requestedMaxOffset: number, widthPx: number, heightPx: number): TiltFit {
  const zoom = requiredTiltZoom(card, requestedMaxOffset, widthPx, heightPx);
  if (zoom <= MAX_TILT_ZOOM) return { zoom, maxOffset: requestedMaxOffset, reduced: false };
  let lo = 0;
  let hi = requestedMaxOffset;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (requiredTiltZoom(card, mid, widthPx, heightPx) <= MAX_TILT_ZOOM) lo = mid;
    else hi = mid;
  }
  return { zoom: requiredTiltZoom(card, lo, widthPx, heightPx), maxOffset: lo, reduced: true };
}
