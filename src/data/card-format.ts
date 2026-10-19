// Types and validation for the card data contract (docs/CARD_FORMAT.md, schema 1).
// Parsing is fail-closed: anything that does not match the contract throws CardFormatError.

export const SUPPORTED_SCHEMA = 1;

export type Vec3 = readonly [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];
/** Camera pose [x, y, z, qx, qy, qz, qw] in Blender world space. */
export type Pose = readonly [number, number, number, number, number, number, number];
export type Size = readonly [number, number];
export type Quad = readonly [Vec3, Vec3, Vec3, Vec3];
export type Wrap = 'clamp' | 'mirror';
export type TextureResolution = 'full' | 'half';
export type Row4 = readonly [number, number, number, number];

export interface CardIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly number: string;
  readonly section: string;
  readonly order: number;
  readonly version: string;
  readonly path: string;
  readonly immersive: boolean;
  readonly hasFront: boolean;
  readonly bytes: { readonly base: number; readonly full: number; readonly half: number };
}

export interface CardIndex {
  readonly schema: number;
  readonly sections: readonly string[];
  readonly cards: readonly CardIndexEntry[];
}

export interface CardCamera {
  readonly lensMm: number;
  readonly sensorHeightMm: number;
  readonly vfovRad: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
  readonly homeDistance: number;
  readonly homePosition: Vec3;
  readonly homeRotation: Quat;
}

export interface CardImages {
  readonly front: string | null;
  readonly frontSize: Size | null;
  readonly thumb: string;
  readonly thumbSize: Size;
  readonly artwork: string;
  readonly artworkSize: Size;
}

export interface EdgeFlags {
  readonly left: boolean;
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
}

export interface CardLayer {
  readonly id: string;
  readonly kind: 'plane' | 'floor';
  /** Planes only. */
  readonly depth: number | null;
  readonly file: string;
  readonly opaque: boolean;
  readonly size: { readonly full: Size; readonly half: Size };
  readonly crop: readonly [number, number, number, number];
  readonly wrap: readonly [Wrap, Wrap];
  /** World corners: texture top-left, top-right, bottom-right, bottom-left. */
  readonly quad: Quad;
  /** Row-major 3×4: [u·q, v·q, q] = texFromWorld · [x, y, z, 1]. */
  readonly texFromWorld: readonly [Row4, Row4, Row4];
  readonly windowQuad: Quad;
  readonly touchesEdge: EdgeFlags;
  readonly coverage: number;
}

export interface ImmersiveTrack {
  readonly fps: number;
  readonly sourceFrames: readonly [number, number];
  readonly duration: number;
  readonly minVisibleFraction: number;
  readonly poses: readonly Pose[];
}

export interface Card {
  readonly schema: number;
  readonly id: string;
  readonly name: string;
  readonly number: string;
  readonly section: string;
  readonly order: number;
  readonly version: string;
  readonly artPx: Size;
  readonly pxPerUnit: number;
  readonly camera: CardCamera;
  readonly window: { readonly width: number; readonly height: number };
  readonly images: CardImages;
  readonly layers: readonly CardLayer[];
  readonly tilt: { readonly pivotDepth: number };
  readonly immersive: ImmersiveTrack | null;
}

export type CardFormatErrorCode = 'unsupported-schema' | 'invalid';

export class CardFormatError extends Error {
  constructor(
    readonly code: CardFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CardFormatError';
  }
}

// ---------------------------------------------------------------- validation helpers

type Obj = Readonly<Record<string, unknown>>;

