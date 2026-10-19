// Reads the private card repository through the GitHub REST API (SPEC.md §4) with the user's access key.
// The key goes only into the Authorization header of requests to api.github.com.
import { SourceError, type CardSource, type ConditionalResult } from './source';

const API = 'https://api.github.com';

export interface GitHubConfig {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

/** Owner, repository and branch are build-time constants (.env.production / .env.development). */
export function githubConfig(): GitHubConfig {
  const owner = import.meta.env.VITE_CARDS_OWNER;
  const repo = import.meta.env.VITE_CARDS_REPO;
  const branch = import.meta.env.VITE_CARDS_BRANCH;
  if (!owner || !repo || !branch) throw new Error('VITE_CARDS_OWNER / VITE_CARDS_REPO / VITE_CARDS_BRANCH missing');
  return { owner, repo, branch };
}

function errorFor(response: Response, path: string): SourceError {
  const { status } = response;
  if (status === 401) return new SourceError('unauthorized', `${path}: HTTP 401`);
  if (status === 404) return new SourceError('not-found', `${path}: HTTP 404`);
  if (
    status === 429 ||
    (status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))
  ) {
    return new SourceError('rate-limited', `${path}: HTTP ${status}`);
  }
  return new SourceError('http', `${path}: HTTP ${status}`);
}

export class GitHubSource implements CardSource {
  constructor(
    private readonly token: string,
    private readonly config: GitHubConfig = githubConfig(),
  ) {}

  private url(path: string): string {
    const { owner, repo, branch } = this.config;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
  }

  private async request(path: string, etag: string | null, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (etag) headers['If-None-Match'] = etag;
    try {
      // no-store: the app keeps its own versioned cache (store.ts); conditional answers (304) reach the code as is
      return await fetch(this.url(path), { headers, cache: 'no-store', ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new SourceError('network', `${path}: network error`);
    }
  }

  async fetchFile(path: string, signal?: AbortSignal): Promise<Blob> {
    const response = await this.request(path, null, signal);
    if (!response.ok) throw errorFor(response, path);
    return response.blob();
  }

  async fetchIfChanged(path: string, etag: string | null): Promise<ConditionalResult> {
    const response = await this.request(path, etag);
    if (response.status === 304) return { changed: false };
    if (!response.ok) throw errorFor(response, path);
    return { changed: true, blob: await response.blob(), etag: response.headers.get('etag') };
  }
}
