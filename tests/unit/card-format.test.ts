import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardFormatError, IMPLICIT_SET_ID, parseCard, parseCardIndex } from '../../src/data/card-format';

const v2 = 'tests/fixtures/cards-repo';
const v1 = 'tests/fixtures/cards-repo-v1';
const readJson = (repo: string, path: string): unknown => JSON.parse(readFileSync(`${repo}/${path}`, 'utf8'));
const clone = <T>(value: T): T => structuredClone(value);

function expectFormatError(fn: () => unknown, code: CardFormatError['code']): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CardFormatError);
    expect((error as CardFormatError).code).toBe(code);
    return;
  }
  throw new Error('expected a CardFormatError');
}

interface IndexJson {
  schema: number;
  sets: { id: string; cover: { path: string } | null; year: unknown }[];
  rarities: { id: string }[];
  cards: { id: string; path: string; set: string; rarity: string | null; extra?: unknown }[];
}

describe('parseCardIndex, schema 2', () => {
  it('reads expansions, rarities and the cards with their descriptive data', () => {
    const index = parseCardIndex(readJson(v2, 'index.json'));
    expect(index.schema).toBe(2);
    expect(index.sets.map((s) => [s.id, s.name, s.year])).toEqual([
      ['espansione-prova', 'Espansione di prova', 2026],
      ['seconda-espansione', 'Seconda espansione', null],
    ]);
    expect(index.sets[0]?.cover).toMatchObject({ path: 'sets/espansione-prova/cover.webp', size: [1536, 512] });
    expect(index.sets[1]?.cover).toBeNull();
    expect(index.rarities.map((r) => [r.id, r.symbol?.path ?? null])).toEqual([
      ['comune', null],
      ['rara', 'rarities/rara/symbol.webp'],
    ]);
    expect(index.cards.map((c) => [c.id, c.set, c.section, c.rarity, c.number])).toEqual([
      ['testcard-promo', 'espansione-prova', 'promo', null, '10-05-2026'],
      ['testcard', 'espansione-prova', 'main', 'rara', '1'],
      ['testcard-bis', 'seconda-espansione', 'main', 'comune', '2'],
    ]);
  });

  it('ignores keys it does not know (optional fields do not bump the schema)', () => {
    const json = clone(readJson(v2, 'index.json')) as IndexJson & { future?: unknown };
    json.future = { anything: true };
    json.cards[0]!.extra = 'new optional field';
    expect(parseCardIndex(json).cards).toHaveLength(3);
  });

  it('refuses an unknown schema, missing references and unexpected image paths', () => {
    const json = readJson(v2, 'index.json') as IndexJson;
    const schema = clone(json);
    schema.schema = 3;
    expectFormatError(() => parseCardIndex(schema), 'unsupported-schema');
    const set = clone(json);
    set.cards[0]!.set = 'missing';
    expectFormatError(() => parseCardIndex(set), 'invalid');
    const rarity = clone(json);
    rarity.cards[0]!.rarity = 'missing';
    expectFormatError(() => parseCardIndex(rarity), 'invalid');
    const cover = clone(json);
    cover.sets[0]!.cover!.path = '../../secret.webp';
    expectFormatError(() => parseCardIndex(cover), 'invalid');
    const duplicate = clone(json);
    duplicate.sets.push(clone(duplicate.sets[0]!));
    expectFormatError(() => parseCardIndex(duplicate), 'invalid');
    const path = clone(json);
    path.cards[0]!.path = '../secrets';
    expectFormatError(() => parseCardIndex(path), 'invalid');
  });
});

describe('parseCardIndex, schema 1 (transition)', () => {
  it('shows a schema 1 catalog as one expansion without year, cover or rarities', () => {
    const index = parseCardIndex(readJson(v1, 'index.json'));
    expect(index.schema).toBe(1);
    expect(index.sets).toEqual([{ id: IMPLICIT_SET_ID, name: '', order: 0, year: null, cover: null, symbol: null }]);
    expect(index.rarities).toEqual([]);
    expect(index.cards.map((c) => [c.id, c.set, c.rarity])).toEqual([
      ['testcard-promo', IMPLICIT_SET_ID, null],
      ['testcard', IMPLICIT_SET_ID, null],
    ]);
  });
});

describe('parseCard', () => {
  it('reads schema 2 card.json (rendering data only)', () => {
    const card = parseCard(readJson(v2, 'cards/testcard.card/card.json'));
    expect(card.schema).toBe(2);
    expect(card.artPx).toEqual([1164, 1600]);
    expect(card.layers).toHaveLength(6);
    expect(card.layers[1]?.kind).toBe('floor');
    expect(card.immersive?.poses).toHaveLength(451);
    expect('name' in card).toBe(false);
  });

  it('reads schema 1 card.json too (a device may still have it in its cache)', () => {
    const card = parseCard(readJson(v1, 'cards/testcard-promo.card/card.json'));
    expect(card.schema).toBe(1);
    expect(card.immersive).toBeNull();
    expect(card.images.front).toBeNull();
  });

  it('refuses an unknown schema, bad layer files and broken geometry', () => {
    const json = readJson(v2, 'cards/testcard.card/card.json') as {
      schema: number;
      layers: { file: string; quad: unknown[]; wrap: string[] }[];
    };
    const schema = clone(json);
    schema.schema = 3;
    expectFormatError(() => parseCard(schema), 'unsupported-schema');
    const file = clone(json);
    file.layers[0]!.file = '../../index.json';
    expectFormatError(() => parseCard(file), 'invalid');
    const quad = clone(json);
    quad.layers[0]!.quad = quad.layers[0]!.quad.slice(0, 3);
    expectFormatError(() => parseCard(quad), 'invalid');
    const wrap = clone(json);
    wrap.layers[0]!.wrap = ['repeat', 'clamp'];
    expectFormatError(() => parseCard(wrap), 'invalid');
  });
});
