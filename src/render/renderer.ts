// WebGL2 renderer of one card: ≤ 8 textured quads drawn back to front with premultiplied "over"
// blending and a single camera (RENDERING.md §1–4, sampling as in §2a).
import type { Card, CardLayer, TextureResolution } from '../data/card-format';
import { viewProjection, type CameraPose } from './camera';
import { createContext, createProgram, gpuCaps, uniformLocation, type GpuCaps } from './gl';
import { texFromWorldMatrix, toFloat32 } from './math';
import { mirrorMargin, pyramidLevels, referenceLevel } from './sampling';
import { LAYER_FRAGMENT_SHADER, LAYER_VERTEX_SHADER } from './shaders';
import { TextureUploader, type LayerTexture } from './textures';

export interface RendererOptions {
  /** Only for tests and the dev page (pixel read-back). */
  readonly preserveDrawingBuffer?: boolean;
}

interface GpuLayer {
  readonly layer: CardLayer;
  readonly texture: LayerTexture;
  readonly texFromWorld: Float32Array;
}

interface GpuProgram {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly buffer: WebGLBuffer;
  readonly uploader: TextureUploader;
  readonly uViewProj: WebGLUniformLocation;
  readonly uTexFromWorld: WebGLUniformLocation;
  readonly uTex: WebGLUniformLocation;
  readonly uBaseSize: WebGLUniformLocation;
  readonly uMargin: WebGLUniformLocation;
  readonly uLevelScale: WebGLUniformLocation;
  readonly uMirror: WebGLUniformLocation;
}

const VERTICES_PER_LAYER = 6;
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3] as const;

