// Binder (SPEC.md §6 screen 3): thumbnails grouped by section and ordered, promo group first (groupCards keeps
// the order of index.sections, so moving the promos elsewhere is a change in one place). Badges: immersive card;
// a cloud on cards whose 3D is not on the device while offline.
import { useEffect, useState } from 'preact/hooks';
import { groupCards } from '../data/binder';
import { cardFilePath, type CardIndex, type CardIndexEntry } from '../data/card-format';
import type { CardSource } from '../data/source';
import { CloudIcon, GearIcon, ImmersiveIcon } from './icons';
import { Marquee } from './marquee';
import { strings } from './strings';
import './binder.css';

interface Props {
  readonly index: CardIndex | null;
  readonly source: CardSource;
  /** Banner above the cards (new cards, offline, errors). */
  readonly notice: string | null;
  /** Base files download in progress. */
  readonly progress: readonly [number, number] | null;
  readonly offline: boolean;
  /** Cards whose 3D is fully on the device. */
  readonly with3d: ReadonlySet<string>;
  readonly onOpen: (entry: CardIndexEntry) => void;
  readonly onSettings: () => void;
  /** A card view covers the binder: not reachable by touch, focus or VoiceOver. */
  readonly covered?: boolean;
}

export function Binder(props: Props) {
  const { index, source, notice, progress, offline, with3d, onOpen, onSettings, covered = false } = props;
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
    <main class="binder" inert={covered} aria-hidden={covered ? 'true' : undefined}>
      <header class="binder-header">
        <div>
          <h1>{strings.appName}</h1>
          {index && <p class="binder-count">{strings.cardCount(index.cards.length)}</p>}
        </div>
        <button type="button" class="icon-button" aria-label={strings.settings} onClick={onSettings}>
          <GearIcon />
        </button>
      </header>
      {notice && <p class="banner">{notice}</p>}
      {progress && progress[0] < progress[1] && (
        <p class="binder-progress">{strings.downloadingCards(progress[0], progress[1])}</p>
      )}
      {!groups && !notice && <p class="binder-status">{strings.loadingCards}</p>}
      {groups?.map((group) => (
        <section key={group.section} class="binder-section">
          <h2>{strings.sectionTitle(group.section)}</h2>
          <div class="binder-grid">
            {group.cards.map((c) => (
              <button
                key={c.id}
                type="button"
                class="binder-card"
                data-card={c.id}
                onClick={() => {
                  onOpen(c);
                }}
              >
                <span class="binder-pocket">
                  <span class="binder-thumb">
                    {thumbs.get(c.id) && <img src={thumbs.get(c.id)} alt="" draggable={false} />}
                  </span>
                </span>
                <span class="binder-caption">
                  <span class="binder-number">{c.number}</span>
                  {offline && !with3d.has(c.id) && (
                    <span class="binder-badge cloud" title={strings.cloudBadgeLabel} data-badge="cloud">
                      <CloudIcon />
                    </span>
                  )}
                  {c.immersive && (
                    <span class="binder-badge immersive" title={strings.immersiveBadgeLabel}>
                      <ImmersiveIcon />
                    </span>
                  )}
                </span>
                <Marquee class="binder-name" text={c.name} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
