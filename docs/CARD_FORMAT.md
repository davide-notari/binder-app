# Card data format (`index.json` + `<id>.card/`)

This is the contract between the card production pipeline (the "immersive card" kit, Blender, `export_card.py`)
and the app. The app must treat it as read-only input and must not need anything else to reproduce a card.

- Produced by: `binder-cards/tools/export_card.py` (cards), `binder-cards/tools/editor.py` (catalog: expansions,
  rarities, descriptive data), shared rules in `binder-cards/tools/catalog.py`
- Verified by: `binder-cards/tools/verify_card.py` (renders frames from this data only and compares them
  with the approved preview frames; current result on the test card: mean abs diff ≤ 0.64 / 255)
- Example data: `tests/fixtures/cards-repo/` (schema 2: two synthetic expansions, rarities, three cards; built
  with the exporter's tools by `tools/make_schema2_fixture.py`) and `tests/fixtures/cards-repo-v1/` (schema 1, kept
  for the transition). Synthetic test cards only, no real artwork: safe to commit.

`schema` is `2` (since the expansions, rarities and catalog change of M4). The app reads schema 1 **and** 2 (a
device can still hold schema 1 data in its cache). Any incompatible change bumps it; the app must refuse (with a
clear Italian message) a schema it does not know, instead of guessing. A new **optional** field (in a card, an
expansion or a rarity) does not bump the schema: the app ignores keys it does not know.

`index.json` is the **catalog**: expansions, rarities and the descriptive data of every card (name, number,
expansion, section, order, rarity). Davide edits it with a local editor without re-exporting: card versions do not
change, so the app downloads nothing again except `index.json`, and the UI re-reads names, numbers, rarities and
expansion membership from the refreshed index. `card.json` holds **only rendering data**.

## 1. Repository layout (`binder-cards`, private)

```
index.json                        catalog: expansions, rarities, cards (fetched at every launch)
sets/<set-id>/cover.webp          expansion cover (optional; any shape, lossy q92, ≤ 2048 px on the long side)
sets/<set-id>/symbol.webp         expansion symbol (optional; lossless, ≤ 512 px)
rarities/<rarity-id>/symbol.webp  rarity symbol (optional; lossless, ≤ 512 px)
cards/<id>.card/
  card.json                       rendering data of one card (geometry, camera, files)
  thumb.webp                      grid thumbnail, 400 px wide, lossy
  front.webp                      "carta normale" (full card with the Pokémon card UI), ≤1800 px wide, lossy q95
                                  (may be missing: then images.front is null and the app shows artwork.webp)
  artwork.webp                    flat artwork (the home view), ≤1600 px wide, lossy q95: instant placeholder
  layers/full/NN_<layer>.webp     layer textures, lossless WebP, base resolution
  layers/half/NN_<layer>.webp     same textures at half resolution (premultiplied downsample)
refs/<id>/                        reference frames for tests (NOT used by the app at runtime)
tools/                            export / verify scripts
```

## 2. `index.json` (schema 2)

```json
{
  "schema": 2,
  "sets": [
    {
      "id": "unione-eterna",              // [a-z0-9-]
      "name": "Unione Eterna",            // display name (Italian UI)
      "order": 1,                         // sequence of the expansions (number, decimals allowed; higher = newer)
      "year": 2026,                       // integer or null
      "cover": {                          // or null: an expansion may never have one
        "path": "sets/unione-eterna/cover.webp",
        "size": [2048, 683],              // [w, h] px; ANY shape: lay it out with its size
        "version": "30f1e3660803"         // content hash of the file: changes when the image changes
      },
      "symbol": null                      // same object as cover (sets/<id>/symbol.webp), or null
    }
  ],
  "rarities": [
    {
      "id": "illustrazione-rara",         // [a-z0-9-]
      "name": "Illustrazione rara",
      "order": 5,
      "symbol": null                      // { "path": "rarities/<id>/symbol.webp", "size", "version" } or null
    }
  ],
  "sections": ["promo", "main"],          // known sections, in display order
  "cards": [
    {
      "id": "kc-236-celebi",              // [a-z0-9-], also the folder name cards/<id>.card
      "name": "Celebi",                   // display name (Italian UI)
      "number": "236",                    // STRING, exactly as printed: "236", "10-05-2026", "SVP 001"... (may be "")
      "set": "unione-eterna",             // always an id of "sets"
      "section": "main",                  // "main" = regular cards, "promo" = promo cards
      "order": 236,                       // position inside its section of its expansion (decimals allowed)
      "rarity": "illustrazione-rara",     // an id of "rarities", or null
      "version": "3f43be533cc6",          // content hash of the bundle: changes whenever any card file changes
      "path": "cards/kc-236-celebi.card", // always "cards/<id>.card"
      "immersive": true,                  // has an immersive camera track
      "hasFront": true,                   // front.webp exists
      "bytes": { "base": 1233431, "full": 10136028, "half": 3417762 }   // download sizes per group
    }
  ]
}
```

