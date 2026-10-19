// Small linear algebra for the renderer. Matrices are 4×4, column-major (GLSL layout), in double precision;
// they are converted to Float32Array only when uploaded as uniforms.
import type { Quat, Row4, Vec3 } from '../data/card-format';

export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Element at (row, col). */
export function at(m: Mat4, row: number, col: number): number {
  return m[col * 4 + row] ?? 0;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += at(a, row, k) * at(b, k, col);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** a · b · c · ... */
export function multiplyAll(...ms: Mat4[]): Mat4 {
  return ms.reduce((acc, m) => multiply(acc, m));
}

export function transform(m: Mat4, v: readonly [number, number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    out[row] = at(m, row, 0) * v[0] + at(m, row, 1) * v[1] + at(m, row, 2) * v[2] + at(m, row, 3) * v[3];
  }
  return out;
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation matrix of a unit quaternion [x, y, z, w]. */
export function rotationFromQuat(q: Quat): Mat4 {
  const [x, y, z, w] = q;
  const m = identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

export function translation(v: Vec3): Mat4 {
  const m = identity();
  m[12] = v[0];
  m[13] = v[1];
  m[14] = v[2];
  return m;
}

/** Inverse of a rigid transform (rotation + translation): R^T and −R^T·t. */
export function invertRigid(m: Mat4): Mat4 {
  const out = identity();
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[col * 4 + row] = at(m, col, row);
  }
  const tx = at(m, 0, 3);
  const ty = at(m, 1, 3);
  const tz = at(m, 2, 3);
  for (let row = 0; row < 3; row++) {
    out[12 + row] = -(at(out, row, 0) * tx + at(out, row, 1) * ty + at(out, row, 2) * tz);
  }
  return out;
}

/** Standard OpenGL perspective projection (right-handed view space, camera looking along −Z). */
export function perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Clip-space matrix that shifts the image by (dx, dy) in normalized device coordinates. */
export function ndcShift(dx: number, dy: number): Mat4 {
  // applied to clip coordinates: x' = x + dx·w, y' = y + dy·w (column 3 multiplies w)
  const m = identity();
  m[12] = dx;
  m[13] = dy;
  return m;
}

/** layer.texFromWorld (row-major 3×4 in JSON) as a column-major 4×4 whose rows 0..2 are the JSON rows. */
export function texFromWorldMatrix(rows: readonly [Row4, Row4, Row4]): Mat4 {
  const m = new Float64Array(16);
  rows.forEach((r, row) => {
    for (let col = 0; col < 4; col++) m[col * 4 + row] = r[col] ?? 0;
  });
  m[15] = 1;
  return m;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Spherical interpolation. The track stores hemisphere-continuous quaternions, so no sign flip is applied
 * (CARD_FORMAT.md §6). Nearly parallel quaternions use a normalized lerp, like verify_card.py.
 */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let wa: number;
  let wb: number;
  if (d > 0.9995) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(Math.min(1, Math.max(-1, d)));
    const s = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / s;
    wb = Math.sin(t * theta) / s;
  }
  return quatNormalize([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2], wa * a[3] + wb * b[3]]);
}

export function toFloat32(m: Mat4): Float32Array {
  return new Float32Array(m);
}

/** Unit quaternion [x, y, z, w] of the rotation part of a matrix. */
export function quatFromRotation(m: Mat4): Quat {
  const m00 = at(m, 0, 0);
  const m11 = at(m, 1, 1);
  const m22 = at(m, 2, 2);
  const trace = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(at(m, 2, 1) - at(m, 1, 2)) / s, (at(m, 0, 2) - at(m, 2, 0)) / s, (at(m, 1, 0) - at(m, 0, 1)) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (at(m, 0, 1) + at(m, 1, 0)) / s, (at(m, 0, 2) + at(m, 2, 0)) / s, (at(m, 2, 1) - at(m, 1, 2)) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(at(m, 0, 1) + at(m, 1, 0)) / s, s / 4, (at(m, 1, 2) + at(m, 2, 1)) / s, (at(m, 0, 2) - at(m, 2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(at(m, 0, 2) + at(m, 2, 0)) / s, (at(m, 1, 2) + at(m, 2, 1)) / s, s / 4, (at(m, 1, 0) - at(m, 0, 1)) / s];
  }
  return quatNormalize(q);
}

/** Rotation of a camera at `eye` looking at `target` (camera −Z forward, +Y up as close as possible to `up`). */
export function lookAtRotation(eye: Vec3, target: Vec3, up: Vec3): Quat {
  const f = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = normalize(cross(f, up));
  const u = cross(r, f);
  const m = identity();
  // columns: camera X = r, camera Y = u, camera Z = −f
  m[0] = r[0];
  m[1] = r[1];
  m[2] = r[2];
  m[4] = u[0];
  m[5] = u[1];
  m[6] = u[2];
  m[8] = -f[0];
  m[9] = -f[1];
  m[10] = -f[2];
  return quatFromRotation(m);
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
