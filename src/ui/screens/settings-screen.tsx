// Settings (SPEC.md §5–6 screen 5): card updates, 3D cache (space, limit, download all, clear), access key,
// app version, debug overlay.
import { useEffect, useState } from 'preact/hooks';
import { getLayerCacheLimit, LAYER_CACHE_LIMITS, setLayerCacheLimit } from '../../data/settings';
import type { CardStore } from '../../data/store';
import { ChevronLeftIcon } from '../icons';
import { strings } from '../strings';
import './screens.css';
import './settings.css';

interface Props {
  readonly store: CardStore;
  /** False with the local development source (no key). */
  readonly hasKey: boolean;
  readonly debugOn: boolean;
  readonly onBack: () => void;
  /** Refreshes the cards (and checks for a new app version); resolves with the message to show. */
  readonly onCheckUpdates: () => Promise<string>;
  readonly onReplaceKey: () => void;
  readonly onRemoveKey: () => void;
  readonly onDebugChange: (on: boolean) => void;
  /** The 3D on the device changed (download all, clear). */
  readonly on3dChanged: () => void;
}

function limitLabel(limit: number): string {
  return Number.isFinite(limit) ? strings.megabytes(limit) : strings.settingsLimitAll;
}

export function SettingsScreen(props: Props) {
  const { store, hasKey, debugOn, onBack, onCheckUpdates, onReplaceKey, onRemoveKey, onDebugChange, on3dChanged } =
    props;
  const [layerBytes, setLayerBytes] = useState<number | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const measure = async () => {
    setLayerBytes(await store.layerBytes());
    try {
      setUsage((await navigator.storage.estimate()).usage ?? null);
    } catch {
      setUsage(null);
    }
  };

  // measured once when the screen opens, then after every action
  useEffect(() => {
    void measure();
    void getLayerCacheLimit().then(setLimit);
  }, []);

  const check = async () => {
    setChecking(true);
    setCheckMessage(null);
    setCheckMessage(await onCheckUpdates());
    setChecking(false);
    void measure();
  };

  const changeLimit = async (value: number) => {
    setLimit(value);
    await setLayerCacheLimit(value);
    await store.enforceLimit();
    on3dChanged();
    void measure();
  };

  const downloadAll = async () => {
    const needed = store.allLayersBytes();
    if (limit !== null && needed > limit) {
      if (!window.confirm(strings.settingsDownloadRaise(strings.megabytes(needed)))) return;
      await changeLimit(Infinity);
    }
    setCacheMessage(null);
    setDownload({ done: 0, total: 0 });
    const failures = await store.downloadAllLayers((done, total) => {
      setDownload({ done, total });
    });
    setDownload(null);
    setCacheMessage(failures > 0 ? strings.settingsDownloadFailed(failures) : strings.settingsDownloaded);
    on3dChanged();
    void measure();
  };

  const clear3d = async () => {
    if (!window.confirm(strings.settingsClear3dConfirm)) return;
    await store.clearLayers();
    setCacheMessage(strings.settingsCleared);
    on3dChanged();
    void measure();
  };

  const removeKey = () => {
    if (window.confirm(strings.settingsRemoveKeyConfirm)) onRemoveKey();
  };

  return (
    <main class="settings">
      <header class="screen-bar">
        <button type="button" class="bar-back" onClick={onBack}>
          <ChevronLeftIcon />
          <span>{strings.back}</span>
        </button>
        <h1>{strings.settings}</h1>
      </header>

      <section class="settings-group">
        <h2>{strings.settingsCards}</h2>
        <div class="settings-card">
          <button type="button" class="settings-row action" disabled={checking} onClick={() => void check()}>
            {checking ? strings.settingsChecking : strings.settingsCheck}
          </button>
        </div>
        {checkMessage && (
          <p class="settings-hint" role="status">
            {checkMessage}
          </p>
        )}
      </section>

      <section class="settings-group">
        <h2>{strings.settings3d}</h2>
        <div class="settings-card">
          <div class="settings-row">
            <span>{strings.settings3dUsed}</span>
            <span class="settings-value" data-testid="layer-bytes">
              {layerBytes === null ? '…' : strings.megabytes(layerBytes)}
            </span>
          </div>
          <div class="settings-row">
            <span>{strings.settingsTotalUsed}</span>
            <span class="settings-value">{usage === null ? '–' : strings.megabytes(usage)}</span>
          </div>
          <div class="settings-row stacked">
            <span>{strings.settingsLimit}</span>
            <div class="segmented compact" role="group">
              {LAYER_CACHE_LIMITS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={limit === value}
                  onClick={() => void changeLimit(value)}
                >
                  {limitLabel(value)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p class="settings-hint">{strings.settingsLimitHint}</p>
        <div class="settings-card">
          <button
            type="button"
            class="settings-row action"
            disabled={download !== null}
            onClick={() => void downloadAll()}
          >
            {download
              ? strings.settingsDownloading(download.done, download.total)
              : strings.settingsDownloadAll(strings.megabytes(store.allLayersBytes()))}
          </button>
          <button
            type="button"
            class="settings-row action danger"
            disabled={download !== null}
            onClick={() => void clear3d()}
          >
            {strings.settingsClear3d}
          </button>
        </div>
        {cacheMessage && (
          <p class="settings-hint" role="status">
            {cacheMessage}
          </p>
        )}
      </section>

      {hasKey && (
        <section class="settings-group">
          <h2>{strings.settingsKey}</h2>
          <div class="settings-card">
            <button type="button" class="settings-row action" onClick={onReplaceKey}>
              {strings.settingsReplaceKey}
            </button>
            <button type="button" class="settings-row action danger" onClick={removeKey}>
              {strings.settingsRemoveKey}
            </button>
          </div>
        </section>
      )}

      <section class="settings-group">
        <h2>{strings.settingsApp}</h2>
        <div class="settings-card">
          <div class="settings-row">
            <span>{strings.settingsVersion}</span>
            <span class="settings-value">{__APP_VERSION__}</span>
          </div>
          <label class="settings-row">
            <span>{strings.settingsDebug}</span>
            <input
              type="checkbox"
              class="switch"
              checked={debugOn}
              onChange={(e) => {
                onDebugChange(e.currentTarget.checked);
              }}
            />
          </label>
        </div>
      </section>
    </main>
  );
}
