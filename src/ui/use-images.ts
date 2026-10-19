// Object URLs for catalog images (expansion covers and symbols, rarity symbols), read through the card store
// (cached and versioned there). Revoked when the images change or the component goes away.
import { useEffect, useState } from 'preact/hooks';
import type { ImageRef } from '../data/card-format';
import type { CardSource } from '../data/source';

export function useImageUrls(source: CardSource, images: readonly (ImageRef | null)[]): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const wanted = images.filter((i): i is ImageRef => i !== null);
  const key = wanted.map((i) => `${i.version}/${i.path}`).join('|');

  // `key` stands for the list of images: the effect runs again only when an image changes
  useEffect(() => {
    const run = { cancelled: false };
    const isCancelled = () => run.cancelled; // read through a call: the flag changes while the work awaits
    const created: string[] = [];
    setUrls(new Map());
    void Promise.all(
      wanted.map(async (image) => {
        try {
          const url = URL.createObjectURL(await source.fetchFile(image.path));
          created.push(url);
          if (!isCancelled()) setUrls((old) => new Map(old).set(image.path, url));
        } catch {
          // offline and not cached yet: the placeholder stays
        }
      }),
    );
    return () => {
      run.cancelled = true;
      created.forEach((u) => {
        URL.revokeObjectURL(u);
      });
    };
  }, [source, key]);

  return urls;
}
