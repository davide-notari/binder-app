// Persistent settings in IndexedDB (SPEC.md §4–5). The access key is stored only here and sent only to
// api.github.com (github-source.ts); it is never logged.
import { idbDelete, idbGet, idbSet } from './idb';

const TOKEN = 'token';
const INDEX = 'index';
const LAYER_CACHE_LIMIT = 'layerCacheLimit';

/** Default limit of the 3D layer cache (SPEC.md §5). */
export const DEFAULT_LAYER_CACHE_LIMIT = 500e6;
/** Choices offered in the settings: 250 MB / 500 MB / 1 GB / "tutto" (Infinity). */
export const LAYER_CACHE_LIMITS = [250e6, 500e6, 1e9, Infinity] as const;

export function getToken(): Promise<string | undefined> {
  return idbGet<string>('settings', TOKEN);
}

export function setToken(token: string): Promise<void> {
  return idbSet('settings', TOKEN, token);
}

export function clearToken(): Promise<void> {
  return idbDelete('settings', TOKEN);
}

export interface CachedIndex {
  /** index.json as received (parsed again at every start). */
  readonly json: unknown;
  readonly etag: string | null;
}

export function getCachedIndex(): Promise<CachedIndex | undefined> {
  return idbGet<CachedIndex>('settings', INDEX);
}

export function setCachedIndex(index: CachedIndex): Promise<void> {
  return idbSet('settings', INDEX, index);
}

export async function getLayerCacheLimit(): Promise<number> {
  return (await idbGet<number>('settings', LAYER_CACHE_LIMIT)) ?? DEFAULT_LAYER_CACHE_LIMIT;
}

export function setLayerCacheLimit(bytes: number): Promise<void> {
  return idbSet('settings', LAYER_CACHE_LIMIT, bytes);
}
