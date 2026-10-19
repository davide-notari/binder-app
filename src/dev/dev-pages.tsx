// Development pages, loaded only by the dev server (see app.tsx).
import { devStrings } from '../ui/strings';
import './dev.css';
import { PremultiplyPage } from './premultiply-page';
import { RenderPage } from './render-page';

export function DevPage({ page }: { page: string }) {
  switch (page) {
    case 'render':
      return <RenderPage />;
    case 'premultiply':
      return <PremultiplyPage />;
    default:
      return (
        <main class="dev-text">
          <p>{devStrings.unknownPage(page)}</p>
        </main>
      );
  }
}
