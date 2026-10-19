// Camera poses and projection (RENDERING.md §4, CARD_FORMAT.md §3 and §6).
import type { CardCamera, ImmersiveTrack, Quat, Vec3 } from '../data/card-format';
import {
  invertRigid,
  lerp3,
  multiplyAll,
  ndcShift,
  perspective,
  quatNormalize,
  rotationFromQuat,
  slerp,
  translation,
  type Mat4,
} from './math';

export interface CameraPose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

export function homePose(camera: CardCamera): CameraPose {
  return { position: camera.homePosition, rotation: quatNormalize(camera.homeRotation) };
}

/**
 * Pose at time t (seconds) on the immersive track: k = t·fps, i = floor(k), a = k − i;
 * position = lerp, rotation = slerp. t is clamped to [0, duration].
 */
export function poseAtTime(track: ImmersiveTrack, t: number): CameraPose {
  const last = track.poses.length - 1;
  const k = Math.min(Math.max(t * track.fps, 0), last);
  const i = Math.floor(k);
  const j = Math.min(i + 1, last);
  const a = k - i;
  const p = track.poses[i];
  const q = track.poses[j];
  if (!p || !q) throw new Error('empty immersive track');
  return {
    position: lerp3([p[0], p[1], p[2]], [q[0], q[1], q[2]], a),
    rotation: slerp([p[3], p[4], p[5], p[6]], [q[3], q[4], q[5], q[6]], a),
  };
}

/** view = inverse(T(position) · R(rotation)). */
export function viewMatrix(pose: CameraPose): Mat4 {
  return invertRigid(multiplyAll(translation(pose.position), rotationFromQuat(pose.rotation)));
}

export interface ProjectionOptions {
  /** Vertical field of view (radians). */
  readonly fovy: number;
  readonly near: number;
  readonly far: number;
  /** Viewport size in device pixels; the projection aspect is width / height (square pixels). */
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Projection · view. The image is shifted by half a pixel so that pixel (i, j) shows the scene at the
 * pixel-centre position (i, j) of the reference renderer (OpenCV convention: pixel centres on integer
 * coordinates, principal point at (W/2, H/2)); see docs/RENDERING.md §2a.
 */
export function viewProjection(pose: CameraPose, options: ProjectionOptions): Mat4 {
  const { fovy, near, far, widthPx, heightPx } = options;
  const proj = perspective(fovy, widthPx / heightPx, near, far);
  return multiplyAll(ndcShift(1 / widthPx, -1 / heightPx), proj, viewMatrix(pose));
}
