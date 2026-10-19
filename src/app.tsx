import type { FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CardFormatError, type CardIndex, type CardIndexEntry } from './data/card-format';
import { GitHubSource } from './data/github-source';
import { clearToken, getToken, setToken } from './data/settings';
import { SourceError, type RemoteSource } from './data/source';
import { CardStore } from './data/store';
import { debugEnabled, reportDebugError, setDebugValue } from './debug/debug-store';
import { DebugOverlay } from './debug/overlay';
import { recoverAfterCrash } from './render/gpu-limit';
import { CardList } from './ui/card-list';
import { CardView } from './ui/card-view';
import { InstallScreen } from './ui/screens/install-screen';
import { KeyScreen, type KeyProblem } from './ui/screens/key-screen';
import { strings } from './ui/strings';
import { UpdateBanner } from './ui/update-banner';

recoverAfterCrash();

type Screen =
  | { readonly kind: 'boot' }
  | { readonly kind: 'install' }
  | { readonly kind: 'key'; readonly problem?: KeyProblem }
  | { readonly kind: 'binder' };

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
  const showDebug = debugEnabled();
  if (import.meta.env.DEV) {
    const devPage = new URLSearchParams(location.search).get('dev');
    if (devPage) return <DevPageLoader page={devPage} />;
  }
  return (
    <>
      <Binder />
      {!import.meta.env.DEV && <UpdateBanner />}
      {showDebug && <DebugOverlay />}
    </>
  );
}

function Binder() {
  const [screen, setScreen] = useState<Screen>({ kind: 'boot' });
  const [store, setStore] = useState<CardStore | null>(null);
  const [index, setIndex] = useState<CardIndex | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<CardIndexEntry | null>(null);
  const started = useRef(false);

  /** Refreshes the index from the network, then downloads the base files of every card (SPEC.md §5). */
  const refresh = useCallback(async (s: CardStore) => {
    try {
      const result = await s.refreshIndex();
      setDebugValue(
        'index',
        `${result.changed ? 'aggiornato' : 'invariato (304)'} · ${result.index.cards.length} carte`,
      );
      setIndex(result.index);
      setNotice(result.newCards > 0 ? strings.newCards(result.newCards) : null);
    } catch (error) {
      setDebugValue('index', error instanceof SourceError ? `errore: ${error.kind}` : 'errore');
      if (error instanceof SourceError && (error.kind === 'unauthorized' || error.kind === 'not-found')) {
        if (!(import.meta.env.DEV && usesLocalSource())) {
          await clearToken();
          setStore(null);
          setScreen({ kind: 'key', problem: error.kind === 'unauthorized' ? 'revoked' : 'no-access' });
          return;
        }
      }
      if (error instanceof SourceError && error.kind === 'network') {
        setNotice(s.currentIndex ? strings.offlineBinder : strings.firstStartOffline);
      } else if (error instanceof SourceError && error.kind === 'rate-limited') {
        setNotice(strings.rateLimited);
      } else if (error instanceof CardFormatError && error.code === 'unsupported-schema') {
        setNotice(strings.unsupportedSchema);
      } else {
        reportDebugError(String(error));
        if (!s.currentIndex) setNotice(strings.cardsError);
      }
      return;
    }
    const failures = await s.prefetchBase();
    if (failures > 0) reportDebugError(`prefetch: ${failures} file non scaricati`);
  }, []);

  /** Opens the binder on a source: cached index first (works offline), then the network refresh. */
  const start = useCallback(
    async (remote: RemoteSource) => {
      const s = new CardStore(remote);
      setStore(s);
      try {
        setIndex(await s.loadCachedIndex());
      } catch (error) {
        reportDebugError(`cached index: ${String(error)}`);
      }
      setScreen({ kind: 'binder' });
      await refresh(s);
    },
    [refresh],
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
  const submitKey = useCallback(async (key: string): Promise<KeyProblem | null> => {
    const s = new CardStore(new GitHubSource(key));
    try {
      const result = await s.refreshIndex();
      await setToken(key);
      void requestPersistentStorage();
      setStore(s);
      setIndex(result.index);
      setNotice(null);
      setScreen({ kind: 'binder' });
      void s.prefetchBase().catch((error: unknown) => {
        reportDebugError(`prefetch: ${String(error)}`);
      });
      return null;
    } catch (error) {
      return problemFor(error);
    }
  }, []);

  if (screen.kind === 'install') return <InstallScreen />;
  if (screen.kind === 'key') return <KeyScreen initialProblem={screen.problem} onSubmit={submitKey} />;
  if (screen.kind === 'boot' || !store) return null;
  if (open) {
    return (
      <CardView
        source={store}
        entry={open}
        onBack={() => {
          setOpen(null);
        }}
      />
    );
  }
  return (
    <CardList
      index={index}
      source={store}
      notice={notice}
      onOpen={(entry) => {
        void store.touch(entry);
        setOpen(entry);
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
