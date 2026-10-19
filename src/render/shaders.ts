// Shaders (RENDERING.md §3 and §2a). The projective texture coordinate is divided in the fragment shader:
// this is exact for every layer, including the tilted floor whose texture is not affine on its quad.

export const LAYER_VERTEX_SHADER = `#version 300 es
in vec3 aPos;                 // world position (quad corner)
uniform mat4 uViewProj;
uniform mat4 uTexFromWorld;   // rows 0..2 = layer.texFromWorld, row 3 unused
out vec3 vUVQ;
void main() {
  vUVQ = (uTexFromWorld * vec4(aPos, 1.0)).xyz;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

// Sampling of the reference renderer: one pyramid level per layer (chosen on the CPU, see sampling.ts),
// bicubic interpolation with OpenCV's INTER_CUBIC kernel (Keys, A = -0.75), texel centres on integer
// coordinates. Level 0 is the texture itself: "mirror" = reflected texels, "clamp" = transparent outside
// (OpenCV BORDER_CONSTANT). Levels >= 1 are the reference's pyramid of the mirror-padded texture
// (textures.ts): transparent outside. Each channel is clamped to [0, 1] like OpenCV's 8-bit result.
export const LAYER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
in vec3 vUVQ;
uniform highp sampler2D uTex; // premultiplied RGBA: level 0 texture or pyramid level texture
uniform vec2 uBaseSize;       // level 0 size (texels)
uniform vec2 uMargin;         // mirror padding of the pyramid (0 on level 0)
uniform float uLevelScale;    // 2^level
uniform ivec2 uMirror;        // per axis: 1 = mirror (level 0 only), 0 = transparent outside
out vec4 outColor;

const float A = -0.75;

vec4 keysWeights(float f) {
  float x0 = f + 1.0;
  float x1 = f;
  float x2 = 1.0 - f;
  float x3 = 2.0 - f;
  return vec4(
    ((A * x0 - 5.0 * A) * x0 + 8.0 * A) * x0 - 4.0 * A,
    ((A + 2.0) * x1 - (A + 3.0)) * x1 * x1 + 1.0,
    ((A + 2.0) * x2 - (A + 3.0)) * x2 * x2 + 1.0,
    ((A * x3 - 5.0 * A) * x3 + 8.0 * A) * x3 - 4.0 * A);
}

// Mirrored index like GL MIRRORED_REPEAT / OpenCV BORDER_REFLECT; -1 = outside (transparent).
int wrapIndex(int i, int n, int mirror) {
  if (mirror == 0) return (i < 0 || i >= n) ? -1 : i;
  int period = 2 * n;
  int m = i - period * int(floor(float(i) / float(period)));
  return m < n ? m : period - 1 - m;
}

void main() {
  vec2 uv = vUVQ.xy / vUVQ.z;                       // projective divide HERE
  ivec2 size = textureSize(uTex, 0);
  vec2 p = (uv * uBaseSize + uMargin) / uLevelScale;   // texel coordinates, centres on integers
  vec2 cell = floor(p);
  vec2 f = p - cell;
  ivec2 i0 = ivec2(cell) - 1;
  vec4 wx = keysWeights(f.x);
  vec4 wy = keysWeights(f.y);
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    int iy = wrapIndex(i0.y + y, size.y, uMirror.y);
    if (iy < 0) continue;
    vec4 row = vec4(0.0);
    for (int x = 0; x < 4; x++) {
      int ix = wrapIndex(i0.x + x, size.x, uMirror.x);
      if (ix < 0) continue;
      row += wx[x] * texelFetch(uTex, ivec2(ix, iy), 0);
    }
    sum += wy[y] * row;
  }
  outColor = clamp(sum, 0.0, 1.0);
}
`;

// Full-screen triangle used by the texture premultiplication pass.
export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Straight alpha -> premultiplied: c·a computed in float and rounded to 8 bits by the GPU (= round(c·a/255)).
export const PREMULTIPLY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform highp sampler2D uStraight;
out vec4 outColor;
void main() {
  vec4 c = texelFetch(uStraight, ivec2(gl_FragCoord.xy), 0);
  outColor = vec4(c.rgb * c.a, c.a);
}
`;

// One level of the reference pyramid: cv2.pyrDown of the previous level (5×5 Gaussian [1 4 6 4 1]/16 per axis,
// integer rounding (sum + 128) >> 8, output size ceil(n / 2), border BORDER_REFLECT_101). The level-0 source
// is seen through its mirror padding: padded index i -> texture index i - margin, reflected like the sampler.
export const PYRDOWN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSrc;
uniform ivec2 uPaddedSize;    // size of the (padded) source level
uniform ivec2 uMargin;        // padding of the source (level 0 of a mirror layer), else 0
out vec4 outColor;

int reflect101(int i, int n) {
  if (n == 1) return 0;
  int period = 2 * n - 2;
  int m = i - period * int(floor(float(i) / float(period)));
  return m < n ? m : period - m;
}

int mirrorIndex(int i, int n) {
  int period = 2 * n;
  int m = i - period * int(floor(float(i) / float(period)));
  return m < n ? m : period - 1 - m;
}

void main() {
  ivec2 j = ivec2(gl_FragCoord.xy);
  ivec2 srcSize = textureSize(uSrc, 0);
  float w[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  vec4 sum = vec4(0.0);
  for (int ky = 0; ky < 5; ky++) {
    int sy = mirrorIndex(reflect101(2 * j.y + ky - 2, uPaddedSize.y) - uMargin.y, srcSize.y);
    for (int kx = 0; kx < 5; kx++) {
      int sx = mirrorIndex(reflect101(2 * j.x + kx - 2, uPaddedSize.x) - uMargin.x, srcSize.x);
      sum += w[kx] * w[ky] * round(texelFetch(uSrc, ivec2(sx, sy), 0) * 255.0);
    }
  }
  outColor = floor((sum + 128.0) / 256.0) / 255.0;
}
`;