export class CardRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly caps: GpuCaps;
  /** Called when iOS drops the GPU context (app in background). Textures are gone. */
  onContextLost: (() => void) | null = null;
  /** Called when the context is back: the owner must call loadCard() again. */
  onContextRestored: (() => void) | null = null;

  private readonly gl: WebGL2RenderingContext;
  private gpu: GpuProgram | null;
  private card: Card | null = null;
  private layers: GpuLayer[] = [];
  private lost = false;
  private lastLevels: number[] = [];
  /** Incremented to cancel a loadCard() in progress. */
  private generation = 0;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.gl = createContext(canvas, options.preserveDrawingBuffer ? { preserveDrawingBuffer: true } : {});
    this.caps = gpuCaps(this.gl);
    this.gpu = this.createGpuProgram();
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  get isContextLost(): boolean {
    return this.lost;
  }

  get textureBytes(): number {
    return this.layers.reduce((sum, l) => sum + l.texture.bytes, 0);
  }

  /** Texture level used for each layer in the last frame (debug). */
  get levels(): readonly number[] {
    return this.lastLevels;
  }

  /** Sets the backing-store size in device pixels. */
  setSize(widthPx: number, heightPx: number): void {
    if (this.canvas.width !== widthPx) this.canvas.width = widthPx;
    if (this.canvas.height !== heightPx) this.canvas.height = heightPx;
  }

  /**
   * Loads the layer textures of a card (replacing the previous card) and builds its geometry. Layers are
   * decoded and uploaded one at a time, and each decoded image is released right after its upload, so the
   * peak memory stays close to the GPU textures alone. A later loadCard() or releaseCard() cancels this one.
   */
  async loadCard(
    card: Card,
    resolution: TextureResolution,
    loadImage: (layer: CardLayer) => Promise<HTMLImageElement>,
  ): Promise<void> {
    this.releaseLayers();
    const generation = this.generation;
    if (!this.liveGpu()) return;
    const loaded: GpuLayer[] = [];
    try {
      for (const layer of card.layers) {
        const image = await loadImage(layer);
        // the card may have been replaced or the context lost while the image was decoding
        const gpu = generation === this.generation ? this.liveGpu() : null;
        if (!gpu) {
          image.src = '';
          if (this.liveGpu()) this.deleteLayers(loaded);
          return;
        }
        const size = layer.size[resolution];
        loaded.push({
          layer,
          texture: gpu.uploader.upload(image, size, layer.opaque, {
            levels: pyramidLevels(layer, size),
            margin: mirrorMargin(layer, size),
          }),
          texFromWorld: toFloat32(texFromWorldMatrix(layer.texFromWorld)),
        });
        image.src = ''; // drop the decoded bitmap now
      }
    } catch (error) {
      if (this.liveGpu()) this.deleteLayers(loaded);
      throw error;
    }
    const gpu = this.liveGpu();
    if (!gpu) return;
    const { gl } = this;
    const positions = new Float32Array(card.layers.length * VERTICES_PER_LAYER * 3);
    card.layers.forEach((layer, i) => {
      QUAD_TRIANGLES.forEach((corner, k) => {
        positions.set(layer.quad[corner], (i * VERTICES_PER_LAYER + k) * 3);
      });
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.layers = loaded;
    this.card = card;
  }

  hasCard(): boolean {
    return this.card !== null && this.layers.length > 0;
  }

  /** Draws the card from a camera pose with vertical field of view fovy (radians). */
  render(pose: CameraPose, fovy: number): void {
    const { gl, card, gpu } = this;
    if (this.lost || !gpu) return;
    const widthPx = this.canvas.width;
    const heightPx = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, widthPx, heightPx);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!card || this.layers.length === 0) return;

    const viewProj = viewProjection(pose, { fovy, near: card.camera.near, far: card.camera.far, widthPx, heightPx });
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.uniformMatrix4fv(gpu.uViewProj, false, toFloat32(viewProj));
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gpu.uTex, 0);
    const screen = { pose, fovy, widthPx, heightPx };
    this.lastLevels = this.layers.map((l, i) => {
      const { texture } = l;
      const level = Math.min(
        referenceLevel(l.layer, [texture.width, texture.height], screen),
        texture.levels.length - 1,
      );
      const levelTexture = texture.levels[level];
      if (!levelTexture) return level;
      gl.bindTexture(gl.TEXTURE_2D, levelTexture.texture);
      gl.uniformMatrix4fv(gpu.uTexFromWorld, false, l.texFromWorld);
      gl.uniform2f(gpu.uBaseSize, texture.width, texture.height);
      gl.uniform1f(gpu.uLevelScale, 2 ** level);
      if (level === 0) {
        gl.uniform2f(gpu.uMargin, 0, 0);
        gl.uniform2i(gpu.uMirror, l.layer.wrap[0] === 'mirror' ? 1 : 0, l.layer.wrap[1] === 'mirror' ? 1 : 0);
      } else {
        gl.uniform2f(gpu.uMargin, texture.margin[0], texture.margin[1]);
        gl.uniform2i(gpu.uMirror, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, i * VERTICES_PER_LAYER, VERTICES_PER_LAYER);
      return level;
    });
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  /** RGBA pixels of the drawing buffer, rows from the top. Needs preserveDrawingBuffer or same-task use. */
  readPixels(): Uint8Array {
    const { gl } = this;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    const rowBytes = width * 4;
    const topDown = new Uint8Array(bottomUp.length);
    for (let y = 0; y < height; y++) {
      topDown.set(bottomUp.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    return topDown;
  }

  /** Releases the card's GPU textures (when the card view is closed). */
  releaseCard(): void {
    this.releaseLayers();
  }

  dispose(): void {
    this.releaseLayers();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    if (this.gpu && !this.lost) {
      this.gpu.uploader.dispose();
      this.gl.deleteBuffer(this.gpu.buffer);
      this.gl.deleteVertexArray(this.gpu.vao);
      this.gl.deleteProgram(this.gpu.program);
    }
    this.gpu = null;
    // free the GPU memory now instead of waiting for garbage collection (iOS keeps few contexts alive)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private releaseLayers(): void {
    this.generation++;
    if (!this.lost) this.deleteLayers(this.layers);
    this.layers = [];
    this.card = null;
  }

  /** GPU resources, or null while the context is lost (read through a method: it changes across awaits). */
  private liveGpu(): GpuProgram | null {
    return this.lost ? null : this.gpu;
  }

  private deleteLayers(layers: readonly GpuLayer[]): void {
    for (const l of layers) for (const level of l.texture.levels) this.gl.deleteTexture(level.texture);
  }

  private createGpuProgram(): GpuProgram {
    const { gl } = this;
    const program = createProgram(gl, LAYER_VERTEX_SHADER, LAYER_FRAGMENT_SHADER);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return {
      program,
      vao,
      buffer,
      uploader: new TextureUploader(gl, this.caps),
      uViewProj: uniformLocation(gl, program, 'uViewProj'),
      uTexFromWorld: uniformLocation(gl, program, 'uTexFromWorld'),
      uTex: uniformLocation(gl, program, 'uTex'),
      uBaseSize: uniformLocation(gl, program, 'uBaseSize'),
      uMargin: uniformLocation(gl, program, 'uMargin'),
      uLevelScale: uniformLocation(gl, program, 'uLevelScale'),
      uMirror: uniformLocation(gl, program, 'uMirror'),
    };
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.generation++;
    this.layers = [];
    this.card = null;
    this.gpu = null;
    this.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.lost = false;
    this.gpu = this.createGpuProgram();
    this.onContextRestored?.();
  };
}
