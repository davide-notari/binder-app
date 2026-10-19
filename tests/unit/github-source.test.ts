import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubSource } from '../../src/data/github-source';
import { SourceError } from '../../src/data/source';

const config = { owner: 'davide-notari', repo: 'binder-cards', branch: 'main' };

function stubFetch(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response());
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubSource (SPEC §4)', () => {
  it('requests raw contents from api.github.com with the key, API version and branch', async () => {
    const calls = stubFetch(() => new Response('{"schema":1}', { status: 200 }));
    const blob = await new GitHubSource('secret-key', config).fetchFile('cards/x y.card/card.json');
    expect(await blob.text()).toBe('{"schema":1}');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      'https://api.github.com/repos/davide-notari/binder-cards/contents/cards/x%20y.card/card.json?ref=main',
    );
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret-key',
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(init.cache).toBe('no-store');
  });

  it('sends If-None-Match and reports "not modified" on 304', async () => {
    const calls = stubFetch(() => new Response(null, { status: 304 }));
    const result = await new GitHubSource('k', config).fetchIfChanged('index.json', '"abc"');
    expect(result).toEqual({ changed: false });
    expect((calls[0]!.init.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
  });

  it('returns the new ETag when the file changed', async () => {
    stubFetch(() => new Response('{}', { status: 200, headers: { etag: '"def"' } }));
    const result = await new GitHubSource('k', config).fetchIfChanged('index.json', '"abc"');
    expect(result.changed && result.etag).toBe('"def"');
  });

  it.each([
    [401, {}, 'unauthorized'],
    [404, {}, 'not-found'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate-limited'],
    [429, {}, 'rate-limited'],
    [403, {}, 'http'],
    [500, {}, 'http'],
  ] as const)('maps HTTP %i %j to "%s"', async (status, headers, kind) => {
    stubFetch(() => new Response('{}', { status, headers }));
    const error = await new GitHubSource('k', config).fetchFile('index.json').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).kind).toBe(kind);
    expect((error as SourceError).message).not.toContain('k'.repeat(1) + ' ');
  });

  it('maps a network failure to "network" without leaking the key', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Load failed')));
    const error = await new GitHubSource('very-secret', config).fetchFile('index.json').catch((e: unknown) => e);
    expect((error as SourceError).kind).toBe('network');
    expect(String(error)).not.toContain('very-secret');
  });
});
