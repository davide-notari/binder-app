import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCard, type Vec3 } from '../../src/data/card-format';
import { homePose, poseAtTime, viewProjection } from '../../src/render/camera';
import {
  invertRigid,
  multiply,
  rotationFromQuat,
  slerp,
  texFromWorldMatrix,
  transform,
  translation,
} from '../../src/render/math';

const card = parseCard(JSON.parse(readFileSync('tests/fixtures/cards-repo/cards/testcard.card/card.json', 'utf8')));
const track = card.immersive!;

function close(actual: readonly number[], expected: readonly number[], eps = 1e-6): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - (expected[i] ?? NaN)), `index ${i}: ${v} vs ${expected[i]}`).toBeLessThan(eps);
  });
}

describe('math', () => {
  it('home rotation looks along +Y with +Z up (CARD_FORMAT §3)', () => {
    const r = rotationFromQuat(card.camera.homeRotation);
    close(transform(r, [0, 0, -1, 0]), [0, 1, 0, 0]); // camera −Z
    close(transform(r, [0, 1, 0, 0]), [0, 0, 1, 0]); // camera +Y
  });

  it('inverts rigid transforms', () => {
    const m = multiply(translation([1, -2, 3]), rotationFromQuat([0.2, -0.3, 0.1, 0.927]));
    const id = multiply(invertRigid(m), m);
    close(Array.from(id), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-3);
  });

  it('slerp keeps endpoints and stays normalized', () => {
    const a = [0, 0, 0, 1] as const;
    const b = [0.7071068, 0, 0, 0.7071068] as const;
    close(slerp(a, b, 0), a);
    close(slerp(a, b, 1), b);
    const mid = slerp(a, b, 0.5);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 12);
    close(mid, [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)]);
  });

  it('texFromWorld maps every clamp layer quad to the texture corners (row-major JSON -> GLSL layout)', () => {
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const layer of card.layers.filter((l) => l.wrap[0] === 'clamp' && l.wrap[1] === 'clamp')) {
      const m = texFromWorldMatrix(layer.texFromWorld);
      layer.quad.forEach((c, i) => {
        const [uq, vq, q] = transform(m, [c[0], c[1], c[2], 1]);
        close([uq / q, vq / q], corners[i]!, 1e-5);
      });
    }
  });
});

describe('camera', () => {
  it('the immersive track starts and ends at home', () => {
    const home = homePose(card.camera);
    for (const t of [0, track.duration, -1, track.duration + 5]) {
      const pose = poseAtTime(track, t);
      close(pose.position, home.position, 1e-6);
      close(pose.rotation, home.rotation, 1e-6);
    }
  });

  it('samples poses at frame times and interpolates in between', () => {
    const p10 = track.poses[10]!;
    const p11 = track.poses[11]!;
    const at10 = poseAtTime(track, 10 / track.fps);
    close(at10.position, p10.slice(0, 3));
    const half = poseAtTime(track, 10.5 / track.fps);
    close(
      half.position,
      [0, 1, 2].map((k) => (p10[k]! + p11[k]!) / 2),
    );
  });

  it('home view: the drawing window fills the viewport, on the reference pixel grid', () => {
    const [width, height] = card.artPx; // exactly the camera aspect
    const vp = viewProjection(homePose(card.camera), {
      fovy: card.camera.vfovRad,
      near: card.camera.near,
      far: card.camera.far,
      widthPx: width,
      heightPx: height,
    });
    const expected = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ];
    // planes only: a floor's windowQuad covers just the part of the drawing where the floor is
    for (const layer of card.layers.filter((l) => l.kind === 'plane')) {
      layer.windowQuad.forEach((c: Vec3, i) => {
        const [x, y, , w] = transform(vp, [c[0], c[1], c[2], 1]);
        const [ex, ey] = expected[i]!;
        // pixel centre (i, j) of the reference = GL window position (i + 0.5, j + 0.5): shift of 1/W, −1/H in NDC
        close([x / w, y / w], [ex! + 1 / width, ey! - 1 / height], 1e-5);
      });
    }
  });
});
