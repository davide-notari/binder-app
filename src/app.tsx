import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CardIndexEntry } from './data/card-format';
import type { CardSource } from './data/source';
import { debugEnabled } from './debug/debug-store';
import { DebugOverlay } from './debug/overlay';
import { recoverAfterCrash } from './render/gpu-limit';
import { CardList } from './ui/card-list';
import { CardView } from './ui/card-view';
import { strings } from './ui/strings';

recoverAfterCrash();

export function App() {
  const showDebug = debugEnabled();
  if (import.meta.env.DEV) {
    const devPage = new URLSearchParams(location.search).get('dev');
    if (devPage) return <DevPageLoader page={devPage} />;
    return (
      <>
        <LocalBinder />
        {showDebug && <DebugOverlay />}
      </>
    );
  }
  // Until M3 (GitHub source and key screen) the published app is a placeholder.
  return (
    <main class="placeholder">
      <h1>{strings.appName}</h1>
      <p>{strings.underConstruction}</p>
      <p class="version">{strings.version(__APP_VERSION__)}</p>
    </main>
  );
}

// Development: binder and card view on the local card repository (dev/local-source.ts via dynamic import).
function LocalBinder() {
  const [source, setSource] = useState<CardSource | null>(null);
  const [open, setOpen] = useState<CardIndexEntry | null>(null);
  useEffect(() => {
    void import('./data/local-source').then((m) => {
      setSource(new m.LocalSource());
    });
  }, []);
  if (!source) return null;
  return open ? (
    <CardView
      source={source}
      entry={open}
      onBack={() => {
        setOpen(null);
      }}
    />
  ) : (
    <CardList source={source} onOpen={setOpen} />
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
