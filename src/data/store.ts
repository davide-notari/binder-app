// Card data on the device (SPEC.md §5): index refresh with ETag, version invalidation, base prefetch,
// on-demand layers with an LRU size limit. Files live in the Cache API under version-specific keys: card files in
// …/__cards/<id>/<version>/<file>, catalog images (expansion covers and symbols, rarity symbols) in their own key
// space …/__assets/<version>/<path> (their ids could equal a card id). The index and the LRU bookkeeping live in
// IndexedDB. The service worker never touches this cache: versions and eviction stay under the app's control.
import {
  layerFilePath,
  parseCardIndex,
  type CardIndex,
  type CardIndexEntry,
  type ImageRef,
  type TextureResolution,
} from './card-format';
import { idbDelete, idbEntries, idbGet, idbSet } from './idb';
import { getCachedIndex, getLayerCacheLimit, setCachedIndex } from './settings';
import { fetchCard, type CardSource, type RemoteSource } from './source';

const CACHE_NAME = 'binder-cards-v1';
const CARD_PREFIX = '__cards/';
const ASSET_PREFIX = '__assets/';
const BASE_FILES = ['card.json', 'thumb.webp', 'artwork.webp'] as const;
const PREFETCH_CONCURRENCY = 3;

interface LayerRecord {
  readonly version: string;
  readonly bytes: number;
  readonly lastUsed: number;
  /** Resolutions whose layer files are all cached (the 3D works offline). */
  readonly complete?: readonly TextureResolution[];
}

export interface RefreshResult {
  readonly index: CardIndex;
  /** Cards that were not in the previous index (0 on the first start). */
  readonly newCards: number;
  /** Their ids (for the "N carte nuove" badge of each expansion). */
  readonly newCardIds: readonly string[];
  /** False when the server answered "not modified". */
  readonly changed: boolean;
}

function keyRoot(prefix: string): string {
  return new URL(`${import.meta.env.BASE_URL}${prefix}`, location.origin).href;
}

function cacheKey(entry: CardIndexEntry, file: string): string {
  return `${keyRoot(CARD_PREFIX)}${entry.id}/${entry.version}/${file}`;
}

function assetKey(image: ImageRef): string {
  return `${keyRoot(ASSET_PREFIX)}${image.version}/${image.path}`;
}

type ParsedKey =
  | { readonly kind: 'card'; readonly id: string; readonly version: string; readonly file: string }
  | { readonly kind: 'asset'; readonly version: string; readonly path: string };

/** What a cache key stores, or null for anything else. */
function parseKey(url: string): ParsedKey | null {
  const cards = keyRoot(CARD_PREFIX);
  if (url.startsWith(cards)) {
    const [id, version, ...file] = url.slice(cards.length).split('/');
    return id && version && file.length > 0 ? { kind: 'card', id, version, file: file.join('/') } : null;
  }
  const assets = keyRoot(ASSET_PREFIX);
  if (url.startsWith(assets)) {
    const [version, ...path] = url.slice(assets.length).split('/');
    return version && path.length > 0 ? { kind: 'asset', version, path: path.join('/') } : null;
  }
  return null;
}

/** Every image of the catalog (covers and symbols of the expansions, symbols of the rarities). */
export function catalogImages(index: CardIndex): ImageRef[] {
  return [...index.sets.flatMap((s) => [s.cover, s.symbol]), ...index.rarities.map((r) => r.symbol)].filter(
    (image): image is ImageRef => image !== null,
  );
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: 'application/json',
  webp: 'image/webp',
  png: 'image/png',
};

function typed(blob: Blob, file: string): Blob {
  const type = CONTENT_TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';
  return blob.type === type ? blob : new Blob([blob], { type });
}

export class CardStore implements CardSource {
  private index: CardIndex | null = null;
  /** Downloads in progress, by cache key: concurrent requests for one file share a single download. */
  private readonly inflight = new Map<string, Promise<Blob>>();

  constructor(private readonly remote: RemoteSource) {}

  get currentIndex(): CardIndex | null {
    return this.index;
  }

  /** The index saved by the last successful refresh (offline start); null on the first start. */
  async loadCachedIndex(): Promise<CardIndex | null> {
    const cached = await getCachedIndex();
    if (!cached) return null;
    this.index = parseCardIndex(cached.json);
    return this.index;
  }

