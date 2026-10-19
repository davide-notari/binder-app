// Which pyramid levels a card really uses on this screen (RENDERING.md §6a). The renderer picks one level per
// layer and frame (sampling.ts); evaluating that choice over every pose the card can show — the whole immersive
// track and the extreme tilt views — gives the finest level each layer can ever need. Finer levels are
// dropped after the pyramid is built: the picture is identical, the GPU memory much smaller.
import type { Card, TextureResolution } from '../data/card-format';
import { homePose, poseAtTime, tiltPose, zoomedFovy, type CameraPose } from './camera';
import { referenceLevel } from './sampling';
import type { TiltFit } from './tilt-fit';

export interface ScreenSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Finest level needed per layer (0 = the texture itself). */
export function finestLevels(card: Card, resolution: TextureResolution, screen: ScreenSize, tilt: TiltFit): number[] {
  const views: { pose: CameraPose; fovy: number }[] = [{ pose: homePose(card.camera), fovy: card.camera.vfovRad }];
  const track = card.immersive;
  if (track) {
    for (let i = 0; i < track.poses.length; i++) {
      views.push({ pose: poseAtTime(track, i / track.fps), fovy: card.camera.vfovRad });
    }
  }
  const tiltFovy = zoomedFovy(card.camera.vfovRad, tilt.zoom);
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      views.push({ pose: tiltPose(card, { x, y }, tilt.maxOffset), fovy: tiltFovy });
    }
  }
  return card.layers.map((layer) => {
    const size = layer.size[resolution];
    let finest = Infinity;
    for (const { pose, fovy } of views) {
      finest = Math.min(finest, referenceLevel(layer, size, { pose, fovy, ...screen }));
      if (finest === 0) break;
    }
    return finest;
  });
}
