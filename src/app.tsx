import type { FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CardFormatError, type CardIndex, type CardIndexEntry } from './data/card-format';
import { GitHubSource } from './data/github-source';
import { clearToken, getToken, setToken } from './data/settings';
import { SourceError, type RemoteSource } from './data/source';
import { CardStore } from './data/store';
import { debugEnabled, reportDebugError, setDebugEnabled, setDebugValue } from './debug/debug-store';
import { DebugOverlay } from './debug/overlay';
import { recoverAfterCrash } from './render/gpu-limit';
import { Binder } from './ui/binder';
import { CardView } from './ui/card-view';
import { InstallScreen } from './ui/screens/install-screen';
import { KeyScreen, type KeyProblem } from './ui/screens/key-screen';
import { SettingsScreen } from './ui/screens/settings-screen';
import { strings } from './ui/strings';
import { UpdateBanner } from './ui/update-banner';

recoverAfterCrash();

type Screen =
  | { readonly kind: 'boot' }
  | { readonly kind: 'install' }
  | { readonly kind: 'key'; readonly problem?: KeyProblem; readonly replacing?: boolean }
  | { readonly kind: 'binder' }
  | { readonly kind: 'settings' };

/** Running from the Home Screen (SPEC.md §6 screen 1). */
function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/** ?browser=1 skips the installation screen (testing on a desktop browser); remembered for the session. */
function installBypassed(): boolean {
  try {
    if (new URLSearchParams(location.search).get('browser') === '1') sessionStorage.setItem('binder.browser', '1');
    return sessionStorage.getItem('binder.browser') === '1';
  } catch {
    return false;
  }
}

/** Development uses the local card repository unless ?source=github (always false in production builds). */
function usesLocalSource(): boolean {
  return new URLSearchParams(location.search).get('source') !== 'github';
}

function problemFor(error: unknown): KeyProblem {
  if (error instanceof SourceError) {
    if (error.kind === 'unauthorized') return 'invalid';
    if (error.kind === 'not-found') return 'no-access';
    if (error.kind === 'network') return 'offline';
    if (error.kind === 'rate-limited') return 'rate-limited';
  }
  return 'unexpected';
}

async function requestPersistentStorage(): Promise<void> {
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    setDebugValue('storage', persisted ? 'persistente' : 'non persistente');
  } catch {
    setDebugValue('storage', 'API non disponibile');
  }
}

export function App() {
  const [debugOn, setDebugOn] = useState(debugEnabled);
  if (import.meta.env.DEV) {
    const devPage = new URLSearchParams(location.search).get('dev');
    if (devPage) return <DevPageLoader page={devPage} />;
  }
  return (
    <>
      <AppFlow
        debugOn={debugOn}
        onDebugChange={(on) => {
          setDebugEnabled(on);
          setDebugOn(on);
        }}
      />
      {!import.meta.env.DEV && <UpdateBanner />}
      {debugOn && <DebugOverlay />}
    </>
  );
}

