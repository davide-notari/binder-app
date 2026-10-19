// Temporary binder for M2–M3: cards grouped by section with their thumbnails. The real binder grid arrives in M4.
import { useEffect, useState } from 'preact/hooks';
import { groupCards } from '../data/binder';
import { cardFilePath, type CardIndex, type CardIndexEntry } from '../data/card-format';
import type { CardSource } from '../data/source';
import { strings } from './strings';
import './card-list.css';

interface Props {
  readonly index: CardIndex | null;
  readonly source: CardSource;
  /** Banner above the cards (new cards, offline, errors). */
  readonly notice: string | null;
  readonly onOpen: (entry: CardIndexEntry) => void;
}

export function CardList({ index, source, notice, onOpen }: Props) {
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!index) return;
    const run = { cancelled: false };
    const isCancelled = () => run.cancelled; // read through a call: the flag changes while the work awaits
    const urls: string[] = [];
    void Promise.all(
      index.cards.map(async (c) => {
        try {
          const url = URL.createObjectURL(await source.fetchFile(cardFilePath(c.path, 'thumb.webp')));
          urls.push(url);
          if (!isCancelled()) setThumbs((old) => new Map(old).set(c.id, url));
        } catch {
          // offline and not cached yet: the card shows without thumbnail
        }
      }),
    );
    return () => {
      run.cancelled = true;
      urls.forEach((u) => {
        URL.revokeObjectURL(u);
      });
    };
  }, [index, source]);

  const groups = index ? groupCards(index) : null;
  return (
    <main class="card-list">
      <h1>{strings.appName}</h1>
      {notice && <p class="banner">{notice}</p>}
      {!groups && !notice && <p class="card-list-status">{strings.loadingCards}</p>}
      {groups?.map((group) => (
        <section key={group.section}>
          <h2>{strings.sectionTitle(group.section)}</h2>
          <div class="card-list-grid">
            {group.cards.map((c) => (
              <button
                key={c.id}
                type="button"
                class="card-list-item"
                data-card={c.id}
                onClick={() => {
                  onOpen(c);
                }}
              >
                <span class="card-list-thumb">
                  {thumbs.get(c.id) && <img src={thumbs.get(c.id)} alt="" draggable={false} />}
                  {c.immersive && <span class="card-list-badge">{strings.immersiveBadge}</span>}
                </span>
                <span class="card-list-number">{c.number}</span>
                <span class="card-list-name">{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
