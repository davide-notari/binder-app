import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { devStrings, strings } from './ui/strings';

// M0 placeholder screen. Real screens (binder, card view, settings) arrive in later milestones.
export function App() {
  if (import.meta.env.DEV) {
    const devPage = new URLSearchParams(location.search).get('dev');
    if (devPage) return <DevPageLoader page={devPage} />;
  }
  return (
    <main class="placeholder">
      <h1>{strings.appName}</h1>
      <p>{strings.underConstruction}</p>
      {import.meta.env.DEV && <DevCardsStatus />}
      <p class="version">{strings.version(__APP_VERSION__)}</p>
    </main>
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

// Development only: confirms that the dev server serves the local card repository.
function DevCardsStatus() {
  const [text, setText] = useState<string>(devStrings.cardsLoading);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}dev-cards/index.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const index = (await response.json()) as { cards?: unknown };
        if (!Array.isArray(index.cards)) throw new Error('index.json without cards');
        if (!cancelled) setText(devStrings.cardsFound(index.cards.length));
      })
      .catch((error: unknown) => {
        console.error('dev cards:', error);
        if (!cancelled) setText(devStrings.cardsError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <p data-testid="dev-cards-status">{text}</p>;
}
