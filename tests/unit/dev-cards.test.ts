import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveInside } from '../../tools/dev-cards.ts';

const root = path.resolve('tests/fixtures/cards-repo');

describe('resolveInside', () => {
  it('maps card files inside the root', () => {
    expect(resolveInside(root, '/index.json')).toBe(path.join(root, 'index.json'));
    expect(resolveInside(root, '/cards/testcard.card/layers/full/01_sfondo.webp')).toBe(
      path.join(root, 'cards', 'testcard.card', 'layers', 'full', '01_sfondo.webp'),
    );
    expect(resolveInside(root, '/refs/testcard/f_0001.png')).toBe(path.join(root, 'refs', 'testcard', 'f_0001.png'));
  });

  it('rejects paths that leave the root', () => {
    expect(resolveInside(root, '/../package.json')).toBeNull();
    expect(resolveInside(root, '/%2e%2e/package.json')).toBeNull();
    expect(resolveInside(root, '/cards/%2e%2e/%2e%2e/%2e%2e/package.json')).toBeNull();
    expect(resolveInside(root, '/cards/..%2f..%2fpackage.json')).toBeNull();
    expect(resolveInside(root, '/..\\package.json')).toBeNull();
  });

  it('rejects hidden files, unknown types and malformed input', () => {
    expect(resolveInside(root, '/.git/config')).toBeNull();
    expect(resolveInside(root, '/.DS_Store')).toBeNull();
    expect(resolveInside(root, '/tools/export_card.py')).toBeNull();
    expect(resolveInside(root, '/')).toBeNull();
    expect(resolveInside(root, '/%E0%A4%A')).toBeNull();
    expect(resolveInside(root, '/index.json%00.webp')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('serves only card data types', () => {
    expect(contentTypeFor('a/card.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('a/THUMB.WEBP')).toBe('image/webp');
    expect(contentTypeFor('a/f_0001.png')).toBe('image/png');
    expect(contentTypeFor('a/script.py')).toBeNull();
  });
});