/** navigator.onLine, kept up to date. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

interface FlowProps {
  readonly debugOn: boolean;
  readonly onDebugChange: (on: boolean) => void;
}

function AppFlow({ debugOn, onDebugChange }: FlowProps) {
  const [screen, setScreen] = useState<Screen>({ kind: 'boot' });
  const [store, setStore] = useState<CardStore | null>(null);
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<CardIndexEntry | null>(null);
  const [progress, setProgress] = useState<readonly [number, number] | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [with3d, setWith3d] = useState<ReadonlySet<string>>(new Set());
  const online = useOnline();
  const started = useRef(false);
  const local = import.meta.env.DEV && usesLocalSource();

  const update3d = useCallback(async (s: CardStore) => {
    setWith3d(await s.cardsWith3d());
  }, []);

  /**
   * Refreshes the index from the network, then downloads the base files of every card (SPEC.md §5).
   * Resolves with a short message for the settings screen.
   */
  const refresh = useCallback(
    async (s: CardStore): Promise<string> => {
      let message: string;
      try {
        const result = await s.refreshIndex();
        setDebugValue(
          'index',
          `${result.changed ? 'aggiornato' : 'invariato (304)'} · ${result.index.cards.length} carte`,
        );
        setIndex(result.index);
        setNetworkFailed(false);
        message = result.newCards > 0 ? strings.newCards(result.newCards) : strings.settingsUpToDate;
        setNotice(result.newCards > 0 ? message : null);
      } catch (error) {
        setDebugValue('index', error instanceof SourceError ? `errore: ${error.kind}` : 'errore');
        if (error instanceof SourceError && (error.kind === 'unauthorized' || error.kind === 'not-found') && !local) {
          await clearToken();
          setStore(null);
          setOpen(null);
          setScreen({ kind: 'key', problem: error.kind === 'unauthorized' ? 'revoked' : 'no-access' });
          return strings.keyRevoked;
        }
        if (error instanceof SourceError && error.kind === 'network') {
          setNetworkFailed(true);
          message = s.currentIndex ? strings.offlineBinder : strings.firstStartOffline;
        } else if (error instanceof SourceError && error.kind === 'rate-limited') {
          message = strings.rateLimited;
        } else if (error instanceof CardFormatError && error.code === 'unsupported-schema') {
          message = strings.unsupportedSchema;
        } else {
          reportDebugError(String(error));
          message = strings.cardsError;
          if (s.currentIndex) {
            await update3d(s);
            return message;
          }
        }
        setNotice(message);
        await update3d(s);
        return message;
      }
      await update3d(s);
      const failures = await s.prefetchBase((done, total) => {
        setProgress([done, total]);
      });
      setProgress(null);
      if (failures > 0) reportDebugError(`prefetch: ${failures} file non scaricati`);
      return message;
    },
    [local, update3d],
  );

  /** Opens the binder on a source: cached index first (works offline), then the network refresh. */
  const start = useCallback(
    async (remote: RemoteSource) => {
      const s = new CardStore(remote);
      setStore(s);
      try {
        setIndex(await s.loadCachedIndex());
        await update3d(s);
      } catch (error) {
        reportDebugError(`cached index: ${String(error)}`);
      }
      setScreen({ kind: 'binder' });
      await refresh(s);
    },
    [refresh, update3d],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // `import.meta.env.DEV &&` first: production builds drop this branch and the local source entirely
      if (import.meta.env.DEV && usesLocalSource()) {
        const { LocalSource } = await import('./data/local-source');
        await start(new LocalSource());
        return;
      }
      if (!isStandalone() && !installBypassed()) {
        setScreen({ kind: 'install' });
        return;
      }
      const token = await getToken();
      if (!token) {
        setScreen({ kind: 'key' });
        return;
      }
      void requestPersistentStorage();
      await start(new GitHubSource(token));
    })();
  }, [start]);

  /** Key screen: the key is valid when index.json can be read with it; only then it is stored. */
  const submitKey = useCallback(
    async (key: string): Promise<KeyProblem | null> => {
      const s = new CardStore(new GitHubSource(key));
      try {
        await s.loadCachedIndex().catch(() => null); // keeps "new cards" and the cache in step with the device
        await s.refreshIndex();
      } catch (error) {
        return problemFor(error);
      }
      await setToken(key);
      void requestPersistentStorage();
      setStore(s);
      setNotice(null);
      setScreen({ kind: 'binder' });
      void refresh(s);
      return null;
    },
    [refresh],
  );

  if (screen.kind === 'install') return <InstallScreen />;
  if (screen.kind === 'key') {
    return (
      <KeyScreen
        initialProblem={screen.problem}
        onSubmit={submitKey}
        onCancel={
          screen.replacing
            ? () => {
                setScreen({ kind: 'settings' });
              }
            : undefined
        }
      />
    );
  }
  if (screen.kind === 'boot' || !store) return null;
  if (screen.kind === 'settings') {
    return (
      <SettingsScreen
        store={store}
        hasKey={!local}
        debugOn={debugOn}
        onBack={() => {
          setScreen({ kind: 'binder' });
        }}
        onCheckUpdates={async () => {
          void navigator.serviceWorker.getRegistration().then((r) => r?.update().catch(() => undefined));
          return refresh(store);
        }}
        onReplaceKey={() => {
          setScreen({ kind: 'key', replacing: true });
        }}
        onRemoveKey={() => {
          void clearToken().then(() => {
            setStore(null);
            setScreen({ kind: 'key' });
          });
        }}
        onDebugChange={onDebugChange}
        on3dChanged={() => void update3d(store)}
      />
    );
  }
  if (open) {
    return (
      <CardView
        source={store}
        entry={open}
        onLayersReady={(resolution) => {
          void store.markLayersComplete(open, resolution).then(() => update3d(store));
        }}
        onBack={() => {
          setOpen(null);
        }}
      />
    );
  }
  return (
    <Binder
      index={index}
      source={store}
      notice={notice}
      progress={progress}
      offline={!online || networkFailed}
      with3d={with3d}
      onOpen={(entry) => {
        void store.touch(entry);
        setOpen(entry);
      }}
      onSettings={() => {
        setScreen({ kind: 'settings' });
      }}
    />
  );
}

// Development only: /?dev=<page> (dev/dev-pages.tsx). The dynamic import keeps them out of production builds.
function DevPageLoader({ page }: { page: string }) {
  const [Page, setPage] = useState<FunctionComponent<{ page: string }> | null>(null);
  useEffect(() => {
    void import('./dev/dev-pages').then((m) => {
      setPage(() => m.DevPage);
    });
  }, []);
  return Page ? <Page page={page} /> : null;
}
