// Card view state machine (SPEC.md §6).
//
// | state          | transitions                                                                 |
// | card           | mode → artwork-flat                                                         |
// | artwork-flat   | mode → card; 3D on → artwork-tilt; long press (immersive ready) → immersive |
// | artwork-tilt   | 3D off → artwork-flat; mode → card                                          |
// | immersive      | ends → artwork-flat (leaving the view stops it)                             |

export type CardMode = 'card' | 'artwork-flat' | 'artwork-tilt' | 'immersive';

export type CardEvent =
  | { readonly type: 'mode' }
  | { readonly type: '3d-on' }
  | { readonly type: '3d-off' }
  | { readonly type: 'long-press'; readonly immersiveReady: boolean }
  | { readonly type: 'immersive-end' };

export function nextMode(mode: CardMode, event: CardEvent): CardMode {
  switch (mode) {
    case 'card':
      return event.type === 'mode' ? 'artwork-flat' : mode;
    case 'artwork-flat':
      if (event.type === 'mode') return 'card';
      if (event.type === '3d-on') return 'artwork-tilt';
      if (event.type === 'long-press' && event.immersiveReady) return 'immersive';
      return mode;
    case 'artwork-tilt':
      if (event.type === 'mode') return 'card';
      if (event.type === '3d-off') return 'artwork-flat';
      return mode;
    case 'immersive':
      return event.type === 'immersive-end' ? 'artwork-flat' : mode;
  }
}

export function isArtwork(mode: CardMode): boolean {
  return mode !== 'card';
}
