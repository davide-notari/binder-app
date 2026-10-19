// Values shown by the debug overlay (?debug=1): fps, texture memory, chosen resolution, tilt zoom, errors.
type Listener = () => void;

const values = new Map<string, string>();
const errors: string[] = [];
const listeners = new Set<Listener>();
let scheduled = false;

function notify(): void {
  if (scheduled) return;
  scheduled = true;
  // at most a few updates per second, so the overlay never costs frames
  setTimeout(() => {
    scheduled = false;
    listeners.forEach((l) => {
      l();
    });
  }, 250);
}

const DEBUG_KEY = 'binder.debug';

/** ?debug=1 / ?debug=0, or the switch in the settings; remembered on this device. */
export function debugEnabled(): boolean {
  try {
    const param = new URLSearchParams(location.search).get('debug');
    if (param === '1') localStorage.setItem(DEBUG_KEY, '1');
    if (param === '0') localStorage.removeItem(DEBUG_KEY);
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1');
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    // not remembered
  }
}

export function setDebugValue(key: string, value: string | null): void {
  if (value === null) values.delete(key);
  else values.set(key, value);
  notify();
}

export function reportDebugError(message: string): void {
  errors.unshift(`${new Date().toLocaleTimeString()} ${message}`);
  errors.length = Math.min(errors.length, 5);
  notify();
}

export function debugSnapshot(): { values: [string, string][]; errors: string[] } {
  return { values: [...values.entries()], errors: [...errors] };
}

export function onDebugChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
