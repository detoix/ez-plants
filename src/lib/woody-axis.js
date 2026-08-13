import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Taper rules for a growing axis.
 *
 * `proportional` is EZ-Tree's deciduous rule: the radius falls to
 * `1 - taper` of its base by the tip. `linear` is the evergreen rule, where
 * the axis always runs out to a point because there is no terminal branch.
 */
export const AxisTaper = Object.freeze({
  Proportional: 'proportional',
  Linear: 'linear',
});

/**
 * Grow one woody axis section by section.
 *
 * This is EZ-Tree's branch-growing model lifted out of `Tree` so it can be
 * shared. Each step perturbs the running orientation by `gnarliness`, applies
 * a constant `twist`, and then rotates the growth direction toward (or away
 * from) `force.direction`.
 *
 * The force step is the interesting part for shrubs:
 *
 *     step = force.strength / sectionRadius
 *
 * Thin sections turn further than thick ones under the same force, so an axis
 * stays stiff where it is thick at the base and bends increasingly toward the
 * tip. That is the mechanism behind an arching shoot, and it is why a plant
 * whose habit is defined by its arch should grow its canes through this rather
 * than through a hand-fitted curve.
 *
 * The call order of `rng` is part of the contract: callers relying on a stable
 * seed (EZ-Tree's own presets) depend on it exactly as written.
 *
 * @returns {{origin: THREE.Vector3, orientation: THREE.Euler, radius: number}[]}
 */
export function growWoodyAxis({
  origin = new THREE.Vector3(),
  orientation = new THREE.Euler(),
  length = 1,
  radius = 1,
  sectionCount = 6,
  gnarliness = 0,
  twist = 0,
  taper = 0,
  taperMode = AxisTaper.Proportional,
  force = null,
  /** Radius forced on the final section, e.g. 0.001 to run an axis to a point. */
  tipRadius = null,
  rng,
  /** Optional per-section attractor, e.g. EZ-Tree's trellis. */
  attract = null,
} = {}) {
  if (!rng || typeof rng.random !== 'function') {
    throw new TypeError('growWoodyAxis requires an rng with random().');
  }
  if (!Number.isInteger(sectionCount) || sectionCount < 1) {
    throw new RangeError('sectionCount must be a positive integer.');
  }

  const sectionOrientation = orientation.clone();
  const sectionOrigin = origin.clone();
  const sectionLength = length / sectionCount;
  const sections = [];

  for (let i = 0; i <= sectionCount; i++) {
    let sectionRadius = radius;

    if (i === sectionCount && tipRadius != null) {
      sectionRadius = tipRadius;
    } else if (taperMode === AxisTaper.Proportional) {
      sectionRadius *= 1 - taper * (i / sectionCount);
    } else {
      sectionRadius *= 1 - i / sectionCount;
    }

    sections.push({
      origin: sectionOrigin.clone(),
      orientation: sectionOrientation.clone(),
      radius: sectionRadius,
    });

    sectionOrigin.add(
      new THREE.Vector3(0, sectionLength, 0).applyEuler(sectionOrientation),
    );

    // Perturb the orientation of the next section randomly. The higher the
    // gnarliness, the larger potential perturbation.
    const sectionGnarliness =
      Math.max(1, 1 / Math.sqrt(sectionRadius)) * gnarliness;

    sectionOrientation.x += rng.random(sectionGnarliness, -sectionGnarliness);
    sectionOrientation.z += rng.random(sectionGnarliness, -sectionGnarliness);

    const qSection = new THREE.Quaternion().setFromEuler(sectionOrientation);
    const qTwist = new THREE.Quaternion().setFromAxisAngle(UP, twist);
    qSection.multiply(qTwist);

    // Rotate the section's growth direction toward force.direction (positive
    // strength) or away from it (negative). The (sectionUp x target) axis makes
    // force.direction behave as a real world axis: when sectionUp is already
    // aligned with target the rotation is zero, so a vertical axis with
    // force=(0,1,0) doesn't get gnarliness drift amplified.
    if (force && force.strength) {
      const sectionUp = UP.clone().applyQuaternion(qSection);
      const target = new THREE.Vector3().copy(force.direction).normalize();
      const axis = new THREE.Vector3().crossVectors(sectionUp, target);
      const sinFull = axis.length();
      if (sinFull > 1e-6) {
        axis.divideScalar(sinFull);
        const fullAngle = Math.atan2(sinFull, sectionUp.dot(target));
        const step = force.strength / sectionRadius;
        const clamped = Math.max(-fullAngle, Math.min(fullAngle, step));
        qSection.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, clamped));
      }
    }

    if (attract) {
      const result = attract(sectionOrigin, sectionRadius);
      if (result) {
        const qAttract = new THREE.Quaternion().setFromUnitVectors(
          UP,
          result.direction,
        );
        qSection.rotateTowards(qAttract, result.strength);
      }
    }

    sectionOrientation.setFromQuaternion(qSection);
  }

  return sections;
}
