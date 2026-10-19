// Card view (SPEC.md §6 screen 4): Carta / Artwork, 3D tilt, long press for the immersive flight.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  cardFilePath,
  layerFilePath,
  type Card,
  type CardIndexEntry,
  type CardLayer,
  type TextureResolution,
} from '../data/card-format';
import { fetchCard, SourceError, type CardSource } from '../data/source';
import { CardScene, type LayerFetcher } from '../interaction/card-scene';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from '../interaction/motion';
import { requestMotionPermission } from '../interaction/tilt';
import { decodeImage } from '../render/textures';
import { isArtwork, nextMode, type CardEvent, type CardMode } from './card-view-state';
import { ChevronLeftIcon } from './icons';
import { strings } from './strings';
import './card-view.css';

interface Props {
  readonly source: CardSource;
  readonly entry: CardIndexEntry;
  readonly onBack: () => void;
  /** All layers of this resolution are now cached (the 3D works offline). */
  readonly onLayersReady?: (resolution: TextureResolution) => void;
}

interface Box {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface Notice {
  readonly text: string;
  readonly retry?: () => void;
}

/** Side margin of the card inside the screen (CSS px). */
const MARGIN = 12;
/** A swipe that starts this close to the left edge and moves this far right goes back to the binder. */
const EDGE_SWIPE_ZONE = 24;
const EDGE_SWIPE_DISTANCE = 70;

/** Largest box with this aspect inside the stage; the backing store keeps the aspect within one pixel. */
function fitBox(stageWidth: number, stageHeight: number, aspect: number): Box {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssHeight = Math.max(1, Math.min(stageHeight - 2 * MARGIN, (stageWidth - 2 * MARGIN) / aspect));
  const heightPx = Math.max(1, Math.floor(cssHeight * dpr));
  const widthPx = Math.max(1, Math.round(heightPx * aspect));
  return { cssWidth: widthPx / dpr, cssHeight: heightPx / dpr, widthPx, heightPx };
}

/** Development/tests: immersive playback speed from ?speed=. */
function devSpeed(): number {
  if (!import.meta.env.DEV) return 1;
  const speed = Number(new URLSearchParams(location.search).get('speed') ?? '1');
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/** Downloads all layers of a resolution in parallel; decoding happens one layer at a time (in the renderer). */
function layerFetcher(source: CardSource, cardPath: string, card: Card): LayerFetcher {
  const downloads = new Map<TextureResolution, Map<CardLayer, Promise<Blob>>>();
  return async (resolution, layer) => {
    let files = downloads.get(resolution);
    if (!files) {
      files = new Map(card.layers.map((l) => [l, source.fetchFile(layerFilePath(cardPath, l, resolution))]));
      files.forEach((p) => {
        p.catch(() => undefined); // surfaces when awaited
      });
      downloads.set(resolution, files);
    }
    const blob = files.get(layer);
    if (!blob) throw new Error(`unknown layer ${layer.id}`);
    return decodeImage(await blob);
  };
}

export function CardView({ source, entry, onBack, onLayersReady }: Props) {
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<CardMode>('card');
  const [images, setImages] = useState<{ artwork: string | null; front: string | null }>({
    artwork: null,
    front: null,
  });
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<readonly [number, number] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [stage, setStage] = useState<readonly [number, number] | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CardScene | null>(null);
  const loadStarted = useRef(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const edgeSwipe = useRef<{ x: number; y: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const readyCallback = useRef(onLayersReady);
  readyCallback.current = onLayersReady;

  const dispatch = useCallback((event: CardEvent) => {
    setMode((m) => nextMode(m, event));
  }, []);

  // card.json and the base images
  useEffect(() => {
    const run = { cancelled: false };
    const isCancelled = () => run.cancelled; // read through a call: the flag changes while the work awaits
    const urls: string[] = [];
    const objectUrl = async (file: string): Promise<string> => {
      const url = URL.createObjectURL(await source.fetchFile(cardFilePath(entry.path, file)));
      urls.push(url);
      return url;
    };
    (async () => {
      const loaded = await fetchCard(source, entry.path);
      if (isCancelled()) return;
      setCard(loaded);
      const [artwork, front] = await Promise.all([
        objectUrl(loaded.images.artwork),
        loaded.images.front ? objectUrl(loaded.images.front) : Promise.resolve(null),
      ]);
      if (!isCancelled()) setImages({ artwork, front });
    })().catch((error: unknown) => {
      console.error('card view:', error);
      if (!isCancelled()) setFailed(true);
    });
    return () => {
      run.cancelled = true;
      urls.forEach((u) => {
        URL.revokeObjectURL(u);
      });
    };
  }, [source, entry]);

  // the WebGL scene of this card
  useEffect(() => {
    if (!card) return;
    const scene = new CardScene(
      card,
      {
        onReady: (plan) => {
          setReady(true);
          setProgress(null);
          readyCallback.current?.(plan.resolution);
        },
        onLost: () => {
          setReady(false);
          setMode((m) => (m === 'immersive' || m === 'artwork-tilt' ? 'artwork-flat' : m));
        },
        onProgress: (loaded, total) => {
          setProgress([loaded, total]);
        },
        onError: (error) => {
          setProgress(null);
          const offline = error instanceof SourceError && error.kind === 'network';
          setNotice({ text: offline ? strings.offline3d : strings.layersError });
        },
        onImmersiveEnd: () => {
          dispatch({ type: 'immersive-end' });
        },
      },
      devSpeed(),
    );
    sceneRef.current = scene;
    hostRef.current?.appendChild(scene.canvas);
    if (import.meta.env.DEV) exposeDevApi(scene, () => modeRef.current);
    return () => {
      scene.dispose();
      sceneRef.current = null;
      if (import.meta.env.DEV) delete window.__binderCard;
    };
  }, [card, dispatch]);

  // stage size
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setStage([element.clientWidth, element.clientHeight]);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const artworkBox = card && stage ? fitBox(stage[0], stage[1], card.camera.aspect) : null;
  const frontAspect = card?.images.frontSize
    ? card.images.frontSize[0] / card.images.frontSize[1]
    : card?.camera.aspect;
  const frontBox = stage && frontAspect && card?.images.front ? fitBox(stage[0], stage[1], frontAspect) : artworkBox;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !artworkBox) return;
    scene.setSize(artworkBox.widthPx, artworkBox.heightPx);
    scene.canvas.style.width = `${artworkBox.cssWidth}px`;
    scene.canvas.style.height = `${artworkBox.cssHeight}px`;
  }, [artworkBox?.widthPx, artworkBox?.heightPx, card]);

  // the layers are downloaded the first time the artwork is shown (SPEC.md §5)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !card || !artworkBox || !isArtwork(mode) || loadStarted.current) return;
    loadStarted.current = true;
    setProgress([0, card.layers.length]);
    void scene.load(layerFetcher(source, entry.path, card));
  }, [mode, card, artworkBox, source, entry]);

  const toggleMode = (target: 'card' | 'artwork') => {
    if (mode === 'immersive' || (target === 'card') === (mode === 'card')) return;
    if (mode === 'artwork-tilt') sceneRef.current?.resetTilt();
    setNotice(null);
    dispatch({ type: 'mode' });
  };

  const toggle3d = () => {
    const scene = sceneRef.current;
    if (!scene || !ready) return;
    if (mode === 'artwork-tilt') {
      scene.setTilt(false);
      dispatch({ type: '3d-off' });
      return;
    }
    if (mode !== 'artwork-flat') return;
    // iOS asks for the motion permission only inside the tap handler
    void requestMotionPermission().then((permission) => {
      if (permission === 'denied') {
        setNotice({ text: strings.motionDenied, retry: toggle3d });
        return;
      }
      setNotice(null);
      scene.setTilt(true);
      dispatch({ type: '3d-on' });
    });
  };

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (mode !== 'artwork-flat' || !card?.immersive) return;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        const scene = sceneRef.current;
        if (scene?.isReady && scene.startImmersive()) {
          setNotice(null);
          dispatch({ type: 'long-press', immersiveReady: true });
        } else {
          setNotice({ text: strings.immersiveDownloading });
        }
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };

  const radius = (box: Box | null) => (box ? `${(box.cssWidth * 0.045).toFixed(1)}px` : '0');
  const boxStyle = (box: Box | null) =>
    box ? { width: `${box.cssWidth}px`, height: `${box.cssHeight}px`, borderRadius: radius(box) } : undefined;

  return (
    <div
      class="card-view"
      data-mode={mode}
      data-ready={ready ? '1' : '0'}
      onPointerDown={(e) => {
        // swipe from the left edge: back to the binder (SPEC.md §6)
        edgeSwipe.current =
          e.clientX <= EDGE_SWIPE_ZONE && mode !== 'immersive' ? { x: e.clientX, y: e.clientY } : null;
      }}
      onPointerUp={(e) => {
        const start = edgeSwipe.current;
        edgeSwipe.current = null;
        if (start && e.clientX - start.x > EDGE_SWIPE_DISTANCE && Math.abs(e.clientY - start.y) < EDGE_SWIPE_DISTANCE) {
          onBack();
        }
      }}
      onPointerCancel={() => {
        edgeSwipe.current = null;
      }}
    >
      <header class="card-view-bar">
        <button type="button" class="bar-button" onClick={onBack}>
          <ChevronLeftIcon />
          <span>{strings.back}</span>
        </button>
        <div class="card-view-title">
          <span class="card-view-name">{entry.name}</span>
          <span class="card-view-number">{entry.number}</span>
        </div>
      </header>

      <div class="card-view-stage" ref={stageRef}>
        {failed && <p class="card-view-error">{strings.cardError}</p>}
        {mode === 'card' && (images.front ?? images.artwork) && (
          <img
            class="card-front"
            src={images.front ?? images.artwork ?? ''}
            style={boxStyle(frontBox)}
            alt={entry.name}
            draggable={false}
          />
        )}
        <div
          class={isArtwork(mode) ? 'artwork-frame' : 'artwork-frame hidden'}
          style={boxStyle(artworkBox)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(e) => {
            e.preventDefault();
          }}
        >
          {images.artwork && !ready && (
            <img class="artwork-flat" src={images.artwork} alt={entry.name} draggable={false} />
          )}
          <div
            class="canvas-host"
            ref={hostRef}
            style={{ visibility: ready && isArtwork(mode) ? 'visible' : 'hidden' }}
          />
          {mode === 'artwork-flat' && card?.immersive && <span class="hold-hint">{strings.holdHint}</span>}
          {progress && isArtwork(mode) && (
            <span class="progress-hint">{strings.preparing3d(progress[0], progress[1])}</span>
          )}
        </div>
      </div>

      {notice && (
        <div class="card-view-notice" role="status">
          <span>{notice.text}</span>
          {notice.retry && (
            <button type="button" onClick={notice.retry}>
              {strings.retry}
            </button>
          )}
        </div>
      )}

      <footer class="card-view-controls">
        <div class="segmented" role="group">
          <button
            type="button"
            aria-pressed={mode === 'card'}
            disabled={mode === 'immersive'}
            onClick={() => {
              toggleMode('card');
            }}
          >
            {strings.modeCard}
          </button>
          <button
            type="button"
            aria-pressed={isArtwork(mode)}
            disabled={mode === 'immersive'}
            onClick={() => {
              toggleMode('artwork');
            }}
          >
            {strings.modeArtwork}
          </button>
        </div>
        <button
          type="button"
          class="toggle-3d"
          aria-pressed={mode === 'artwork-tilt'}
          disabled={!isArtwork(mode) || !ready || mode === 'immersive'}
          onClick={toggle3d}
        >
          {strings.button3d}
        </button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- development hooks (tests, debug)

export interface CardDevApi {
  mode(): CardMode;
  ready(): boolean;
  feedOrientation(beta: number, gamma: number): void;
  /** Renders the current view and returns its RGBA pixels (rows from the top) as base64. */
  renderBase64(): string;
}

declare global {
  interface Window {
    __binderCard?: CardDevApi;
  }
}

function exposeDevApi(scene: CardScene, mode: () => CardMode): void {
  window.__binderCard = {
    mode,
    ready: () => scene.isReady,
    feedOrientation: (beta, gamma) => {
      scene.feedOrientation(beta, gamma);
    },
    renderBase64: () => {
      const bytes = scene.renderAndRead();
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
  };
}
