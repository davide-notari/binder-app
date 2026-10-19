// Tilt tuning chosen in the debug overlay, remembered on this device (a development convenience: the final
// values get hard-coded in DEFAULT_TILT_SETTINGS).
import { DEFAULT_TILT_SETTINGS, type TiltSettings } from './tilt';

const KEY = 'binder.tiltTuning';
type Listener = (settings: TiltSettings) => void;

let current: TiltSettings = load();
const listeners = new Set<Listener>();

function load(): TiltSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TILT_SETTINGS;
    const s = JSON.parse(raw) as Partial<TiltSettings>;
    return {
      maxAngleDeg: typeof s.maxAngleDeg === 'number' ? s.maxAngleDeg : DEFAULT_TILT_SETTINGS.maxAngleDeg,
      maxOffset: typeof s.maxOffset === 'number' ? s.maxOffset : DEFAULT_TILT_SETTINGS.maxOffset,
      invertX: typeof s.invertX === 'boolean' ? s.invertX : DEFAULT_TILT_SETTINGS.invertX,
      invertY: typeof s.invertY === 'boolean' ? s.invertY : DEFAULT_TILT_SETTINGS.invertY,
    };
  } catch {
    return DEFAULT_TILT_SETTINGS;
  }
}

export function tiltSettings(): TiltSettings {
  return current;
}

export function setTiltSettings(settings: TiltSettings | null): void {
  current = settings ?? DEFAULT_TILT_SETTINGS;
  try {
    if (settings) localStorage.setItem(KEY, JSON.stringify(settings));
    else localStorage.removeItem(KEY);
  } catch {
    // not remembered
  }
  listeners.forEach((l) => {
    l(current);
  });
}

export function onTiltSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
