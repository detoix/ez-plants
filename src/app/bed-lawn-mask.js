import * as THREE from 'three/webgpu';

import { BED_RADIUS, BED_SHAPE, CENTRE_FRACTION } from './bed-layout.js';

const { Fn, float, vec2 } = THREE.TSL;

/**
 * How far past the mulch edge the lawn is held back, in metres.
 *
 * The cobble edging stands on the outline plus 5.5 cm and is about 34 cm
 * across, so blades have to stop clear of its outer face or they grow up
 * through the stones.
 */
export const LAWN_KEEP_OUT = 0.3;

/**
 * The bed, as a keep-out for `createGPUDrivenGrass`.
 *
 * ## Why this is not the polygon test
 *
 * `bed-layout.js` decides what is inside the bed against the outline polygon,
 * which is exact and costs a walk over 240 segments. This runs in the culling
 * compute pass over 1.1 million grass candidates every frame, so it evaluates
 * the polar curve directly instead -- and does it with no trig at all.
 * Normalizing the vector yields `sin(theta)` and `cos(theta)`, and the angle
 * sum identities turn both harmonics into multiplies:
 *
 *   sin(theta + p)   = sin*cos(p) + cos*sin(p)
 *   sin(2*theta + p) = (2*sin*cos)*cos(p) + (1 - 2*sin^2)*sin(p)
 *
 * About fifteen ALU operations and no transcendentals, against the six plane
 * dot products the pass already pays for frustum culling.
 *
 * `bedKeepsLawnAt` in `bed-layout.js` is the scalar twin of this function, and
 * `test/bed-lawn-mask.test.js` holds the two to the same answer.
 *
 * @param {object} [options]
 * @param {number} [options.radius] Bed radius, matching the layout's.
 * @param {number} [options.margin] Metres of bare ground outside the mulch.
 * @returns {Function} `(worldXZ) => booleanNode`, true where a blade may stand.
 */
export function createBedLawnMask({
  radius = BED_RADIUS,
  margin = LAWN_KEEP_OUT,
} = {}) {
  const centre = vec2(
    float(CENTRE_FRACTION.x * radius),
    float(CENTRE_FRACTION.z * radius),
  );
  const cosA = float(Math.cos(BED_SHAPE.phaseA));
  const sinA = float(Math.sin(BED_SHAPE.phaseA));
  const cosB = float(Math.cos(BED_SHAPE.phaseB));
  const sinB = float(Math.sin(BED_SHAPE.phaseB));
  const amplitudeA = float(BED_SHAPE.a);
  const amplitudeB = float(BED_SHAPE.b);
  const edge = float(radius);
  const keepOut = float(margin);

  const keepAt = Fn(([worldXZ]) => {
    // Undo the layout's centring, so the point is expressed against the polar
    // curve's own origin rather than the bed's centre of area.
    const q = worldXZ.add(centre).toVar('bedLocal');
    const length = q.length().max(1e-4).toVar('bedRadiusHere');
    const unit = q.div(length).toVar('bedDirection');
    const cos = unit.x;
    const sin = unit.y;
    const first = sin.mul(cosA).add(cos.mul(sinA));
    const second = sin
      .mul(cos)
      .mul(2)
      .mul(cosB)
      .add(sin.mul(sin).mul(2).oneMinus().mul(sinB));
    const outline = edge.mul(
      first.mul(amplitudeA).add(second.mul(amplitudeB)).add(1),
    );
    return length.greaterThan(outline.add(keepOut));
  });

  return (worldXZ) => keepAt(worldXZ);
}
