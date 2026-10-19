// Grouping of the cards for the binder (SPEC.md §6 screen 3, CARD_FORMAT.md §2).
import type { CardIndex, CardIndexEntry } from './card-format';

export interface CardGroup {
  readonly section: string;
  readonly cards: readonly CardIndexEntry[];
}

/**
 * Cards grouped by section, sections in `index.sections` order followed by unknown ones (never dropped),
 * each group sorted by `order`, then `id`. Where the promo group is shown is decided by the UI: v1 puts it
 * first, which is the order of `index.sections` today.
 */
export function groupCards(index: CardIndex): CardGroup[] {
  const known = [...index.sections];
  const unknown = [...new Set(index.cards.map((c) => c.section).filter((s) => !known.includes(s)))].sort();
  return [...known, ...unknown]
    .map((section) => ({
      section,
      cards: index.cards
        .filter((c) => c.section === section)
        .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }))
    .filter((g) => g.cards.length > 0);
}