  /**
   * Downloads index.json if it changed (ETag), then deletes the cached files of versions and cards that are
   * no longer listed. Throws SourceError (unauthorized, not-found, rate-limited, network) or CardFormatError.
   */
  async refreshIndex(): Promise<RefreshResult> {
    const cached = await getCachedIndex();
    const result = await this.remote.fetchIfChanged('index.json', this.index && cached ? cached.etag : null);
    if (!result.changed && this.index) return { index: this.index, newCards: 0, newCardIds: [], changed: false };
    if (!result.changed) throw new Error('index not modified but not cached');
    const json = JSON.parse(await result.blob.text()) as unknown;
    const index = parseCardIndex(json);
    const previous = this.index;
    const newCardIds = previous
      ? index.cards.filter((c) => !previous.cards.some((p) => p.id === c.id)).map((c) => c.id)
      : [];
    await setCachedIndex({ json, etag: result.etag });
    this.index = index;
    await this.prune(index);
    return { index, newCards: newCardIds.length, newCardIds, changed: true };
  }

  /**
   * Downloads the base files of every card that are not cached yet, so the binder works offline. A file that
   * cannot be downloaded is skipped (it is retried at the next start); resolves with the number of failures.
   */
  async prefetchBase(onProgress?: (done: number, total: number) => void): Promise<number> {
    const index = this.index;
    if (!index) return 0;
    let failures = 0;
    const jobs = [
      ...catalogImages(index).map((image) => ({ path: image.path, cached: () => this.isAssetCached(image) })),
      ...index.cards.flatMap((card) =>
        [...BASE_FILES, ...(card.hasFront ? ['front.webp'] : [])].map((file) => ({
          path: `${card.path}/${file}`,
          cached: () => this.isCached(card, file),
        })),
      ),
    ];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (!job) break;
        try {
          if (!(await job.cached())) await this.fetchFile(job.path);
        } catch {
          failures++;
        }
        onProgress?.(++done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: PREFETCH_CONCURRENCY }, worker));
    return failures;
  }

  /**
   * A file of the card repository: from the cache when this version has it, otherwise downloaded and cached.
   * Card files are versioned by their card, catalog images by their own version.
   */
  async fetchFile(path: string, signal?: AbortSignal): Promise<Blob> {
    const index = this.index;
    const entry = index?.cards.find((c) => path.startsWith(`${c.path}/`));
    if (!entry) {
      const image = index ? catalogImages(index).find((i) => i.path === path) : undefined;
      return image ? this.cached(assetKey(image), path, path, signal) : this.remote.fetchFile(path, signal);
    }
    const file = path.slice(entry.path.length + 1);
    return this.cached(cacheKey(entry, file), path, file, signal, file.startsWith('layers/') ? entry : null);
  }

  /** Cache-first download of one file; concurrent requests share a single download. */
  private cached(
    key: string,
    path: string,
    file: string,
    signal: AbortSignal | undefined,
    layerOf: CardIndexEntry | null = null,
  ): Promise<Blob> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const download = (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(key);
      if (hit) return typed(await hit.blob(), file);
      const blob = typed(await this.remote.fetchFile(path, signal), file);
      await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
      if (layerOf) await this.addLayerBytes(layerOf, blob.size);
      return blob;
    })().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, download);
    return download;
  }

  async isCached(entry: CardIndexEntry, file: string): Promise<boolean> {
    return (await (await caches.open(CACHE_NAME)).match(cacheKey(entry, file))) !== undefined;
  }

  async isAssetCached(image: ImageRef): Promise<boolean> {
    return (await (await caches.open(CACHE_NAME)).match(assetKey(image))) !== undefined;
  }

  /** Marks a card as just opened (LRU). */
  async touch(entry: CardIndexEntry): Promise<void> {
    const record = await idbGet<LayerRecord>('layers', entry.id);
    const same = record?.version === entry.version;
    await idbSet('layers', entry.id, {
      version: entry.version,
      bytes: same ? record.bytes : 0,
      lastUsed: Date.now(),
      complete: same ? (record.complete ?? []) : [],
    } satisfies LayerRecord);
  }

  /** All layer files of this resolution are cached: the card's 3D works offline. */
  async markLayersComplete(entry: CardIndexEntry, resolution: TextureResolution): Promise<void> {
    const record = await idbGet<LayerRecord>('layers', entry.id);
    if (record?.version !== entry.version) return;
    const complete = [...new Set([...(record.complete ?? []), resolution])];
    await idbSet('layers', entry.id, { ...record, complete } satisfies LayerRecord);
  }

  /** Ids of the cards whose 3D is fully on the device. */
  async cardsWith3d(): Promise<Set<string>> {
    const versions = new Map(this.index?.cards.map((c) => [c.id, c.version]));
    const ids = new Set<string>();
    for (const [id, record] of await idbEntries<LayerRecord>('layers')) {
      if (versions.get(id) === record.version && (record.complete?.length ?? 0) > 0) ids.add(id);
    }
    return ids;
  }

  /**
   * "Scarica tutto per l'uso offline": downloads the full layers of every card (the cache limit still applies;
   * the settings screen raises it first when needed). Resolves with the number of files that failed.
   */
  async downloadAllLayers(onProgress?: (done: number, total: number) => void): Promise<number> {
    const index = this.index;
    if (!index) return 0;
    let failures = 0;
    const cards = [];
    for (const entry of index.cards) {
      try {
        cards.push({ entry, card: await fetchCard(this, entry.path) });
      } catch {
        failures++;
      }
    }
    const total = cards.reduce((sum, c) => sum + c.card.layers.length, 0);
    let done = 0;
    for (const { entry, card } of cards) {
      await this.touch(entry);
      let complete = true;
      for (const layer of card.layers) {
        try {
          await this.fetchFile(layerFilePath(entry.path, layer, 'full'));
        } catch {
          failures++;
          complete = false;
        }
        onProgress?.(++done, total);
      }
      if (complete) await this.markLayersComplete(entry, 'full');
    }
    return failures;
  }

  /** Total download size of the full layers of every card (index.json "bytes.full"). */
  allLayersBytes(): number {
    return this.index?.cards.reduce((sum, c) => sum + c.bytes.full, 0) ?? 0;
  }

  /** Total size of the cached 3D layers. */
  async layerBytes(): Promise<number> {
    return (await idbEntries<LayerRecord>('layers')).reduce((sum, [, r]) => sum + r.bytes, 0);
  }

  /** Deletes all cached 3D layers ("Svuota cache 3D"); base files stay. */
  async clearLayers(): Promise<void> {
    for (const [id] of await idbEntries<LayerRecord>('layers')) await this.deleteLayers(id);
  }

  private async addLayerBytes(entry: CardIndexEntry, bytes: number): Promise<void> {
    const record = await idbGet<LayerRecord>('layers', entry.id);
    const same = record?.version === entry.version;
    await idbSet('layers', entry.id, {
      version: entry.version,
      bytes: (same ? record.bytes : 0) + bytes,
      lastUsed: Date.now(),
      complete: same ? (record.complete ?? []) : [],
    } satisfies LayerRecord);
    await this.evict(entry.id);
  }

  /** Applies the cache limit now (after the user lowers it). */
  async enforceLimit(): Promise<void> {
    await this.evict('');
  }

  /** Removes the layers of the least recently opened cards until the cache fits its limit. */
  private async evict(keepId: string): Promise<void> {
    const limit = await getLayerCacheLimit();
    const records = (await idbEntries<LayerRecord>('layers')).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let total = records.reduce((sum, [, r]) => sum + r.bytes, 0);
    for (const [id, record] of records) {
      if (total <= limit) break;
      if (id === keepId || record.bytes === 0) continue;
      await this.deleteLayers(id);
      total -= record.bytes;
    }
  }

  private async deleteLayers(id: string): Promise<void> {
    const cache = await caches.open(CACHE_NAME);
    for (const request of await cache.keys()) {
      const key = parseKey(request.url);
      if (key?.kind === 'card' && key.id === id && key.file.startsWith('layers/')) await cache.delete(request);
    }
    await idbDelete('layers', id);
  }

  /** Deletes files and bookkeeping of card versions and catalog images that are not in the index any more. */
  private async prune(index: CardIndex): Promise<void> {
    const current = new Set(index.cards.map((c) => `${c.id}/${c.version}`));
    const images = new Set(catalogImages(index).map((i) => `${i.version}/${i.path}`));
    const cache = await caches.open(CACHE_NAME);
    for (const request of await cache.keys()) {
      const key = parseKey(request.url);
      const keep =
        key?.kind === 'card'
          ? current.has(`${key.id}/${key.version}`)
          : key?.kind === 'asset' && images.has(`${key.version}/${key.path}`);
      if (!keep) await cache.delete(request);
    }
    for (const [id, record] of await idbEntries<LayerRecord>('layers')) {
      if (!current.has(`${id}/${record.version}`)) await idbDelete('layers', id);
    }
  }
}
