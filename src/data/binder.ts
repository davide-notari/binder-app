// Ordering of the collection and of a binder (SPEC.md §6, CARD_FORMAT.md §2). The data gives the order of the
// expansions (`order`) and of the cards inside a section; where things go on screen is decided here.
import type { CardIndex, CardIndexEntry, CardSet } from './card-format';

export interface CardGroup {
  readonly section: string;
  readonly cards: readonly CardIndexEntry[];
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Expansions of the collection, newest first (highest `order` first), then by id. */
export function collectionSets(index: CardIndex): CardSet[] {
  return [...index.sets].sort((a, b) => b.order - a.order || byId(a, b));
}

/**
 * Cards of one expansion grouped by section: sections in `index.sections` order (promo first: the promo cards sit
 * on top of the binder) followed by unknown ones (never dropped), each group sorted by `order`, then `id`.
 */
export function groupCards(index: CardIndex, setId: string): CardGroup[] {
  const cards = index.cards.filter((c) => c.set === setId);
  const known = [...index.sections];
  const unknown = [...new Set(cards.map((c) => c.section).filter((s) => !known.includes(s)))].sort();
  return [...known, ...unknown]
    .map((section) => ({
      section,
      cards: cards.filter((c) => c.section === section).sort((a, b) => a.order - b.order || byId(a, b)),
    }))
    .filter((g) => g.cards.length > 0);
}

/** The cards of an expansion in binder order (swiping between cards stays inside the expansion). */
export function binderSequence(index: CardIndex, setId: string): CardIndexEntry[] {
  return groupCards(index, setId).flatMap((g) => g.cards);
}
