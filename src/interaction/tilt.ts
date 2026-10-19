// Phone tilt → normalized camera offset (RENDERING.md §5.2).
// beta = front/back tilt, gamma = left/right tilt (degrees). On enabling, the current orientation becomes the
// neutral reference; the offset is (angle − reference) / MAX_ANGLE clamped to [−1, 1], smoothed with an
// exponential filter (τ 80 ms), and the reference slowly follows the phone (τ 4 s) so that a new posture
// recentres the picture.
import type { TiltOffset } from '../render/camera';

export interface TiltSettings {
  /** Degrees of phone tilt for the full offset. */
  readonly maxAngleDeg: number;
  /** Camera offset at full tilt, as a fraction of the drawing window size. */
  readonly maxOffset: number;
  /** Flip the horizontal / vertical direction. */
  readonly invertX: boolean;
  readonly invertY: boolean;
}

/** Starting values (RENDERING.md §5.2); tune on the iPhone with the debug overlay, then hard-code. */
export const DEFAULT_TILT_SETTINGS: TiltSettings = { maxAngleDeg: 25, maxOffset: 0.06, invertX: false, invertY: false };

const SMOOTHING_MS = 80;
const RECENTER_MS = 4000;

export type MotionPermission = 'granted' | 'denied' | 'unavailable';

interface PermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Must be called inside the tap handler of the 3D button (iOS requires a user gesture). */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unavailable';
  const api = DeviceOrientationEvent as unknown as PermissionApi;
  if (typeof api.requestPermission !== 'function') return 'granted';
  try {
    return (await api.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Shortest signed difference between two angles in degrees. */
function angleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export class TiltInput {
  private latest: { beta: number; gamma: number } | null = null;
  private reference: { beta: number; gamma: number } | null = null;
  private smoothed = { x: 0, y: 0 };
  private lastUpdate: number | null = null;
  private listening = false;

  constructor(private settings: TiltSettings) {}

  setSettings(settings: TiltSettings): void {
    this.settings = settings;
  }

  /** Starts listening; the first orientation received becomes the neutral reference. */
  start(): void {
    this.reference = null;
    this.latest = null;
    this.smoothed = { x: 0, y: 0 };
    this.lastUpdate = null;
    if (!this.listening) {
      window.addEventListener('deviceorientation', this.onOrientation);
      this.listening = true;
    }
  }

  stop(): void {
    if (this.listening) window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
  }

  /** Feeds an orientation directly (tests and the debug overlay). */
  feed(beta: number, gamma: number): void {
    this.latest = { beta, gamma };
    this.reference ??= { beta, gamma };
  }

  /** Smoothed offset at time `now` (ms). Without any orientation event it stays centred. */
  update(now: number): TiltOffset {
    const dt = this.lastUpdate === null ? 0 : Math.min(now - this.lastUpdate, 100);
    this.lastUpdate = now;
    const latest = this.latest;
    const reference = this.reference;
    if (!latest || !reference) return this.smoothed;
    const recenter = 1 - Math.exp(-dt / RECENTER_MS);
    reference.beta += angleDelta(latest.beta, reference.beta) * recenter;
    reference.gamma += angleDelta(latest.gamma, reference.gamma) * recenter;
    const { maxAngleDeg, invertX, invertY } = this.settings;
    // tilting the phone to the right (gamma up) moves the camera right: more of the background's left side shows
    const targetX = clamp(angleDelta(latest.gamma, reference.gamma) / maxAngleDeg) * (invertX ? -1 : 1);
    // tilting the top edge away (beta down) moves the camera up: more of the background's bottom side shows
    const targetY = clamp(-angleDelta(latest.beta, reference.beta) / maxAngleDeg) * (invertY ? -1 : 1);
    const k = dt === 0 ? 0 : 1 - Math.exp(-dt / SMOOTHING_MS);
    this.smoothed = {
      x: this.smoothed.x + (targetX - this.smoothed.x) * k,
      y: this.smoothed.y + (targetY - this.smoothed.y) * k,
    };
    return this.smoothed;
  }

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) return;
    this.feed(event.beta, event.gamma);
  };
}
