// Drives the WebGL view of one card: texture loading (plan, budget, crash safety), the 3D tilt with its
// transitions, the immersive flight and the on-demand render loop (RENDERING.md §5–7).
import type { Card, CardLayer, TextureResolution } from '../data/card-format';
import { reportDebugError, setDebugValue } from '../debug/debug-store';
import { homePose, poseAtTime, tiltPose, zoomedFovy, type CameraPose } from '../render/camera';
import { RendererError } from '../render/gl';
import { beginUpload, endUpload, gpuBudget, gpuLimit, reportUploadFailure } from '../render/gpu-limit';
import type { ScreenSize } from '../render/level-plan';
import { planTextures, type TexturePlan } from '../render/memory';
import type { CardRenderer } from '../render/renderer';
import { sharedRenderer } from '../render/shared-renderer';
import { fitTilt, type TiltFit } from '../render/tilt-fit';
import { TILT_TRANSITION_MS, Transition } from './motion';
import { TiltInput } from './tilt';
import { onTiltSettings, tiltSettings } from './tilt-settings';

export type LayerFetcher = (resolution: TextureResolution, layer: CardLayer) => Promise<HTMLImageElement>;

export interface SceneCallbacks {
  /** Layer textures are ready (first load or after a GPU context restore). */
  onReady(plan: TexturePlan): void;
  /** Layer textures are gone (GPU context lost): show the flat artwork until onReady. */
  onLost(): void;
  onProgress(loaded: number, total: number): void;
  onError(error: unknown): void;
  /** The immersive flight reached its end (the camera is at home again). */
  onImmersiveEnd(): void;
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

export class CardScene {
  readonly renderer: CardRenderer = sharedRenderer();
  private readonly tilt = new TiltInput(tiltSettings());
  private readonly blend = new Transition(TILT_TRANSITION_MS);
  private tiltOn = false;
  private fit: TiltFit = { zoom: 1, maxOffset: 0, reduced: false };
  private size: ScreenSize = { widthPx: 1, heightPx: 1 };
  private immersiveStart: number | null = null;
  private raf: number | null = null;
  private ready = false;
  private loading = false;
  private uploadingBytes: number | null = null;
  private disposed = false;
  private fetcher: LayerFetcher | null = null;
  private frameTimes: number[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly card: Card,
    private readonly callbacks: SceneCallbacks,
    /** Development/tests only: playback speed of the immersive flight. */
    private readonly immersiveSpeed = 1,
  ) {
    this.blend.reset(0);
    this.renderer.onContextLost = this.handleContextLost;
    this.renderer.onContextRestored = this.handleContextRestored;
    this.unsubscribe = onTiltSettings((settings) => {
      this.tilt.setSettings(settings);
      this.refit();
      this.requestFrame();
    });
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isImmersivePlaying(): boolean {
    return this.immersiveStart !== null;
  }

  /** Backing-store size of the card viewport (device pixels). */
  setSize(widthPx: number, heightPx: number): void {
    if (widthPx === this.size.widthPx && heightPx === this.size.heightPx) return;
    this.size = { widthPx, heightPx };
    this.renderer.setSize(widthPx, heightPx);
    setDebugValue('canvas', `${widthPx}×${heightPx} px`);
    this.refit();
    this.requestFrame();
  }

  /** Loads the layer textures: full resolution with unused levels dropped, half only when memory requires it. */
  async load(fetcher: LayerFetcher): Promise<void> {
    this.fetcher = fetcher;
    this.loading = true;
    let budget = gpuBudget();
    try {
      for (let attempt = 0; attempt < 3 && !this.isDisposed(); attempt++) {
        const plan = planTextures(this.card, this.size, this.fit, budget, this.renderer.caps.maxTextureSize);
        this.showPlan(plan, budget);
        this.uploadingBytes = plan.bytes;
        beginUpload(plan.bytes);
        try {
          await this.renderer.loadCard(this.card, plan.resolution, (layer) => fetcher(plan.resolution, layer), {
            finest: plan.finest,
            onProgress: (loaded, total) => {
              this.callbacks.onProgress(loaded, total);
            },
          });
        } catch (error) {
          if (error instanceof RendererError && error.code === 'out-of-memory') {
            reportUploadFailure(plan.bytes);
            reportDebugError(`GPU memoria esaurita a ${mb(plan.bytes)}: riprovo più leggero`);
            budget = plan.bytes - 1;
            continue;
          }
          throw error;
        } finally {
          endUpload();
          this.uploadingBytes = null;
        }
        if (this.isDisposed() || !this.renderer.hasCard()) return; // replaced, closed or context lost
        this.ready = true;
        this.callbacks.onReady(plan);
        this.requestFrame();
        return;
      }
    } catch (error) {
      reportDebugError(String(error));
      this.callbacks.onError(error);
    } finally {
      this.loading = false;
    }
  }

  /** 3D on/off: animates offset and zoom from/to home over 0.35 s. */
  setTilt(on: boolean, now = performance.now()): void {
    if (on === this.tiltOn) return;
    this.tiltOn = on;
    if (on) this.tilt.start();
    this.blend.set(on ? 1 : 0, now);
    this.requestFrame();
  }

  /** Leaves 3D immediately (switching to the card image: no animation needed). */
  resetTilt(): void {
    this.tiltOn = false;
    this.tilt.stop();
    this.blend.reset(0);
    this.requestFrame();
  }

  /** Starts the immersive flight; only from the home view (3D off, transition finished). */
  startImmersive(now = performance.now()): boolean {
    if (!this.ready || !this.card.immersive || this.tiltOn || !this.blend.done(now) || this.blend.target !== 0) {
      return false;
    }
    this.immersiveStart = now;
    this.requestFrame();
    return true;
  }

  stopImmersive(): void {
    this.immersiveStart = null;
    this.requestFrame();
  }

  /** Feeds an orientation (development tools and tests). */
  feedOrientation(beta: number, gamma: number): void {
    this.tilt.feed(beta, gamma);
  }

  /** Renders the current view now and returns its pixels (tests; same task as the draw). */
  renderAndRead(): Uint8Array {
    this.drawFrame(performance.now());
    return this.renderer.readPixels();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.tilt.stop();
    this.unsubscribe();
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.renderer.onContextLost = null;
    this.renderer.onContextRestored = null;
    this.renderer.releaseCard();
    this.canvas.remove();
    if (this.uploadingBytes !== null) endUpload();
  }

  /** Read through a method: it changes while load() awaits. */
  private isDisposed(): boolean {
    return this.disposed;
  }

  private refit(): void {
    this.fit = fitTilt(this.card, tiltSettings().maxOffset, this.size.widthPx, this.size.heightPx);
    setDebugValue(
      'tilt',
      `zoom ${this.fit.zoom.toFixed(3)} · offset ${this.fit.maxOffset.toFixed(3)}${this.fit.reduced ? ' (ridotto)' : ''}`,
    );
  }

  private showPlan(plan: TexturePlan, budget: number): void {
    const limit = gpuLimit();
    setDebugValue(
      'texture',
      `${plan.resolution} · ${mb(plan.bytes)} · ${plan.reason} · livelli ${plan.finest.join(',')}`,
    );
    setDebugValue('budget', `${mb(budget)}${limit === null ? '' : ` (limite appreso ${mb(limit)})`}`);
    setDebugValue('maxTexture', String(this.renderer.caps.maxTextureSize));
  }

  private requestFrame(): void {
    if (this.raf === null && !this.disposed) this.raf = requestAnimationFrame(this.onFrame);
  }

  private readonly onFrame = (now: number): void => {
    this.raf = null;
    const moving = this.drawFrame(now);
    this.measure(now, moving);
    if (moving) this.requestFrame();
  };

  /** Draws one frame; returns true while something moves. */
  private drawFrame(now: number): boolean {
    if (!this.ready) return false;
    const { card } = this;
    const vfov = card.camera.vfovRad;
    let pose: CameraPose = homePose(card.camera);
    let fovy = vfov;
    let moving = false;
    if (this.immersiveStart !== null && card.immersive) {
      const t = ((now - this.immersiveStart) / 1000) * this.immersiveSpeed;
      if (t >= card.immersive.duration) {
        this.immersiveStart = null;
        this.callbacks.onImmersiveEnd();
      } else {
        pose = poseAtTime(card.immersive, t);
        moving = true;
      }
    } else {
      const b = this.blend.value(now);
      if (b > 0) {
        const offset = this.tilt.update(now);
        pose = tiltPose(card, { x: offset.x * b, y: offset.y * b }, this.fit.maxOffset);
        fovy = zoomedFovy(vfov, 1 + (this.fit.zoom - 1) * b);
        setDebugValue('offset', `${offset.x.toFixed(2)}, ${offset.y.toFixed(2)}`);
      }
      moving = this.tiltOn || !this.blend.done(now);
      if (!this.tiltOn && this.blend.done(now)) this.tilt.stop();
    }
    this.renderer.render(pose, fovy);
    return moving;
  }

  private measure(now: number, moving: boolean): void {
    if (!moving) {
      this.frameTimes = [];
      return;
    }
    this.frameTimes.push(now);
    while (this.frameTimes.length > 0 && now - (this.frameTimes[0] ?? now) > 1000) this.frameTimes.shift();
    if (this.frameTimes.length > 1) {
      const span = now - (this.frameTimes[0] ?? now);
      setDebugValue('fps', span > 0 ? (((this.frameTimes.length - 1) * 1000) / span).toFixed(0) : '-');
    }
  }

  private readonly handleContextLost = (): void => {
    this.ready = false;
    this.immersiveStart = null;
    if (this.uploadingBytes !== null && document.visibilityState === 'visible') {
      // the GPU dropped the context in the middle of an upload: treat it as running out of memory
      reportUploadFailure(this.uploadingBytes);
      reportDebugError(`contesto GPU perso durante il caricamento (${mb(this.uploadingBytes)})`);
    }
    this.callbacks.onLost();
  };

  private readonly handleContextRestored = (): void => {
    const { fetcher } = this;
    this.renderer.setSize(this.size.widthPx, this.size.heightPx);
    if (fetcher && !this.loading) void this.load(fetcher);
  };

  private readonly handleVisibility = (): void => {
    // an app sent to the background (and maybe closed there) is not a memory crash
    if (this.uploadingBytes === null) return;
    if (document.visibilityState === 'hidden') endUpload();
    else beginUpload(this.uploadingBytes);
  };
}
