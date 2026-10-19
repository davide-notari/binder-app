import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardFormatError, parseCard, parseCardIndex } from '../../src/data/card-format';

const repo = 'tests/fixtures/cards-repo';
const readJson = (path: string): unknown => JSON.parse(readFileSync(`${repo}/${path}`, 'utf8'));
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

describe('parseCardIndex', () => {
  it('reads the fixture index', () => {
    const index = parseCardIndex(readJson('index.json'));
    expect(index.sections).toEqual(['promo', 'main']);
    expect(index.cards.map((c) => c.id)).toEqual(['testcard-promo', 'testcard']);
    expect(index.cards[0]?.number).toBe('10-05-2026');
    expect(index.cards[1]?.bytes.full).toBe(27200);
  });

  it('refuses an unknown schema', () => {
    const json = clone(readJson('index.json')) as { schema: number };
    json.schema = 2;
    expectFormatError(() => parseCardIndex(json), 'unsupported-schema');
  });

  it('refuses unsafe paths and ids', () => {
    const json = clone(readJson('index.json')) as { cards: { path: string; id: string }[] };
    const bad = clone(json);
    bad.cards[0]!.path = '../secrets';
    expectFormatError(() => parseCardIndex(bad), 'invalid');
    const badId = clone(json);
    badId.cards[0]!.id = 'Bad Id';
    expectFormatError(() => parseCardIndex(badId), 'invalid');
  });

  it('keeps unknown sections', () => {
    const json = clone(readJson('index.json')) as { cards: { section: string }[] };
    json.cards[0]!.section = 'future';
    expect(parseCardIndex(json).cards[0]?.section).toBe('future');
  });
});

describe('parseCard', () => {
  it('reads the immersive test card', () => {
    const card = parseCard(readJson('cards/testcard.card/card.json'));
    expect(card.artPx).toEqual([1164, 1600]);
    expect(card.layers).toHaveLength(6);
    expect(card.layers[1]?.kind).toBe('floor');
    expect(card.layers[1]?.depth).toBeNull();
    expect(card.layers[0]?.wrap).toEqual(['mirror', 'mirror']);
    expect(card.immersive?.poses).toHaveLength(451);
    expect(card.images.front).toBe('front.webp');
  });

  it('reads the tilt-only promo card without front image', () => {
    const card = parseCard(readJson('cards/testcard-promo.card/card.json'));
    expect(card.immersive).toBeNull();
    expect(card.images.front).toBeNull();
    expect(card.images.frontSize).toBeNull();
  });

  it('refuses an unknown schema, bad layer files and broken geometry', () => {
    const json = readJson('cards/testcard.card/card.json') as {
      schema: number;
      layers: { file: string; quad: unknown[]; wrap: string[] }[];
    };
    const schema = clone(json);
    schema.schema = 2;
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
