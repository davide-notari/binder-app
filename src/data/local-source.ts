// Development only: reads the card repository served by the Vite dev server under /dev-cards/
// (tools/dev-cards.ts). Never used in production builds.
import { SourceError, type CardSource } from './source';

export class LocalSource implements CardSource {
  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}dev-cards/`) {}

  async fetchFile(path: string, signal?: AbortSignal): Promise<Blob> {
    const url = this.baseUrl + path.split('/').map(encodeURIComponent).join('/');
    let response: Response;
    try {
      response = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SourceError('network', `${path}: ${String(error)}`);
    }
    if (response.status === 404) throw new SourceError('not-found', path);
    if (!response.ok) throw new SourceError('http', `${path}: HTTP ${response.status}`);
    return response.blob();
  }
}
