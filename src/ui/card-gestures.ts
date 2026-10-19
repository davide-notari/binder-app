// Gestures of the stacked screens (SPEC.md §6): collection ← binder ← card view.
// - from the left edge: the screen follows the finger and reveals the one underneath; released far or fast
//   enough it slides away and goes back, otherwise it springs back (card view and binder);
// - horizontal drag inside the view: the card follows the finger; released far or fast enough it slides out
//   and the previous / next card comes in (a rubber band at the first and last card).
// During a drag the elements are moved through their style (no re-render), so the movement stays at 60 fps.
import { useEffect, useRef } from 'preact/hooks';

/** A drag that starts this close to the left edge goes back to the binder. */
const EDGE_ZONE = 24;
/** Movement before a drag is recognised as horizontal. */
const DECIDE_PX = 12;
/** Release thresholds: fraction of the width, or speed (px/ms). */
const BACK_COMMIT = 0.3;
const CARD_COMMIT = 0.22;
const FLING_SPEED = 0.45;
/** A finger that stopped this long before lifting does not fling. */
const FLING_MAX_PAUSE_MS = 100;
export const SLIDE_MS = 230;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

type Kind = 'pending' | 'back' | 'card' | 'none';

interface Drag {
  kind: Kind;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  velocity: number;
  dx: number;
}

interface Options {
  readonly rootRef: { readonly current: HTMLElement | null };
  /** The element moved by the card swipe; null = no card swipe (binder). */
  readonly stageRef: { readonly current: HTMLElement | null } | null;
  /** CSS variable that reveals the screen underneath (binder.css, collection.css). */
  readonly revealVar: '--back-progress' | '--collection-reveal';
  /** False during the immersive view. */
  readonly enabled: boolean;
  readonly hasPrevious?: boolean;
  readonly hasNext?: boolean;
  /** A drag has been recognised: cancel the long press. */
  readonly onDragStart?: () => void;
  readonly onBack: () => void;
  /** -1 = previous card, +1 = next card (called when the old card has slid out). */
  readonly onNavigate?: (direction: -1 | 1) => void;
}

/** How much of the screen underneath is revealed (0 = covered, 1 = the top screen is gone). */
function setReveal(variable: string, progress: number, animate: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('back-animating', animate);
  root.style.setProperty(variable, progress.toFixed(4));
}

function move(element: HTMLElement | null, x: number, animate: boolean): void {
  if (!element) return;
  element.style.transition = animate ? `transform ${SLIDE_MS}ms ${EASE}` : 'none';
  element.style.transform = x === 0 ? '' : `translateX(${x}px)`;
}

export function useCardGestures(options: Options) {
  const drag = useRef<Drag | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const leaving = useRef(false);

  // the screen covers the one underneath while it is open
  useEffect(() => {
    const variable = opts.current.revealVar;
    setReveal(variable, 0, true);
    return () => {
      setReveal(variable, 1, true);
    };
  }, []);

  /** Slides the whole view away to the right, then goes back (also used by the back button). */
  const animateBack = () => {
    if (leaving.current) return;
    leaving.current = true;
    const root = opts.current.rootRef.current;
    move(root, root?.clientWidth ?? window.innerWidth, true);
    setReveal(opts.current.revealVar, 1, true);
    window.setTimeout(() => {
      opts.current.onBack();
    }, SLIDE_MS);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!opts.current.enabled || leaving.current || drag.current) return;
    const kind: Kind = event.clientX <= EDGE_ZONE ? 'back' : 'pending';
    drag.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
      dx: 0,
    };
    if (kind === 'back') {
      opts.current.rootRef.current?.setPointerCapture(event.pointerId);
      opts.current.onDragStart?.();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (d?.pointerId !== event.pointerId || d.kind === 'none') return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (d.kind === 'pending') {
      if (opts.current.stageRef && Math.abs(dx) > DECIDE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        d.kind = 'card';
        opts.current.rootRef.current?.setPointerCapture(event.pointerId);
        opts.current.onDragStart?.();
      } else if (Math.abs(dy) > DECIDE_PX) {
        d.kind = 'none';
        return;
      } else {
        return;
      }
    }
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.velocity = 0.7 * d.velocity + 0.3 * ((event.clientX - d.lastX) / dt);
    d.lastX = event.clientX;
    d.lastT = event.timeStamp;
    d.dx = dx;
    if (d.kind === 'back') {
      const root = opts.current.rootRef.current;
      const x = Math.max(0, dx);
      move(root, x, false);
      setReveal(opts.current.revealVar, x / (root?.clientWidth ?? window.innerWidth), false);
    } else {
      const blocked = (dx > 0 && !opts.current.hasPrevious) || (dx < 0 && !opts.current.hasNext);
      move(opts.current.stageRef?.current ?? null, blocked ? dx * 0.25 : dx, false);
    }
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (d?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.timeStamp - d.lastT > FLING_MAX_PAUSE_MS) d.velocity = 0;
    const { rootRef, stageRef, hasPrevious = false, hasNext = false, onNavigate, revealVar } = opts.current;
    if (d.kind === 'back') {
      const width = rootRef.current?.clientWidth ?? window.innerWidth;
      if (!cancelled && d.dx > 20 && (d.dx > width * BACK_COMMIT || d.velocity > FLING_SPEED)) {
        animateBack();
      } else {
        move(rootRef.current, 0, true);
        setReveal(revealVar, 0, true);
      }
    } else if (d.kind === 'card') {
      const stage = stageRef?.current ?? null;
      const width = stage?.clientWidth ?? window.innerWidth;
      const direction: -1 | 1 = d.dx < 0 ? 1 : -1;
      const allowed = direction === 1 ? hasNext : hasPrevious;
      const far = Math.abs(d.dx) > width * CARD_COMMIT || Math.abs(d.velocity) > FLING_SPEED;
      if (!cancelled && allowed && far && Math.sign(d.velocity || d.dx) === Math.sign(d.dx)) {
        leaving.current = true;
        move(stage, -direction * width, true);
        window.setTimeout(() => {
          onNavigate?.(direction);
        }, SLIDE_MS);
      } else {
        move(stage, 0, true);
      }
    }
  };

  return {
    animateBack,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent) => {
        finish(event, false);
      },
      onPointerCancel: (event: PointerEvent) => {
        finish(event, true);
      },
    },
  };
}
