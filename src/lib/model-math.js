import * as THREE from 'three';

import RNG from './rng.js';
import { keyedRandom } from './keyed-random.js';

/**
 * Plain arithmetic shared by every plant growth model.
 *
 * Growth models in this library are deliberately Three.js-free at their core:
 * they describe a plant as plain `{x, y, z}` records so a snapshot can be
 * serialised, diffed and tested without a renderer. These are the small
 * numeric helpers that every one of them needs.
 */

export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const clamp01 = (value) => clamp(value, 0, 1);
export const lerp = (a, b, amount) => a + (b - a) * amount;

export const vector = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => vector(a.x + b.x, a.y + b.y, a.z + b.z);
export const subtract = (a, b) => vector(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (value, amount) =>
  vector(value.x * amount, value.y * amount, value.z * amount);
export const cross = (a, b) =>
  vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (value) => Math.hypot(value.x, value.y, value.z);
export const normalize = (value) => {
  const magnitude = length(value) || 1;
  return scale(value, 1 / magnitude);
};

export function smoothstep01(value) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

export function progress(value, start, end) {
  return clamp01((value - start) / Math.max(0.0001, end - start));
}

/**
 * Piecewise-linear lookup over `[[at, value], ...]` anchor pairs.
 * Used for age curves, where a handful of cited or assumed waypoints is more
 * honest than fitting a formula to them.
 */
export function sampleAnchors(anchors, value) {
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [endAge, endValue] = anchors[index];
    const [startAge, startValue] = anchors[index - 1];
    if (value <= endAge) {
      return lerp(
        startValue,
        endValue,
        (value - startAge) / Math.max(0.0001, endAge - startAge),
      );
    }
  }
  return anchors.at(-1)[1];
}

/** Central-difference tangent along a polyline, clamped at both ends. */
export function tangentAt(points, index) {
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  return normalize(subtract(after, before));
}

/**
 * Rotate a plain vector about an arbitrary unit axis (Rodrigues' formula).
 * Used where a whole baked organ has to tip as one rigid body — a grass culm
 * leaning further open each winter, for instance — without rebuilding it.
 */
export function rotateAboutAxis(value, axis, angle) {
  const unit = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(value, cosine), scale(cross(unit, value), sine)),
    scale(unit, dot(unit, value) * (1 - cosine)),
  );
}

/** Recursively freeze an immutable growth graph before handing it out. */
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * EZ-Tree's axis grower takes a sequential RNG, while these models are keyed
 * so any organ can be regenerated in isolation. Seeding one RNG from the
 * persistent organ id keeps both properties: each axis gets its own
 * reproducible stream, so adding a leaf or a later axis cannot perturb any
 * previously generated wood.
 */
export function axisRng(seed, axisId, channel = 'ez-tree-axis-rng') {
  return new RNG(Math.floor(keyedRandom(seed, axisId, channel) * 0xffffffff));
}

/** Euler orientation whose local +Y points along `direction`. */
export function orientationFor(direction) {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    UP,
    new THREE.Vector3(direction.x, direction.y, direction.z).normalize(),
  );
  return new THREE.Euler().setFromQuaternion(quaternion);
}
