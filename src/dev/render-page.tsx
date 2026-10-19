// Development page: /?dev=render&card=<id>&t=<sec>[&res=full|half][&w=<px>&h=<px>][&ui=0]
// Renders one card from the local source at a time on its immersive track (home view without t).
// With w/h the backing store has exactly that size (fidelity tests); otherwise the card fits the screen.
// The Playwright fidelity test drives it through window.__binderDev.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Card, CardLayer, TextureResolution } from '../data/card-format';
import { layerFilePath } from '../data/card-format';
import { LocalSource } from '../data/local-source';
import { fetchCard, fetchCardIndex, fetchJson } from '../data/source';
import { homePose, poseAtTime } from '../render/camera';
import { CardRenderer } from '../render/renderer';
import { halfIsEnough } from '../render/resolution';
import { decodeImage } from '../render/textures';
import { devStrings } from '../ui/strings';

interface RenderParams {
  readonly cardId: string;
  readonly time: number;
  readonly resolution: TextureResolution;
  readonly size: readonly [number, number] | null;
  readonly ui: boolean;
}

interface RefFrame {
  readonly file: string;
  readonly sourceFrame: number;
  readonly trackTime: number;
}

export interface DevRenderInfo {
  readonly cardId: string;
  readonly version: string;
  readonly resolution: TextureResolution;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly textureBytes: number;
  readonly maxTextureSize: number;
  readonly loadMs: number;
  /** Texture level of each layer in the last frame. */
  readonly levels: readonly number[];
}

export interface BinderDevApi {
  renderAt(t: number): void;
  /** RGBA, rows from the top, base64. */
  readPixelsBase64(): string;
  info(): DevRenderInfo;
}

declare global {
  interface Window {
    __binderDev?: BinderDevApi;
  }
}

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