`base` = card.json + thumb + front + artwork. `full` / `half` = all layer files of that resolution.

Guarantees of the exporter and the editor (fail-closed, every write is validated; the app checks them again):
ids are unique inside `sets`, `rarities` and `cards`; `cards[].set` always exists; `cards[].rarity` is null or
exists; image paths are exactly `sets/<id>/cover.webp`, `sets/<id>/symbol.webp`, `rarities/<id>/symbol.webp`. An
expansion may have no cards. `sets` and `rarities` are sorted by `order`, then `id`; `cards` by expansion order,
section, `order`, `id` — the app does not rely on any sorting.

**Schema 1** (transition): no `sets`, `rarities`, `cards[].set`, `cards[].rarity`. The app shows it as a single
expansion without name, year, cover or rarities.

**Layout decisions of the app** (Davide, M4): the collection lists the expansions **newest first** (highest
`order`); the app **always opens on the collection**, also with a single expansion; inside an expansion the
**promo cards are on top**; a cover is a **full-width banner** with its own shape (cropped in the middle only when
taller than wide), a gradient with the symbol or the initials when there is none. Rarity: symbol next to the
number in the binder, symbol and name in the card view; nothing when null.

**Sections.** Promo cards often have no regular number (for example a date) and must not be mixed with the
regular cards. Inside each expansion the app groups cards by `section` and sorts each group by `order`. Unknown
section values are shown after the known ones, never dropped.

`order` defaults (exporter): a `DD-MM-YYYY` date → `YYYYMMDD` (promos sort chronologically), an integer → itself,
otherwise the last group of digits, otherwise 0. Davide can override it (e.g. `235.5` to insert a card).
`number` is display text only: never parse it in the app.

## 3. World and camera conventions

All geometry is in **Blender world units**, exactly as built by `immersive_card.py`. No conversion is needed.

- Right-handed, **Z up**, **Y = depth** (positive = away from the viewer), X right.
- The drawing "window" is the rectangle on the plane `Y = 0`, centered at the origin, size `window.width × window.height`.
- **Home camera**: position `camera.homePosition = (0, -homeDistance, 0)`, looking along +Y, up = +Z.
  From there the layers recompose the original artwork exactly (that is the first and last frame of every video).
- Camera poses are `[x, y, z, qx, qy, qz, qw]`: position + unit quaternion of the camera's world rotation.
  The camera looks along its **local −Z** and its **local +Y is up**: the same convention as OpenGL/WebGL view space,
  so `view = inverse(T(position) · R(quaternion))` and a standard perspective projection is all that is needed.
- Projection: vertical field of view `camera.vfovRad` (sensor 36 mm vertical, `lensMm`), aspect `camera.aspect`
  (= artPx width / height, 8:11 for standard cards), `near` / `far` as given. The viewport must have exactly this aspect.

## 4. `card.json`

Top level:

| key | type | meaning |
|---|---|---|
| `schema` | int | 2 (1 also accepted) |
| `id`, `version` | | as in index.json. Schema 1 also had `name`, `number`, `section`, `order`: the app never reads them (descriptive data comes from the index entry) |
| `artPx` | [w, h] | artwork size in pixels (standard 3024×4158) |
| `pxPerUnit` | float | artwork pixels per world unit on the window plane |
| `camera` | object | `lensMm`, `sensorHeightMm` (36), `vfovRad`, `aspect`, `near`, `far`, `homeDistance`, `homePosition`, `homeRotation` (quaternion [x,y,z,w]) |
| `window` | object | `width`, `height` of the drawing window in world units |
| `images` | object | `front` (file or null), `frontSize`, `thumb`, `thumbSize`, `artwork`, `artworkSize` (sizes are [w, h] px) |
| `layers` | array | **back to front**; draw in this order (see §5) |
| `tilt` | object | `pivotDepth`: depth (Y) of the main subject; the tilt camera looks at `(0, pivotDepth, 0)` |
| `immersive` | object or null | camera track (see §6); null for tilt-only cards |

## 5. Layers