function invalid(path: string, expected: string): never {
  throw new CardFormatError('invalid', `${path}: expected ${expected}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path, 'an object');
  return value as Obj;
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'a finite number');
  return value;
}

function int(value: unknown, path: string): number {
  const n = num(value, path);
  if (!Number.isInteger(n)) invalid(path, 'an integer');
  return n;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'a string');
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'a boolean');
  return value;
}

function arr(value: unknown, path: string, length?: number): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path, 'an array');
  if (length !== undefined && value.length !== length) invalid(path, `an array of ${length} items`);
  return value as readonly unknown[];
}

/** Array of exactly `length` finite numbers (callers narrow it to their tuple type). */
function nums(value: unknown, path: string, length: number): readonly number[] {
  return arr(value, path, length).map((v, i) => num(v, `${path}[${i}]`));
}

function size(value: unknown, path: string): Size {
  const [w, h] = arr(value, path, 2).map((v, i) => int(v, `${path}[${i}]`));
  if (w === undefined || h === undefined || w <= 0 || h <= 0) invalid(path, 'a positive [width, height]');
  return [w, h];
}

function vec3(value: unknown, path: string): Vec3 {
  return nums(value, path, 3) as unknown as Vec3;
}

function quad(value: unknown, path: string): Quad {
  return arr(value, path, 4).map((c, i) => vec3(c, `${path}[${i}]`)) as unknown as Quad;
}

/** File names inside a card folder: no path separators, no parent references. */
function fileName(value: unknown, path: string): string {
  const name = str(value, path);
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith('.')) invalid(path, 'a plain file name');
  return name;
}

function checkSchema(root: Obj, what: string): number {
  const schema = int(root.schema, `${what}.schema`);
  if (schema !== SUPPORTED_SCHEMA) {
    throw new CardFormatError('unsupported-schema', `${what}: schema ${schema}, supported ${SUPPORTED_SCHEMA}`);
  }
  return schema;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// ---------------------------------------------------------------- index.json

export function parseCardIndex(json: unknown): CardIndex {
  const root = obj(json, 'index');
  const schema = checkSchema(root, 'index');
  const sections =
    root.sections === undefined
      ? []
      : arr(root.sections, 'index.sections').map((s, i) => str(s, `index.sections[${i}]`));
  const cards = arr(root.cards, 'index.cards').map((value, i): CardIndexEntry => {
    const p = `index.cards[${i}]`;
    const c = obj(value, p);
    const id = str(c.id, `${p}.id`);
    if (!ID_PATTERN.test(id)) invalid(`${p}.id`, 'lowercase a-z, 0-9 and "-"');
    const path = str(c.path, `${p}.path`);
    if (!/^cards\/[a-z0-9-]+\.card$/.test(path)) invalid(`${p}.path`, '"cards/<id>.card"');
    const bytes = obj(c.bytes, `${p}.bytes`);
    return {
      id,
      name: str(c.name, `${p}.name`),
      number: str(c.number, `${p}.number`),
      section: str(c.section, `${p}.section`),
      order: num(c.order, `${p}.order`),
      version: str(c.version, `${p}.version`),
      path,
      immersive: bool(c.immersive, `${p}.immersive`),
      hasFront: bool(c.hasFront, `${p}.hasFront`),
      bytes: {
        base: num(bytes.base, `${p}.bytes.base`),
        full: num(bytes.full, `${p}.bytes.full`),
        half: num(bytes.half, `${p}.bytes.half`),
      },
    };
  });
  return { schema, sections, cards };
}

// ---------------------------------------------------------------- card.json

function parseWrap(value: unknown, path: string): Wrap {
  const w = str(value, path);
  if (w !== 'clamp' && w !== 'mirror') invalid(path, '"clamp" or "mirror"');
  return w;
}

function parseLayer(value: unknown, p: string): CardLayer {
  const l = obj(value, p);
  const kind = str(l.kind, `${p}.kind`);
  if (kind !== 'plane' && kind !== 'floor') invalid(`${p}.kind`, '"plane" or "floor"');
  const sizes = obj(l.size, `${p}.size`);
  const wrap = arr(l.wrap, `${p}.wrap`, 2);
  const tfw = arr(l.texFromWorld, `${p}.texFromWorld`, 3).map(
    (row, i) => nums(row, `${p}.texFromWorld[${i}]`, 4) as unknown as Row4,
  );
  const edge = obj(l.touchesEdge, `${p}.touchesEdge`);
  return {
    id: str(l.id, `${p}.id`),
    kind,
    depth: kind === 'plane' ? num(l.depth, `${p}.depth`) : null,
    file: fileName(l.file, `${p}.file`),
    opaque: bool(l.opaque, `${p}.opaque`),
    size: { full: size(sizes.full, `${p}.size.full`), half: size(sizes.half, `${p}.size.half`) },
    crop: nums(l.crop, `${p}.crop`, 4) as unknown as readonly [number, number, number, number],
    wrap: [parseWrap(wrap[0], `${p}.wrap[0]`), parseWrap(wrap[1], `${p}.wrap[1]`)],
    quad: quad(l.quad, `${p}.quad`),
    texFromWorld: tfw as unknown as readonly [Row4, Row4, Row4],
    windowQuad: quad(l.windowQuad, `${p}.windowQuad`),
    touchesEdge: {
      left: bool(edge.left, `${p}.touchesEdge.left`),
      top: bool(edge.top, `${p}.touchesEdge.top`),
      right: bool(edge.right, `${p}.touchesEdge.right`),
      bottom: bool(edge.bottom, `${p}.touchesEdge.bottom`),
    },
    coverage: num(l.coverage, `${p}.coverage`),
  };
}

function parseTrack(value: unknown): ImmersiveTrack | null {
  if (value === null) return null;
  const t = obj(value, 'card.immersive');
  const poses = arr(t.poses, 'card.immersive.poses').map(
    (pose, i) => nums(pose, `card.immersive.poses[${i}]`, 7) as unknown as Pose,
  );
  if (poses.length < 2) invalid('card.immersive.poses', 'at least 2 poses');
  const fps = num(t.fps, 'card.immersive.fps');
  if (fps <= 0) invalid('card.immersive.fps', 'a positive number');
  return {
    fps,
    sourceFrames: nums(t.sourceFrames, 'card.immersive.sourceFrames', 2) as unknown as readonly [number, number],
    duration: num(t.duration, 'card.immersive.duration'),
    minVisibleFraction: num(t.minVisibleFraction, 'card.immersive.minVisibleFraction'),
    poses,
  };
}

export function parseCard(json: unknown): Card {
  const c = obj(json, 'card');
  const schema = checkSchema(c, 'card');
  const cam = obj(c.camera, 'card.camera');
  const win = obj(c.window, 'card.window');
  const img = obj(c.images, 'card.images');
  const tilt = obj(c.tilt, 'card.tilt');
  const id = str(c.id, 'card.id');
  if (!ID_PATTERN.test(id)) invalid('card.id', 'lowercase a-z, 0-9 and "-"');
  const layers = arr(c.layers, 'card.layers').map((l, i) => parseLayer(l, `card.layers[${i}]`));
  if (layers.length === 0) invalid('card.layers', 'at least one layer');
  return {
    schema,
    id,
    name: str(c.name, 'card.name'),
    number: str(c.number, 'card.number'),
    section: str(c.section, 'card.section'),
    order: num(c.order, 'card.order'),
    version: str(c.version, 'card.version'),
    artPx: size(c.artPx, 'card.artPx'),
    pxPerUnit: num(c.pxPerUnit, 'card.pxPerUnit'),
    camera: {
      lensMm: num(cam.lensMm, 'card.camera.lensMm'),
      sensorHeightMm: num(cam.sensorHeightMm, 'card.camera.sensorHeightMm'),
      vfovRad: num(cam.vfovRad, 'card.camera.vfovRad'),
      aspect: num(cam.aspect, 'card.camera.aspect'),
      near: num(cam.near, 'card.camera.near'),
      far: num(cam.far, 'card.camera.far'),
      homeDistance: num(cam.homeDistance, 'card.camera.homeDistance'),
      homePosition: vec3(cam.homePosition, 'card.camera.homePosition'),
      homeRotation: nums(cam.homeRotation, 'card.camera.homeRotation', 4) as unknown as Quat,
    },
    window: { width: num(win.width, 'card.window.width'), height: num(win.height, 'card.window.height') },
    images: {
      front: img.front === null ? null : fileName(img.front, 'card.images.front'),
      frontSize: img.frontSize === null ? null : size(img.frontSize, 'card.images.frontSize'),
      thumb: fileName(img.thumb, 'card.images.thumb'),
      thumbSize: size(img.thumbSize, 'card.images.thumbSize'),
      artwork: fileName(img.artwork, 'card.images.artwork'),
      artworkSize: size(img.artworkSize, 'card.images.artworkSize'),
    },
    layers,
    tilt: { pivotDepth: num(tilt.pivotDepth, 'card.tilt.pivotDepth') },
    immersive: parseTrack(c.immersive),
  };
}

/** Path of a file of a card, relative to the cards repository root. */
export function cardFilePath(cardPath: string, ...parts: string[]): string {
  return [cardPath, ...parts].join('/');
}

export function layerFilePath(cardPath: string, layer: CardLayer, resolution: TextureResolution): string {
  return cardFilePath(cardPath, 'layers', resolution, layer.file);
}
