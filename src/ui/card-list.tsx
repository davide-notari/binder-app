// Temporary card picker for M2 (development, local source). The real binder grid arrives in M4.
import { useEffect, useState } from 'preact/hooks';
import { groupCards, type CardGroup } from '../data/binder';
import { cardFilePath, type CardIndexEntry } from '../data/card-format';
import { fetchCardIndex, type CardSource } from '../data/source';
import { strings } from './strings';
import './card-list.css';

interface Props {
  readonly source: CardSource;
  readonly onOpen: (entry: CardIndexEntry) => void;
}

export function CardList({ source, onOpen }: Props) {
  const [groups, setGroups] = useState<CardGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    const run = { cancelled: false };
    const isCancelled = () => run.cancelled; // read through a call: the flag changes while the work awaits
    const urls: string[] = [];
    fetchCardIndex(source)
      .then(async (index) => {
        if (isCancelled()) return;
        const grouped = groupCards(index);
        setGroups(grouped);
        const entries = await Promise.all(
          index.cards.map(async (c) => {
            const url = URL.createObjectURL(await source.fetchFile(cardFilePath(c.path, 'thumb.webp')));
            urls.push(url);
            return [c.id, url] as const;
          }),
        );
        if (!isCancelled()) setThumbs(new Map(entries));
      })
      .catch((error: unknown) => {
        console.error('card list:', error);
        if (!isCancelled()) setFailed(true);
      });
    return () => {
      run.cancelled = true;
      urls.forEach((u) => {
        URL.revokeObjectURL(u);
      });
    };
  }, [source]);

  return (
    <main class="card-list">
      <h1>{strings.appName}</h1>
      {failed && <p class="card-list-status">{strings.cardsError}</p>}
      {!groups && !failed && <p class="card-list-status">{strings.loadingCards}</p>}
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
