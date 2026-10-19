// Layer textures (RENDERING.md §2 and §2a): RGBA8, premultiplied exactly, with the reference renderer's
// pyramid built from the premultiplied data. No sRGB formats, no colour conversion.
//
// WebKit's UNPACK_PREMULTIPLY_ALPHA_WEBGL truncates instead of rounding (measured in M1: off by one on
// most semi-transparent texels), so the RENDERING.md §2 fallback is used: upload straight alpha, premultiply
// in a render-to-texture pass (the GPU rounds c·a/255 to nearest).
//
// The pyramid is the one of anteprima_hd.py / verify_card.py: cv2.pyrDown of the mirror-padded texture,
// up to 3 levels. Each level is its own texture (pyrDown sizes are ceil(n / 2), not GL mip sizes).
import { RendererError, createProgram, uniformLocation, type GpuCaps } from './gl';
import { FULLSCREEN_VERTEX_SHADER, PREMULTIPLY_FRAGMENT_SHADER, PYRDOWN_FRAGMENT_SHADER } from './shaders';

export interface TextureLevel {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export interface LayerTexture {
  /** levels[0] = the texture itself; levels[k] = pyramid level k of the mirror-padded texture. */
  readonly levels: readonly TextureLevel[];
  readonly width: number;
  readonly height: number;
  /** Mirror padding (texels) of the pyramid, per axis. */
  readonly margin: readonly [number, number];
  /** GPU memory (bytes) of all levels. */
  readonly bytes: number;
}

export interface PyramidSpec {
  /** Total number of levels, including level 0 (sampling.ts pyramidLevels). */
  readonly levels: number;
  readonly margin: readonly [number, number];
}

/** RGBA8 bytes of a texture with its pyramid (RENDERING.md §6 estimate: w · h · 4 · 4/3). */
export function estimateTextureBytes(width: number, height: number): number {
  return Math.round((width * height * 4 * 4) / 3);
}

function createLevelTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  // texels are fetched by the shaders (texelFetch); the sampler state only has to be complete
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Decodes an image file with HTMLImageElement (the path whose upload flags WebGL honours). */
export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class TextureUploader {
  private readonly premultiplyProgram: WebGLProgram;
  private readonly pyrDownProgram: WebGLProgram;
  private readonly uPaddedSize: WebGLUniformLocation;
  private readonly uMargin: WebGLUniformLocation;
  private readonly vao: WebGLVertexArrayObject;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly caps: GpuCaps,
  ) {
    this.premultiplyProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, PREMULTIPLY_FRAGMENT_SHADER);
    this.pyrDownProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, PYRDOWN_FRAGMENT_SHADER);
    this.uPaddedSize = uniformLocation(gl, this.pyrDownProgram, 'uPaddedSize');
    this.uMargin = uniformLocation(gl, this.pyrDownProgram, 'uMargin');
    this.vao = gl.createVertexArray();
  }

  dispose(): void {
    this.gl.deleteProgram(this.premultiplyProgram);
    this.gl.deleteProgram(this.pyrDownProgram);
    this.gl.deleteVertexArray(this.vao);
  }

  /** Uploads a decoded image as a premultiplied RGBA8 texture and builds its pyramid. */
  upload(
    image: HTMLImageElement,
    expectedSize: readonly [number, number],
    opaque: boolean,
    pyramid: PyramidSpec = { levels: 1, margin: [0, 0] },
  ): LayerTexture {
    const { gl, caps } = this;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width !== expectedSize[0] || height !== expectedSize[1]) {
      throw new RendererError(
        'texture-size',
        `texture is ${width}×${height}, card.json says ${expectedSize[0]}×${expectedSize[1]}`,
      );
    }
    if (width > caps.maxTextureSize || height > caps.maxTextureSize) {
      throw new RendererError('texture-too-large', `texture ${width}×${height} exceeds ${caps.maxTextureSize}`);
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const base = createLevelTexture(gl, width, height);
    if (opaque) {
      // alpha is 1 everywhere: straight and premultiplied are the same
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } else {
      this.premultiplyInto(base, image, width, height);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);

    const levels: TextureLevel[] = [{ texture: base, width, height }];
    let paddedSize: [number, number] = [width + 2 * pyramid.margin[0], height + 2 * pyramid.margin[1]];
    let margin: readonly [number, number] = pyramid.margin;
    for (let k = 1; k < pyramid.levels; k++) {
      const source = levels[k - 1];
      if (!source) break;
      const size: [number, number] = [Math.ceil(paddedSize[0] / 2), Math.ceil(paddedSize[1] / 2)];
      levels.push({ texture: this.pyrDown(source.texture, paddedSize, margin, size), width: size[0], height: size[1] });
      paddedSize = size;
      margin = [0, 0];
    }
    const bytes = levels.reduce((sum, l) => sum + l.width * l.height * 4, 0);
    return { levels, width, height, margin: pyramid.margin, bytes };
  }

  /** One cv2.pyrDown step into a new texture of the given size. */
  private pyrDown(
    source: WebGLTexture,
    paddedSize: readonly [number, number],
    margin: readonly [number, number],
    size: readonly [number, number],
  ): WebGLTexture {
    const { gl } = this;
    const target = createLevelTexture(gl, size[0], size[1]);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, size[0], size[1]);
    gl.disable(gl.BLEND);
    gl.useProgram(this.pyrDownProgram);
    gl.uniform2i(this.uPaddedSize, paddedSize[0], paddedSize[1]);
    gl.uniform2i(this.uMargin, margin[0], margin[1]);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return target;
  }

  private premultiplyInto(target: WebGLTexture, image: HTMLImageElement, width: number, height: number): void {
    const { gl } = this;
    const straight = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, straight);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.premultiplyProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, straight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(straight);
  }
}

/** Reads back a texture level (RGBA8), rows from the top of the image. For tests. */
export function readTexture(gl: WebGL2RenderingContext, level: TextureLevel): Uint8Array {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, level.texture, 0);
  const pixels = new Uint8Array(level.width * level.height * 4);
  gl.readPixels(0, 0, level.width, level.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  // texture row 0 is the first image row (UNPACK_FLIP_Y false) and readPixels starts from row 0: no flip needed
  return pixels;
}
