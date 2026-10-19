// One WebGL context for the whole app: card views borrow its canvas. iOS keeps few contexts alive and
// creating one per card view leaks GPU memory when cards are opened repeatedly.
import { CardRenderer } from './renderer';

let shared: CardRenderer | null = null;

export function sharedRenderer(): CardRenderer {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.className = 'card-canvas';
    shared = new CardRenderer(canvas);
  }
  return shared;
}
