// Where card files come from: the private GitHub repository (M3) or, in development, a local folder.
import { parseCard, parseCardIndex, type Card, type CardIndex } from './card-format';

export type SourceErrorKind = 'unauthorized' | 'not-found' | 'rate-limited' | 'network' | 'http';

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export type ConditionalResult =
  { readonly changed: false } | { readonly changed: true; readonly blob: Blob; readonly etag: string | null };

export interface CardSource {
  /** Raw bytes of a file, path relative to the cards repository root (e.g. "index.json"). */
  fetchFile(path: string, signal?: AbortSignal): Promise<Blob>;
}

/** A remote source that also answers conditional requests (ETag), used for index.json. */
export interface RemoteSource extends CardSource {
  fetchIfChanged(path: string, etag: string | null): Promise<ConditionalResult>;
}

export async function fetchJson(source: CardSource, path: string, signal?: AbortSignal): Promise<unknown> {
  const blob = await source.fetchFile(path, signal);
  return JSON.parse(await blob.text()) as unknown;
}

export async function fetchCardIndex(source: CardSource, signal?: AbortSignal): Promise<CardIndex> {
  return parseCardIndex(await fetchJson(source, 'index.json', signal));
}

export async function fetchCard(source: CardSource, cardPath: string, signal?: AbortSignal): Promise<Card> {
  return parseCard(await fetchJson(source, `${cardPath}/card.json`, signal));
}
