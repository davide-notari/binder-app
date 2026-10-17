# Rendering

Goal: the app must show each card **exactly** as the approved preview video (`anteprima_hd.py`), at the phone's native
resolution. Quality beats every other concern. A defect that only shows while moving is still a defect.
The renderer is small (≤ 8 textured quads and one camera), so correctness is cheap: do not take shortcuts.

Engine: **raw WebGL2** (no Three.js / Babylon: their default colour management works in linear space and would
change the semi-transparent edges). WebGPU is not used: it only exists on iOS 26+, WebGL2 runs on every supported iPhone.

## 1. Context

```ts
const gl = canvas.getContext('webgl2', {
  alpha: false, antialias: false, depth: false, stencil: false,
  premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance',
});
```

- No depth test: layers are drawn strictly in `card.layers` order (back to front).
- `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)` (premultiplied "over").
- Clear to black (the mirrored background always covers the viewport anyway).
- **No sRGB framebuffer, no linearisation anywhere.** Blending happens on the sRGB-encoded values, like the
  original compositing and like the reference renderer. Do not use `SRGB8_ALPHA8` textures.
- Handle `webglcontextlost` (call `preventDefault()`) and `webglcontextrestored` (rebuild programs and textures):
  iOS drops GPU contexts when the app goes to the background.

## 2. Textures

- Format `RGBA8`, mipmapped: `generateMipmap` after upload.
- Filters: `MIN = LINEAR_MIPMAP_LINEAR`, `MAG = LINEAR`, anisotropy = max of `EXT_texture_filter_anisotropic`
  (essential for the tilted water).
- Wrap from `layer.wrap`: `"clamp"` → `CLAMP_TO_EDGE`, `"mirror"` → `MIRRORED_REPEAT` (WebGL2 allows it on non-power-of-two).
- **Premultiplied alpha**, with mipmaps generated from premultiplied data (otherwise dark/light halos at edges):
  - preferred path: decode with `HTMLImageElement` (`img.decode()`), then
    `pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, NONE)`, `pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)`,
    `texImage2D(...)`. (With `ImageBitmap` sources WebGL ignores these flags; then use
    `createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' })`.)
  - a unit test must upload a small known image with semi-transparent texels and read them back on iOS Safari.
    If the result is not the exact premultiplied value, fall back to: upload straight alpha → one render-to-texture
    pass that premultiplies in the shader → `generateMipmap` on that texture.
- Check `MAX_TEXTURE_SIZE` against `layer.size`; if any full texture is too big, use half for that card.
- Opaque layers (`opaque: true`) can be uploaded as `RGB8`/`RGBA8` with alpha 1.

## 3. Geometry and shaders

Each layer is one quad (`layer.quad`, world coordinates) drawn as triangles (0,1,2), (0,2,3).

```glsl
#version 300 es
// vertex
in vec3 aPos;                 // world position (quad corner)
uniform mat4 uViewProj;
uniform mat4 uTexFromWorld;   // rows 0..2 = layer.texFromWorld, row 3 unused
out vec3 vUVQ;
void main() {
  vUVQ = (uTexFromWorld * vec4(aPos, 1.0)).xyz;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
```
```glsl
#version 300 es
// fragment
precision highp float;
in vec3 vUVQ;
uniform sampler2D uTex;       // premultiplied RGBA
out vec4 outColor;
void main() {
  vec2 uv = vUVQ.xy / vUVQ.z;           // projective divide HERE (exact also for the tilted floor)
  outColor = texture(uTex, uv);
}
```

Careful with matrix layout: GLSL matrices are column-major; `texFromWorld` in JSON is row-major 3×4.

Precision: world coordinates are small (|v| < 20), `highp` is enough. Mipmap level selection works on the
divided `uv`, which is what we want.

