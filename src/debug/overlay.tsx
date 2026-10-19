// Debug overlay (?debug=1, SPEC.md §3): fps, texture memory, chosen resolution, tilt zoom, errors, and the tilt
// tuning controls of RENDERING.md §5.2 (MAX_ANGLE, MAX_OFFSET, axis signs).
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_TILT_SETTINGS } from '../interaction/tilt';
import { onTiltSettings, setTiltSettings, tiltSettings } from '../interaction/tilt-settings';
import { resetGpuLimit } from '../render/gpu-limit';
import { strings } from '../ui/strings';
import { debugSnapshot, onDebugChange } from './debug-store';
import './overlay.css';

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(debugSnapshot());
  const [tilt, setTilt] = useState(tiltSettings());

  useEffect(
    () =>
      onDebugChange(() => {
        setSnapshot(debugSnapshot());
      }),
    [],
  );
  useEffect(() => onTiltSettings(setTilt), []);

  const fps = snapshot.values.find(([key]) => key === 'fps')?.[1];

  return (
    <div class="debug-overlay">
      <button
        type="button"
        class="debug-chip"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {strings.debugTitle}
        {fps ? ` · ${fps} fps` : ''}
      </button>
      {open && (
        <div class="debug-panel">
          {snapshot.values.map(([key, value]) => (
            <p key={key}>
              <b>{key}</b> {value}
            </p>
          ))}
          {snapshot.errors.map((error) => (
            <p key={error} class="debug-error">
              {error}
            </p>
          ))}
          <label>
            {strings.debugTiltAngle(tilt.maxAngleDeg)}
            <input
              type="range"
              min={5}
              max={45}
              step={1}
              value={tilt.maxAngleDeg}
              onInput={(e) => {
                setTiltSettings({ ...tilt, maxAngleDeg: Number(e.currentTarget.value) });
              }}
            />
          </label>
          <label>
            {strings.debugTiltOffset(tilt.maxOffset)}
            <input
              type="range"
              min={0.01}
              max={0.15}
              step={0.005}
              value={tilt.maxOffset}
              onInput={(e) => {
                setTiltSettings({ ...tilt, maxOffset: Number(e.currentTarget.value) });
              }}
            />
          </label>
          <label class="debug-check">
            <input
              type="checkbox"
              checked={tilt.invertX}
              onChange={(e) => {
                setTiltSettings({ ...tilt, invertX: e.currentTarget.checked });
              }}
            />
            {strings.debugInvertX}
          </label>
          <label class="debug-check">
            <input
              type="checkbox"
              checked={tilt.invertY}
              onChange={(e) => {
                setTiltSettings({ ...tilt, invertY: e.currentTarget.checked });
              }}
            />
            {strings.debugInvertY}
          </label>
          <div class="debug-buttons">
            <button
              type="button"
              disabled={JSON.stringify(tilt) === JSON.stringify(DEFAULT_TILT_SETTINGS)}
              onClick={() => {
                setTiltSettings(null);
              }}
            >
              {strings.debugResetTilt}
            </button>
            <button type="button" onClick={resetGpuLimit}>
              {strings.debugResetGpu}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
