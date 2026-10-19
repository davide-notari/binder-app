// Small timing helpers for the card view animations.

/** Duration of the 3D on/off transition (RENDERING.md §5.2 point 5). */
export const TILT_TRANSITION_MS = 350;
/** Long press that starts the immersive flight (RENDERING.md §5.3). */
export const LONG_PRESS_MS = 450;
/** Finger movement that cancels a long press. */
export const LONG_PRESS_SLOP_PX = 10;

export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** A value animated from `from` to `to` over `durationMs`, eased. */
export class Transition {
  private from = 0;
  private to = 0;
  private start = 0;

  constructor(private readonly durationMs: number) {}

  /** Starts moving to `target` from the current value at time `now`. */
  set(target: number, now: number): void {
    this.from = this.value(now);
    this.to = target;
    this.start = now;
  }

  /** Jumps to a value without animation. */
  reset(value: number): void {
    this.from = this.to = value;
    this.start = 0;
  }

  value(now: number): number {
    const t = this.durationMs === 0 ? 1 : (now - this.start) / this.durationMs;
    return this.from + (this.to - this.from) * easeInOut(t);
  }

  get target(): number {
    return this.to;
  }

  done(now: number): boolean {
    return now - this.start >= this.durationMs;
  }
}
