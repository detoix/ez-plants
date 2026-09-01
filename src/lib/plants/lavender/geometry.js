import * as THREE from 'three';

import {
  finishGeometry,
  validatePositiveInteger,
} from '../../organ-geometry.js';

/**
 * How much of the spike plate's width the painted head occupies.
 *
 * The tile is drawn at the spike's own proportions -- a 4 cm head 1.1 cm
 * across -- so the head spans this share of it and a card has to be
 * `width / SPIKE_PLATE_FILL` wide for the paint to land at the model's real
 * dimensions. It must move with `HALF_FILL` in
 * `scripts/make-spike-texture.mjs`, which is this number halved. Get it wrong
 * and 'Hidcote' comes out either as a bottlebrush or as a violet thread.
 */
export const SPIKE_PLATE_FILL = 0.27;

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * One lavender flower spike, as a crossed pair of textured cards.
 *
 * Rule 9's fuzz clause, applied to the organ this whole plant exists for. A
 * 'Hidcote' spike is five to nine whorls of tiny two-lipped corollas standing
 * out of a column of woolly calyces — several hundred separate parts on a
 * body four centimetres long, and a mature plant carries a hundred and fifty
 * of them at once. Meshed even coarsely that is tens of thousands of
 * triangles for something that is a violet smudge at two metres. As alpha it
 * is **eight triangles**, and mipmapping does exactly the right thing to it
 * as the plant recedes.
 *
 * Crossed rather than flat for the same reason the miscanthus head is: a
 * lavender in flower is a stand of a hundred spikes pointing in every
 * direction, so whichever way it is seen a third of them are edge on, and a
 * flat card at that angle disappears. Two ribbons keep every spike a solid
 * body from any azimuth, which is the entire reason to draw one.
 *
 * The unit frame is rooted at y = 0 and one unit tall, so the instance matrix
 * carries the spike's length in Y and its width in X and Z. `uv.y` runs from
 * the base to the tip and is therefore also the shared leaf wind's bend
 * weight: a spike stays put where its stem holds it and nods at the top,
 * which is what a real one does on a stiff square peduncle.
 *
 * @param {object} [options]
 * @param {number} [options.segments=2] Rows along the spike.
 * @param {boolean} [options.crossed=true] Two ribbons rather than one.
 * @param {number} [options.taper=0.42] How far the head narrows at its tip.
 * @param {number} [options.shoulder=0.16] Height of the widest point.
 */
export function createSpikeCardGeometry({
  segments = 2,
  crossed = true,
  taper = 0.42,
  shoulder = 0.16,
} = {}) {
  validatePositiveInteger(segments, 'segments');
  if (!Number.isFinite(taper) || taper < 0 || taper >= 1) {
    throw new RangeError('taper must be a finite number from 0 to 1.');
  }
  if (!Number.isFinite(shoulder) || shoulder < 0 || shoulder >= 1) {
    throw new RangeError('shoulder must be a finite number from 0 to 1.');
  }

  const positions = [];
  const colors = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // A spike is slightly narrower at the base than at its shoulder and drawn
  // out to a point above it. Half a unit is full width, so the card matches
  // the plate's own proportions once `SPIKE_PLATE_FILL` is applied.
  const halfWidthAt = (t) => {
    if (t <= shoulder)
      return 0.5 * (0.78 + 0.22 * (t / Math.max(1e-6, shoulder)));
    const above = (t - shoulder) / (1 - shoulder);
    return 0.5 * (1 - taper * above * above);
  };

  const ribbon = (across, facing) => {
    const base = positions.length / 3;
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      for (const side of [-1, 1]) {
        const point = across
          .clone()
          .multiplyScalar(side * halfWidthAt(t))
          .setY(t);
        positions.push(point.x, point.y, point.z);
        // Neutral. Every trace of hue belongs to the instance colour, or a
        // dry August head would keep July's violet baked into its own plate.
        colors.push(1, 1, 1);
        normals.push(facing.x, facing.y, facing.z);
        uvs.push((side + 1) / 2, t);
      }
    }
    for (let step = 0; step < segments; step += 1) {
      const a = base + step * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  const axisA = SIDE.clone();
  const axisB = new THREE.Vector3(0, 0, 1);
  ribbon(axisA, axisB);
  if (crossed) ribbon(axisB, axisA);

  return finishGeometry({
    positions,
    colors,
    indices,
    normals,
    uvs,
    userData: { organ: 'spike', crossed, segments },
  });
}

export { UP as SPIKE_UP };