```json
{
  "id": "celebi",
  "kind": "plane",                       // "plane" (vertical, constant depth) or "floor" (tilted plane, e.g. water)
  "depth": 1.099,                        // planes only
  "file": "05_celebi.webp",              // in layers/full/ and layers/half/
  "opaque": false,                       // true: no alpha channel (background)
  "size": { "full": [328, 328], "half": [164, 164] },
  "crop": [476, 352, 328, 328],          // where this texture sits in the original layer PNG (info/debug)
  "wrap": ["clamp", "clamp"],            // [S, T]: "clamp" -> CLAMP_TO_EDGE, "mirror" -> MIRRORED_REPEAT
  "quad": [[x,y,z], [x,y,z], [x,y,z], [x,y,z]],   // world corners: texture top-left, top-right, bottom-right, bottom-left
  "texFromWorld": [[...4], [...4], [...4]],       // 3×4 matrix, see below
  "windowQuad": [[x,y,z] ×4],            // where the drawing's border lies on this layer (TL, TR, BR, BL)
  "touchesEdge": { "left": false, "top": false, "right": false, "bottom": false },
  "coverage": 0.7029                     // fraction of non-transparent texels (info)
}
```

### Texture mapping: `texFromWorld` (important)

For any world point `P` on the layer:

```
[uq, vq, q] = texFromWorld · [P.x, P.y, P.z, 1]
u = uq / q,  v = vq / q          // normalized texture coords, origin = TOP-LEFT of the image, v grows downward
```

This is the projection of `P` through the home camera into the texture: the texel the original drawing shows there.
It is exact for every layer, **including the tilted floor**, whose texture is not affine on its quad
(a single quad with ordinary per-vertex UVs would bend the water diagonally). Implementation rule:

- vertex shader: `vUVQ = texFromWorld * vec4(aPos, 1.0)` (a `vec3` varying, perspective-correct by default);
- fragment shader: `uv = vUVQ.xy / vUVQ.z`. **Divide in the fragment shader, never in the vertex shader.**

With WebGL's default `UNPACK_FLIP_Y_WEBGL = false`, the first image row is at t = 0, so `uv` is used as is.
For `mirror` layers the quad extends beyond the texture (u, v outside 0..1): the sampler's MIRRORED_REPEAT
produces the mirrored margin, exactly like Blender (`extend` in the kit). Quads are split into triangles (0,1,2) and (0,2,3).

### Choosing full or half textures

Use `half` only when it cannot be seen. With display height `Hs` (device pixels) of the card viewport:

- tilt / home view (visible fraction ≈ 1 / tiltZoom ≈ 0.95): half is enough if `Hs ≤ 0.95 · artPx[1] / 2`;
- immersive (closest framing `immersive.minVisibleFraction`, e.g. 0.43): half is enough if
  `Hs ≤ minVisibleFraction · artPx[1] / 2`, otherwise full is required.

At 3024×4158 the half textures cover tilt on every current iPhone, while immersive close-ups need full on most of them.
Also fall back to half if any full texture exceeds `MAX_TEXTURE_SIZE` or the memory budget (RENDERING.md §6).

*App note (M2, no format change): with the reference sampling of RENDERING.md §2a, half textures are visibly
different from the approved frames even in the home view, so the app uses full textures whenever the memory
budget allows (keeping only the pyramid levels the screen needs, RENDERING.md §6a) and half only as a fallback.*

## 6. Immersive track

```json
"immersive": {
  "fps": 30,
  "sourceFrames": [31, 481],        // frames of the approved video this track covers (1-based)
  "duration": 15.0,                 // seconds, = (poses.length - 1) / fps
  "minVisibleFraction": 0.427,      // closest framing: fraction of the drawing height visible at pivotDepth
  "poses": [[x, y, z, qx, qy, qz, qw], ...]
}
```

- `poses[0]` and the last pose are **exactly the home pose** (the exporter refuses anything else). The static
  holds at the start and end of the video are trimmed: the track starts moving immediately.
- Sample at time `t ∈ [0, duration]`: `k = t · fps`, `i = floor(k)`, `a = k − i`; position = lerp, rotation = slerp
  (quaternions are stored hemisphere-continuous, so no sign flip is needed). This reproduces the video at 30 fps and
  gives smooth in-between poses at 60 fps. The easing is already baked into the poses: play at constant speed.
- Camera intrinsics during the track are the card's `camera` (no zoom).

## 7. Invariants the exporter guarantees (fail-closed)

- every layer PNG has the size `artPx + 2·pad_px`; lossless WebP output is decoded back and compared bit-for-bit;
- plane geometry matches the Blender scene in `scene_export.json` (stale exports are rejected);
- the floor is a true plane; texture corners map to the expected texture coordinates;
- the camera track starts and ends at home; layers have no animations (the app supports static layers only).