**Magnification quality.** The reference renderer uses bicubic interpolation; GPU `LINEAR` is slightly softer when a
texel covers more than one screen pixel (deep immersive close-ups on large phones). If the fidelity test (§8) shows
it, add a Catmull-Rom bicubic sample in the fragment shader, used only where the local magnification is > 1
(from the derivatives of `uv * textureSize`). Never use a smoothing B-spline filter (it blurs, like Blender's "Cubic").

## 4. Camera

```ts
// pose = [x, y, z, qx, qy, qz, qw] in Blender world space (Z up). Camera looks along local -Z, local +Y is up.
camWorld = translate(x, y, z) · rotationFromQuat(qx, qy, qz, qw)
view     = inverse(camWorld)
proj     = perspective(fovy, card.camera.aspect, near, far)     // standard GL perspective
viewProj = proj · view
```

- `fovy = card.camera.vfovRad` (immersive and home); in tilt mode `fovy = 2·atan(tan(vfovRad/2) / tiltZoom)`.
- The canvas must have exactly the aspect `card.camera.aspect`. Size: CSS box that fits the screen (safe areas
  included), backing store = CSS size × `min(devicePixelRatio, 3)`, rounded so that the aspect stays exact.
- Home pose: `card.camera.homePosition`, `card.camera.homeRotation`.

## 5. Interaction modes (see SPEC.md §6 for the UI)

### 5.1 Artwork, 3D off
Static home pose, zoom 1. Pixel-identical to the drawing. Render once, then stop the loop.

### 5.2 Artwork, 3D on (tilt)
Inputs: `DeviceOrientationEvent` (`beta` = front/back, `gamma` = left/right, degrees). The permission
(`DeviceOrientationEvent.requestPermission()`) must be requested inside the tap handler of the "3D" button.

1. On enabling 3D, store the current `(beta, gamma)` as the neutral reference.
2. `n = clamp((value − ref) / MAX_ANGLE, −1, 1)` per axis; smooth with an exponential filter (τ ≈ 80 ms);
   slowly move the reference towards the current orientation (τ ≈ 4 s) so that changing posture recentres.
3. Camera position = home + `(nx · MAX_OFFSET · window.width, 0, ny · MAX_OFFSET · window.height)`;
   camera looks at `(0, card.tilt.pivotDepth, 0)` with up = +Z. The main subject stays almost still, the background
   and the foreground slide in opposite directions, like looking through a window. Pick signs so that tilting the
   phone to the right reveals more of the left side of the background (expose a dev toggle to flip each axis).
4. **Tilt zoom (never show a cut edge).** A layer whose texture is cut at the drawing border (`touchesEdge[side]`
   true and `wrap` = clamp on that axis) must keep that quad edge outside the viewport. For the 4 extreme offsets
   (±1, ±1) project the layer's `quad` edge for each such side with zoom 1 and compute the zoom needed to push it out
   of NDC [−1, 1]: left edge needs `zoom ≥ −1 / max(x_ndc)`, right `zoom ≥ 1 / min(x_ndc)`, same for top/bottom on y.
   `tiltZoom` = max of all requirements, at least 1. If it exceeds 1.12, reduce `MAX_OFFSET` for that card until it
   fits (binary search) and log it in the debug overlay. Compute once per card and screen.
5. Enabling/disabling 3D animates offset and zoom from/to home over 0.35 s (ease-in-out), so the image never jumps.

Starting values (tune on device with the debug panel, then hard-code): `MAX_ANGLE = 25°`, `MAX_OFFSET = 0.06`.

### 5.3 Immersive
Only from "Artwork, 3D off" (the camera is exactly at home, zoom 1, so the start is seamless by construction).
Long press (≈ 450 ms) starts it; play `card.immersive` at real time (`performance.now()`), sampling as in
CARD_FORMAT.md §6 at every animation frame (60 fps). Tilt is ignored. At the end the camera is at home again and the
state returns to "Artwork, 3D off". It requires the full textures when the CARD_FORMAT §5 rule says so: until they are
loaded the long press shows a small "in download" hint instead of starting.

## 6. Memory

- Only the open card has textures on the GPU; delete them when the card is closed.
- Estimate per texture `w · h · 4 · 4/3` bytes. If the full set of a card exceeds the budget (start: 300 MB, adjust
  after measuring on an old iPhone), use half textures for that card even for immersive and log it.
- Load order for a card: `artwork.webp` (instant placeholder) → half layers (3D available) → full layers in
  background if the device needs them (swap is invisible: same geometry, same alignment).
- When the layers are ready, also the "3D off" view is rendered from the layers (not from `artwork.webp`), so
  turning 3D on never changes sharpness.

## 7. Performance

Render on demand: run `requestAnimationFrame` only while something moves (tilt active, immersive playing,
transitions). 60 fps is the target everywhere (Safari caps web content at 60 Hz even on ProMotion screens).
Fixed cost per frame: ≤ 8 draw calls. Any frame-time problem is a texture-size/memory problem, not a draw problem.

## 8. Fidelity tests (mandatory, automated)

`tests/fixtures/cards-repo/refs/<id>/refs.json` lists reference frames rendered by `anteprima_hd.py` (effects off)
with the time on the immersive track (`trackTime`). Test procedure:

1. render the card offscreen at the reference resolution (`refs.json.resolution`), `preserveDrawingBuffer: true`,
   camera = track pose at `trackTime`, full textures;
2. `readPixels`, compare with the PNG: **mean absolute difference ≤ 1.0** (0–255 scale) and **99th percentile ≤ 16**;
   save a side-by-side + heatmap image on failure.

Baseline: `binder-cards/tools/verify_card.py` renders the same frames with OpenCV from card.json only and obtains
mean 0.28–0.63, p99 7–13 on the test card. The remaining difference comes from the reference renderer's per-layer
mip choice and bicubic sampling. A WebGL result clearly worse than this baseline is a bug (typical causes:
straight alpha, linear colour space, missing anisotropy, UV divided in the vertex shader, wrong row/column order).

Run in Playwright with the **WebKit** engine (closest to iOS Safari) plus a manual check on a real iPhone.
Real cards have their reference frames in the private repo (`binder-cards/refs/`): the same test runs locally on
them when `CARDS_DIR` points to a checkout of binder-cards; they must never be copied into this repository.
