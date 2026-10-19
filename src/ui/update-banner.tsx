// "Nuova versione disponibile — tocca per aggiornare" (SPEC.md §5): the service worker (vite-plugin-pwa, prompt
// mode) waits until the user taps. Checks again whenever the app comes back to the foreground.
import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { strings } from './strings';

export function UpdateBanner() {
  const [apply, setApply] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setApply(() => () => updateSW(true));
      },
      onRegisteredSW(_url, r) {
        registration = r;
      },
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!apply) return null;
  return (
    <button type="button" class="banner update" onClick={() => void apply()}>
      {strings.updateAvailable}
    </button>
  );
}
