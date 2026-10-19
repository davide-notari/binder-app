// Collection (home): one banner per expansion, newest first (SPEC.md §6, CARD_FORMAT.md §2). A cover of any shape
// keeps its shape (cropped in the middle only when taller than wide); without a cover a gradient with the
// expansion's symbol (or initials) stands in.
import { collectionSets } from '../data/binder';
import { IMPLICIT_SET_ID, type CardIndex, type CardSet } from '../data/card-format';
import type { CardSource } from '../data/source';
import { GearIcon } from './icons';
import { Marquee } from './marquee';
import { strings } from './strings';
import { useImageUrls } from './use-images';
import './collection.css';

interface Props {
  readonly index: CardIndex | null;
  readonly source: CardSource;
  readonly notice: string | null;
  readonly progress: readonly [number, number] | null;
  /** Cards that arrived with the last refresh. */
  readonly newIds: ReadonlySet<string>;
  /** A binder covers the collection: not reachable by touch, focus or VoiceOver. */
  readonly covered: boolean;
  readonly onOpenSet: (set: CardSet) => void;
  readonly onSettings: () => void;
}

/** Display name of an expansion (a schema 1 catalog has a single unnamed one). */
export function setName(set: CardSet): string {
  return set.id === IMPLICIT_SET_ID ? strings.implicitSetName : set.name;
}

function hue(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Collection(props: Props) {
  const { index, source, notice, progress, newIds, covered, onOpenSet, onSettings } = props;
  const sets = index ? collectionSets(index) : null;
  const images = useImageUrls(source, sets?.flatMap((s) => [s.cover, s.symbol]) ?? []);

  return (
    <div class="collection" inert={covered} aria-hidden={covered ? 'true' : undefined}>
      <main class="screen-scroll">
        <header class="binder-header">
          <div>
            <h1>{strings.appName}</h1>
            {sets && <p class="binder-count">{strings.expansionCount(sets.length)}</p>}
          </div>
          <button type="button" class="icon-button" aria-label={strings.settings} onClick={onSettings}>
            <GearIcon />
          </button>
        </header>
        {notice && <p class="banner">{notice}</p>}
        {progress && progress[0] < progress[1] && (
          <p class="binder-progress">{strings.downloadingCards(progress[0], progress[1])}</p>
        )}
        {!sets && !notice && <p class="binder-status">{strings.loadingCards}</p>}
        {sets?.length === 0 && <p class="binder-status">{strings.noExpansions}</p>}
        <div class="collection-list">
          {sets?.map((set) => {
            const cards = index?.cards.filter((c) => c.set === set.id) ?? [];
            const fresh = cards.filter((c) => newIds.has(c.id)).length;
            const coverUrl = set.cover ? images.get(set.cover.path) : undefined;
            const symbolUrl = set.symbol ? images.get(set.symbol.path) : undefined;
            const aspect = set.cover ? Math.max(1, set.cover.size[0] / set.cover.size[1]) : 3;
            const name = setName(set);
            const h = hue(set.id || name);
            return (
              <button
                key={set.id}
                type="button"
                class="collection-tile"
                data-set={set.id}
                onClick={() => {
                  onOpenSet(set);
                }}
              >
                <span class="collection-cover" style={{ aspectRatio: String(aspect) }}>
                  {coverUrl ? (
                    <img src={coverUrl} alt="" draggable={false} />
                  ) : (
                    <span
                      class="collection-placeholder"
                      style={{
                        background: `linear-gradient(135deg, hsl(${h} 35% 20%), hsl(${(h + 50) % 360} 45% 32%))`,
                      }}
                    >
                      {symbolUrl ? <img src={symbolUrl} alt="" draggable={false} /> : <span>{initials(name)}</span>}
                    </span>
                  )}
                </span>
                <span class="collection-info">
                  <span class="collection-title">
                    {symbolUrl && <img class="collection-symbol" src={symbolUrl} alt="" draggable={false} />}
                    <Marquee class="collection-name" text={name} />
                    {set.year !== null && <span class="collection-year">{set.year}</span>}
                  </span>
                  <span class="collection-meta">
                    {cards.length === 0 ? strings.emptySet : strings.cardCount(cards.length)}
                    {fresh > 0 && <span class="collection-new"> · {strings.newInSet(fresh)}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
