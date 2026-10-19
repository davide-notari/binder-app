// Development page: /?dev=premultiply
// Uploads a small synthetic WebP with known semi-transparent texels through the renderer's texture path and
// reads it back (RENDERING.md §2). Every texel must equal round(c · a / 255). Open it on the iPhone too.
import { useEffect, useState } from 'preact/hooks';
import { createContext, gpuCaps } from '../render/gl';
import { decodeImage, readTexture, TextureUploader } from '../render/textures';
import { devStrings } from '../ui/strings';
import {
  PREMULTIPLY_FIXTURE_SIZE,
  PREMULTIPLY_FIXTURE_STRAIGHT_RGBA,
  PREMULTIPLY_FIXTURE_WEBP_BASE64,
} from './premultiply-fixture';

export interface PremultiplyResult {
  readonly texels: number;
  readonly mismatches: number;
  readonly maxError: number;
  /** First mismatches: [index, expected RGBA, got RGBA]. */
  readonly examples: readonly (readonly [number, readonly number[], readonly number[]])[];
}

export function expectedPremultiplied(straight: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < straight.length; i += 4) {
    const a = straight[i + 3] ?? 0;
    for (let c = 0; c < 3; c++) out.push(Math.floor(((straight[i + c] ?? 0) * a) / 255 + 0.5));
    out.push(a);
  }
  return out;
}

async function runPremultiplyCheck(): Promise<PremultiplyResult> {
  const bytes = Uint8Array.from(atob(PREMULTIPLY_FIXTURE_WEBP_BASE64), (ch) => ch.charCodeAt(0));
  const image = await decodeImage(new Blob([bytes], { type: 'image/webp' }));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = createContext(canvas);
  try {
    const uploader = new TextureUploader(gl, gpuCaps(gl));
    const texture = uploader.upload(image, PREMULTIPLY_FIXTURE_SIZE, false);
    uploader.dispose();
    const base = texture.levels[0];
    if (!base) throw new Error('no texture');
    const got = readTexture(gl, base);
    const expected = expectedPremultiplied(PREMULTIPLY_FIXTURE_STRAIGHT_RGBA);
    let mismatches = 0;
    let maxError = 0;
    const examples: [number, number[], number[]][] = [];
    for (let i = 0; i < expected.length; i += 4) {
      const e = expected.slice(i, i + 4);
      const g = Array.from(got.subarray(i, i + 4));
      const error = Math.max(...e.map((v, k) => Math.abs(v - (g[k] ?? 0))));
      if (error > 0) {
        mismatches++;
        maxError = Math.max(maxError, error);
        if (examples.length < 12) examples.push([i / 4, e, g]);
      }
    }
    return { texels: expected.length / 4, mismatches, maxError, examples };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function PremultiplyPage() {
  const [result, setResult] = useState<PremultiplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runPremultiplyCheck()
      .then((r) => {
        setResult(r);
        document.documentElement.dataset.premultiplyResult = JSON.stringify(r);
      })
      .catch((e: unknown) => {
        setError(String(e));
        document.documentElement.dataset.premultiplyResult = JSON.stringify({ error: String(e) });
      });
  }, []);

  return (
    <main class="dev-text">
      <h1>{devStrings.premultiplyTitle}</h1>
      {error && <p class="dev-bad">{error}</p>}
      {result && (
        <>
          <p class={result.mismatches === 0 ? 'dev-good' : 'dev-bad'}>
            {result.mismatches === 0
              ? devStrings.premultiplyOk(result.texels)
              : devStrings.premultiplyFail(result.mismatches, result.texels, result.maxError)}
          </p>
          {result.examples.map(([index, e, g]) => (
            <p key={index} class="dev-mono">
              #{index}: {devStrings.premultiplyExpected} {e.join(',')} · {devStrings.premultiplyGot} {g.join(',')}
            </p>
          ))}
        </>
      )}
    </main>
  );
}