function parseParams(search: string): RenderParams {
  const p = new URLSearchParams(search);
  const w = positiveInt(p.get('w'));
  const h = positiveInt(p.get('h'));
  const t = Number(p.get('t') ?? '0');
  return {
    cardId: p.get('card') ?? 'testcard',
    time: Number.isFinite(t) ? t : 0,
    resolution: p.get('res') === 'half' ? 'half' : 'full',
    size: w !== null && h !== null ? [w, h] : null,
    ui: p.get('ui') !== '0',
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Backing-store size that fits the stage with the card's aspect, at min(devicePixelRatio, 3). */
function fitSize(stage: HTMLElement, aspect: number): { widthPx: number; heightPx: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const heightCss = Math.min(stage.clientHeight, stage.clientWidth / aspect);
  const heightPx = Math.max(1, Math.floor(heightCss * dpr));
  return { widthPx: Math.max(1, Math.round(heightPx * aspect)), heightPx, dpr };
}

function formatMb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

export function RenderPage() {
  const params = useRef(parseParams(location.search)).current;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CardRenderer | null>(null);
  const cardRef = useRef<Card | null>(null);
  const [status, setStatus] = useState<string>(devStrings.renderLoading);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(params.time);
  const [refs, setRefs] = useState<readonly RefFrame[]>([]);
  const [showRef, setShowRef] = useState(false);
  /** File name of the reference frame that finished loading (it is preloaded as soon as it is selected). */
  const [loadedRef, setLoadedRef] = useState<string | null>(null);
  const [info, setInfo] = useState<DevRenderInfo | null>(null);
  const [cssSize, setCssSize] = useState<readonly [number, number] | null>(null);
  const [levels, setLevels] = useState('');
  const [panelVisible, setPanelVisible] = useState(true);
  // press and hold on the image: show the reference frame; short tap: toggle the panel
  const holdRef = useRef<{ timer: number } | null>(null);
  const showRefRef = useRef(false);
  showRefRef.current = showRef;
  const timeRef = useRef(time);

  const draw = useCallback((t: number) => {
    const renderer = rendererRef.current;
    const card = cardRef.current;
    if (!renderer || !card) return;
    const pose = card.immersive ? poseAtTime(card.immersive, t) : homePose(card.camera);
    renderer.render(pose, card.camera.vfovRad);
  }, []);

  const applySize = useCallback(() => {
    const renderer = rendererRef.current;
    const card = cardRef.current;
    const stage = stageRef.current;
    if (!renderer || !card || !stage) return;
    if (params.size) {
      renderer.setSize(params.size[0], params.size[1]);
      setCssSize(null);
    } else {
      const { widthPx, heightPx, dpr } = fitSize(stage, card.camera.aspect);
      renderer.setSize(widthPx, heightPx);
      setCssSize([widthPx / dpr, heightPx / dpr]);
    }
  }, [params]);

  useEffect(() => {
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull; // narrowed for the nested functions below
    const source = new LocalSource();
    const started = performance.now();
    let disposed = false;

    /** Downloads all layer files in parallel; decoding happens one layer at a time inside loadCard(). */
    function imageLoader(card: Card, cardPath: string): (layer: CardLayer) => Promise<HTMLImageElement> {
      const blobs = new Map(
        card.layers.map((layer) => [layer, source.fetchFile(layerFilePath(cardPath, layer, params.resolution))]),
      );
      blobs.forEach((blob) => {
        blob.catch(() => undefined); // errors surface when the layer is awaited
      });
      return async (layer) => {
        const blob = blobs.get(layer);
        if (!blob) throw new Error(`no file for layer ${layer.id}`);
        return decodeImage(await blob);
      };
    }

    async function load(): Promise<void> {
      const index = await fetchCardIndex(source);
      const entry = index.cards.find((c) => c.id === params.cardId);
      if (!entry) throw new Error(devStrings.renderCardMissing(params.cardId));
      const card = await fetchCard(source, entry.path);
      const refsJson = await fetchJson(source, `refs/${card.id}/refs.json`).catch(() => null);
      if (refsJson && typeof refsJson === 'object' && 'frames' in refsJson && Array.isArray(refsJson.frames)) {
        setRefs(refsJson.frames as RefFrame[]);
      }
      const renderer = new CardRenderer(canvas, {
        preserveDrawingBuffer: true,
      });
      rendererRef.current = renderer;
      cardRef.current = card;
      applySize();
      renderer.onContextLost = () => {
        setStatus(devStrings.renderContextLost);
        document.documentElement.dataset.renderState = 'lost';
      };
      renderer.onContextRestored = () => {
        renderer
          .loadCard(card, params.resolution, imageLoader(card, entry.path))
          .then(() => {
            draw(timeRef.current);
            setStatus('');
            document.documentElement.dataset.renderState = 'ready';
          })
          .catch((error: unknown) => {
            setStatus(String(error));
          });
      };
      await renderer.loadCard(card, params.resolution, imageLoader(card, entry.path));
      if (disposed) return;
      draw(timeRef.current);
      const loadMs = Math.round(performance.now() - started);
      const currentInfo = (): DevRenderInfo => ({
        cardId: card.id,
        version: card.version,
        resolution: params.resolution,
        widthPx: canvas.width,
        heightPx: canvas.height,
        textureBytes: renderer.textureBytes,
        maxTextureSize: renderer.caps.maxTextureSize,
        loadMs,
        levels: [...renderer.levels],
      });
      window.__binderDev = {
        renderAt: (t) => {
          draw(t);
        },
        readPixelsBase64: () => toBase64(renderer.readPixels()),
        info: currentInfo,
      };
      setInfo(currentInfo());
      setStatus('');
      setReady(true);
      document.documentElement.dataset.renderState = 'ready';
    }

    load().catch((error: unknown) => {
      console.error('render page:', error);
      setStatus(error instanceof Error ? error.message : String(error));
      document.documentElement.dataset.renderState = 'error';
    });

    const onResize = () => {
      applySize();
      draw(timeRef.current);
      const renderer = rendererRef.current;
      if (renderer)
        setInfo((old) => (old ? { ...old, widthPx: renderer.canvas.width, heightPx: renderer.canvas.height } : old));
    };
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      delete window.__binderDev;
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [params, applySize, draw]);

  useEffect(() => {
    timeRef.current = time;
    draw(time);
    setLevels(rendererRef.current?.levels.join(' ') ?? '');
  }, [time, draw, ready]);

  const card = cardRef.current;
  const duration = card?.immersive?.duration ?? 0;
  const currentRef = refs.find((r) => Math.abs(r.trackTime - time) < 1e-3) ?? null;
  const canvasStyle = cssSize ? { width: `${cssSize[0]}px`, height: `${cssSize[1]}px` } : undefined;

  return (
    <div class="dev-render">
      <div
        class="dev-render-stage"
        ref={stageRef}
        onPointerDown={() => {
          holdRef.current = {
            timer: window.setTimeout(() => {
              setShowRef(true);
            }, 300),
          };
        }}
        onPointerUp={() => {
          const hold = holdRef.current;
          if (!hold) return;
          window.clearTimeout(hold.timer);
          holdRef.current = null;
          if (showRefRef.current) setShowRef(false);
          else setPanelVisible((v) => !v);
        }}
        onPointerCancel={() => {
          if (holdRef.current) window.clearTimeout(holdRef.current.timer);
          holdRef.current = null;
          setShowRef(false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
      >
        <div class="dev-render-frame" style={canvasStyle}>
          <canvas ref={canvasRef} style={canvasStyle} />
          {currentRef && card && (
            <img
              key={currentRef.file}
              class={showRef ? 'dev-render-ref visible' : 'dev-render-ref'}
              src={`${import.meta.env.BASE_URL}dev-cards/refs/${card.id}/${currentRef.file}`}
              style={canvasStyle}
              alt=""
              draggable={false}
              onLoad={() => {
                setLoadedRef(currentRef.file);
              }}
            />
          )}
          {showRef && currentRef && (
            <span class="dev-render-badge">
              {loadedRef === currentRef.file ? devStrings.renderReferenceBadge : devStrings.renderReferenceLoading}
            </span>
          )}
        </div>
      </div>
      {params.ui && panelVisible && (
        <div class="dev-render-panel">
          {status && <p class="dev-render-status">{status}</p>}
          <p class="dev-render-hint">{devStrings.renderTapToHide}</p>
          {ready && card && info && (
            <>
              <p>
                {card.name} · {params.resolution} · {info.widthPx}×{info.heightPx} px · {formatMb(info.textureBytes)} ·{' '}
                {info.loadMs} ms
              </p>
              <p>
                {devStrings.renderHalfEnough(
                  halfIsEnough(card, info.heightPx, 'tilt'),
                  halfIsEnough(card, info.heightPx, 'immersive'),
                )}{' '}
                · {devStrings.renderLevels} {levels} · max {info.maxTextureSize}
              </p>
              {duration > 0 && (
                <label class="dev-render-time">
                  <span>t = {time.toFixed(3)} s</span>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={1 / (card.immersive?.fps ?? 30)}
                    value={time}
                    onInput={(e) => {
                      setTime(Number(e.currentTarget.value));
                    }}
                  />
                </label>
              )}
              {refs.length > 0 && (
                <div class="dev-render-buttons">
                  {refs.map((r) => (
                    <button
                      key={r.file}
                      type="button"
                      class={currentRef === r ? 'selected' : ''}
                      onClick={() => {
                        setTime(r.trackTime);
                      }}
                    >
                      {devStrings.renderFrame(r.sourceFrame)}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!currentRef}
                    onPointerDown={() => {
                      setShowRef(true);
                    }}
                    onPointerUp={() => {
                      setShowRef(false);
                    }}
                    onPointerLeave={() => {
                      setShowRef(false);
                    }}
                    onPointerCancel={() => {
                      setShowRef(false);
                    }}
                  >
                    {devStrings.renderHoldReference}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
