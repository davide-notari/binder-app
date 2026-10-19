// Choice between full and half layer textures (CARD_FORMAT.md §5).
import type { Card } from '../data/card-format';

/** Visible fraction of the drawing height in tilt / home view (≈ 1 / tiltZoom). */
export const TILT_VISIBLE_FRACTION = 0.95;

export type ViewKind = 'tilt' | 'immersive';

/** True if half textures cannot be distinguished from full ones at this card viewport height (device px). */
export function halfIsEnough(card: Card, displayHeightPx: number, view: ViewKind): boolean {
  const fraction = view === 'immersive' && card.immersive ? card.immersive.minVisibleFraction : TILT_VISIBLE_FRACTION;
  return displayHeightPx <= (fraction * card.artPx[1]) / 2;
}
