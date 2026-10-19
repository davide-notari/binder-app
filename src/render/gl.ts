// WebGL2 context and program helpers (RENDERING.md §1).

export class RendererError extends Error {
  constructor(
    readonly code: 'webgl2-unavailable' | 'shader' | 'texture-too-large' | 'texture-size' | 'out-of-memory',
    message: string,
  ) {
    super(message);
    this.name = 'RendererError';
  }
}

export interface ContextOptions {
  /** Only for tests and the dev page, which read pixels back after compositing. */
  readonly preserveDrawingBuffer?: boolean;
}

export function createContext(canvas: HTMLCanvasElement, options: ContextOptions = {}): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new RendererError('webgl2-unavailable', 'WebGL2 is not available');
  return gl;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new RendererError('shader', 'createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new RendererError('shader', `shader compile failed: ${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new RendererError('shader', `program link failed: ${log}`);
  }
  return program;
}

export function uniformLocation(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new RendererError('shader', `missing uniform ${name}`);
  return location;
}

export interface GpuCaps {
  readonly maxTextureSize: number;
}

export function gpuCaps(gl: WebGL2RenderingContext): GpuCaps {
  return { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
}
