import { describe, expect, it } from 'vitest';
import { binderSequence, collectionSets, groupCards } from '../../src/data/binder';
import type { CardIndex, CardIndexEntry } from '../../src/data/card-format';
import { Transition, easeInOut } from '../../src/interaction/motion';
import { TiltInput, DEFAULT_TILT_SETTINGS } from '../../src/interaction/tilt';
import { nextMode, type CardEvent, type CardMode } from '../../src/ui/card-view-state';

describe('card view state machine (SPEC §6)', () => {
  const run = (start: CardMode, ...events: CardEvent[]) => events.reduce(nextMode, start);

  it('follows the transitions of the table', () => {
    expect(run('card', { type: 'mode' })).toBe('artwork-flat');
    expect(run('artwork-flat', { type: 'mode' })).toBe('card');
    expect(run('artwork-flat', { type: '3d-on' })).toBe('artwork-tilt');
    expect(run('artwork-tilt', { type: '3d-off' })).toBe('artwork-flat');
    expect(run('artwork-tilt', { type: 'mode' })).toBe('card');
    expect(run('artwork-flat', { type: 'long-press', immersiveReady: true })).toBe('immersive');
    expect(run('immersive', { type: 'immersive-end' })).toBe('artwork-flat');
  });

  it('ignores events that do not apply', () => {
    expect(run('artwork-flat', { type: 'long-press', immersiveReady: false })).toBe('artwork-flat');
    expect(run('artwork-tilt', { type: 'long-press', immersiveReady: true })).toBe('artwork-tilt');
    expect(run('card', { type: '3d-on' })).toBe('card');
    expect(run('immersive', { type: 'mode' }, { type: '3d-on' })).toBe('immersive');
  });
});

describe('groupCards', () => {
  const entry = (id: string, section: string, order: number, set = 'a'): CardIndexEntry => ({
    id,
    name: id,
    number: String(order),
    set,
    section,
    order,
    rarity: null,
    version: 'v',
    path: `cards/${id}.card`,
    immersive: false,
    hasFront: false,
    bytes: { base: 0, full: 0, half: 0 },
  });

  it('orders sections as listed, then unknown ones, and cards by order then id', () => {
    const set = (id: string, order: number) => ({ id, name: id, order, year: null, cover: null, symbol: null });
    const index: CardIndex = {
      schema: 2,
      sets: [set('a', 1), set('b', 2), set('c', 1)],
      rarities: [],
      sections: ['promo', 'main'],
      cards: [
        entry('b', 'main', 2),
        entry('x', 'future', 1),
        entry('a', 'main', 2),
        entry('p', 'promo', 20260510),
        entry('c', 'main', 1.5),
        entry('other', 'main', 1, 'b'),
      ],
    };
    expect(groupCards(index, 'a').map((g) => [g.section, g.cards.map((c) => c.id)])).toEqual([
      ['promo', ['p']],
      ['main', ['c', 'a', 'b']],
      ['future', ['x']],
    ]);
    expect(binderSequence(index, 'a').map((c) => c.id)).toEqual(['p', 'c', 'a', 'b', 'x']);
    expect(binderSequence(index, 'b').map((c) => c.id)).toEqual(['other']);
    // newest expansion first
    expect(collectionSets(index).map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('tilt input (RENDERING §5.2)', () => {
  it('starts centred on the first orientation, clamps at MAX_ANGLE and smooths', () => {
    const tilt = new TiltInput(DEFAULT_TILT_SETTINGS);
    tilt.feed(45, 0); // neutral reference
    tilt.update(0);
    tilt.feed(45, 50); // tilt right beyond MAX_ANGLE (25°)
    let offset = tilt.update(16);
    expect(offset.x).toBeGreaterThan(0);
    expect(offset.x).toBeLessThan(0.5); // smoothed, not instant
    for (let t = 32; t <= 1000; t += 16) offset = tilt.update(t);
    expect(offset.x).toBeGreaterThan(0.9);
    expect(offset.x).toBeLessThanOrEqual(1);
    expect(Math.abs(offset.y)).toBeLessThan(1e-9);
  });

  it('recentres slowly when the phone stays tilted', () => {
    const tilt = new TiltInput(DEFAULT_TILT_SETTINGS);
    tilt.feed(45, 0);
    tilt.update(0);
    tilt.feed(45, 10);
    let x = 0;
    for (let t = 16; t <= 20000; t += 16) x = tilt.update(t).x;
    expect(x).toBeLessThan(0.02);
  });

  it('honours inverted axes and the vertical direction', () => {
    const tilt = new TiltInput({ ...DEFAULT_TILT_SETTINGS, invertX: true });
    tilt.feed(45, 0);
    tilt.update(0);
    tilt.feed(35, 10); // top edge away, phone tilted right
    let offset = { x: 0, y: 0 };
    for (let t = 16; t <= 500; t += 16) offset = tilt.update(t);
    expect(offset.x).toBeLessThan(0);
    expect(offset.y).toBeGreaterThan(0);
  });
});

describe('transition', () => {
  it('eases between values over its duration', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    const tr = new Transition(350);
    tr.reset(0);
    tr.set(1, 1000);
    expect(tr.value(1000)).toBe(0);
    expect(tr.value(1175)).toBeCloseTo(0.5, 12);
    expect(tr.value(1350)).toBe(1);
    expect(tr.done(1349)).toBe(false);
    expect(tr.done(1350)).toBe(true);
  });
});
