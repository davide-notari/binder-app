// Binder of one expansion (SPEC.md §6 screen 3): thumbnails grouped by section and ordered, promo cards on top.
// It lies over the collection and goes back to it with the back button or a swipe from the left edge.
// Badges next to the number: rarity symbol, immersive card, and (offline) a cloud on cards whose 3D is missing.
import { useEffect, useRef, useState } from 'preact/hooks';
import { groupCards } from '../data/binder';
import { cardFilePath, type CardIndex, type CardIndexEntry, type CardSet } from '../data/card-format';
import type { CardSource } from '../data/source';
import { useCardGestures } from './card-gestures';
import { setName } from './collection';
import { ChevronLeftIcon, CloudIcon, GearIcon, ImmersiveIcon } from './icons';
import { Marquee } from './marquee';
import { strings } from './strings';
import { useImageUrls } from './use-images';
import './binder.css';

interface Props {
  readonly index: CardIndex;
  readonly set: CardSet;
  readonly source: CardSource;
  readonly notice: string | null;
  readonly offline: boolean;
  /** Cards whose 3D is fully on the device. */
  readonly with3d: ReadonlySet<string>;
  /** A card view covers the binder: not reachable by touch, focus or VoiceOver. */
  readonly covered: boolean;
  readonly onOpen: (entry: CardIndexEntry) => void;
  readonly onSettings: () => void;
  readonly onBack: () => void;
}

export function Binder(props: Props) {
  const { index, set, source, notice, offline, with3d, covered, onOpen, onSettings, onBack } = props;
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);
  const gestures = useCardGestures({
    rootRef,
    stageRef: null,
    revealVar: '--collection-reveal',
    enabled: !covered,
    onBack,
  });
  const cards = index.cards.filter((c) => c.set === set.id);
  const rarities = new Map(index.rarities.map((r) => [r.id, r]));
  const images = useImageUrls(source, [set.symbol, ...index.rarities.map((r) => r.symbol)]);
  const cardKey = cards.map((c) => `${c.id}@${c.version}`).join('|');

  useEffect(() => {
    const run = { cancelled: false };
    const isCancelled = () => run.cancelled; // read through a call: the flag changes while the work awaits
    const urls: string[] = [];
    void Promise.all(
      cards.map(async (c) => {
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
  }, [cardKey, source]); // `cardKey` stands for the cards of this expansion

  const groups = groupCards(index, set.id);
  const symbolUrl = set.symbol ? images.get(set.symbol.path) : undefined;
  return (
    <div
      ref={rootRef}
      class="binder push-in"
      inert={covered}
      aria-hidden={covered ? 'true' : undefined}
      {...gestures.handlers}
    >
      <main class="screen-scroll">
        <div class="screen-topbar">
          <button type="button" class="bar-back" onClick={gestures.animateBack}>
            <ChevronLeftIcon />
            <span>{strings.back}</span>
          </button>
          <button type="button" class="icon-button" aria-label={strings.settings} onClick={onSettings}>
            <GearIcon />
          </button>
        </div>
        <header class="binder-header">
          <div class="binder-heading">
            <h1 class="binder-title">
              {symbolUrl && <img class="binder-set-symbol" src={symbolUrl} alt="" draggable={false} />}
              <Marquee text={setName(set)} />
            </h1>
            <p class="binder-count">
              {set.year !== null && `${set.year} · `}
              {cards.length === 0 ? strings.emptySet : strings.cardCount(cards.length)}
            </p>
          </div>
        </header>
        {notice && <p class="banner">{notice}</p>}
        {groups.map((group) => (
          <section key={group.section} class="binder-section">
            <h2>{strings.sectionTitle(group.section)}</h2>
            <div class="binder-grid">
              {group.cards.map((c) => {
                const rarity = c.rarity ? rarities.get(c.rarity) : undefined;
                const raritySymbol = rarity?.symbol ? images.get(rarity.symbol.path) : undefined;
                return (
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
                      {raritySymbol && rarity && (
                        <img class="binder-rarity" src={raritySymbol} alt={rarity.name} title={rarity.name} />
                      )}
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
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
