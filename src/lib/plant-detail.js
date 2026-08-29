import * as THREE from 'three';

import { Billboard, ShadowCast } from './enums.js';
import { keyedRandom } from './keyed-random.js';
import { sampleBranchSection } from './woody-geometry.js';

/** Shared, species-neutral defaults for procedural plant meshing. */
export const DEFAULT_PLANT_DETAIL = Object.freeze({
  sectionStride: 1,
  segmentFactor: 1,
  landmarkStride: 1,
  woodOrderLimit: Infinity,
  organLevel: 0,
  leafStride: 1,
  leafScale: 1,
  dropKinds: Object.freeze([]),
  billboard: null,
  shadowCast: ShadowCast.All,
  shadowReceive: true,
});

const SHADOW_CAST_VALUES = Object.freeze(Object.values(ShadowCast));

function positiveInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return Math.max(1, Math.floor(resolved));
}

function nonNegativeInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return Math.max(0, Math.floor(resolved));
}

/**
 * A branch order, or `Infinity` for "every order". Written as its own reader
 * because this is the one detail control whose neutral value is unbounded:
 * a stride of 1 keeps everything, but an order limit has to say so.
 */
function branchOrderLimit(value, fallback, name) {
  const resolved = value ?? fallback;
  if (resolved === Infinity) return Infinity;
  if (!Number.isFinite(resolved)) {
    throw new TypeError(`${name} must be a finite number or Infinity.`);
  }
  return Math.max(0, Math.floor(resolved));
}

function positiveNumber(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return resolved;
}

/**
 * Normalize the detail controls shared by tree and shrub meshers.
 * A caller-supplied fallback can provide the species' normal billboard mode.
 */
export function normalizePlantDetail(detail = {}, fallback = {}) {
  if (detail == null) detail = {};
  if (typeof detail !== 'object' || Array.isArray(detail)) {
    throw new TypeError('Plant detail must be an object.');
  }

  const billboard =
    detail.billboard ?? fallback.billboard ?? DEFAULT_PLANT_DETAIL.billboard;
  if (
    billboard != null &&
    billboard !== Billboard.Single &&
    billboard !== Billboard.Double
  ) {
    throw new RangeError(`Unknown leaf billboard mode: ${billboard}.`);
  }

  const shadowCast =
    detail.shadowCast ?? fallback.shadowCast ?? DEFAULT_PLANT_DETAIL.shadowCast;
  if (!SHADOW_CAST_VALUES.includes(shadowCast)) {
    throw new RangeError(`Unknown shadow cast mode: ${shadowCast}.`);
  }

  const dropKinds = Object.freeze([
    ...(detail.dropKinds ??
      fallback.dropKinds ??
      DEFAULT_PLANT_DETAIL.dropKinds),
  ]);
  if (dropKinds.some((kind) => typeof kind !== 'string' || !kind)) {
    throw new TypeError('dropKinds must be organ-kind names.');
  }

  const shadowReceive =
    detail.shadowReceive ??
    fallback.shadowReceive ??
    DEFAULT_PLANT_DETAIL.shadowReceive;
  if (typeof shadowReceive !== 'boolean') {
    throw new TypeError('shadowReceive must be a boolean.');
  }

  return {
    sectionStride: positiveInteger(
      detail.sectionStride,
      fallback.sectionStride ?? DEFAULT_PLANT_DETAIL.sectionStride,
      'sectionStride',
    ),
    segmentFactor: positiveNumber(
      detail.segmentFactor,
      fallback.segmentFactor ?? DEFAULT_PLANT_DETAIL.segmentFactor,
      'segmentFactor',
    ),
    landmarkStride: positiveInteger(
      detail.landmarkStride,
      fallback.landmarkStride ?? DEFAULT_PLANT_DETAIL.landmarkStride,
      'landmarkStride',
    ),
    woodOrderLimit: branchOrderLimit(
      detail.woodOrderLimit,
      fallback.woodOrderLimit ?? DEFAULT_PLANT_DETAIL.woodOrderLimit,
      'woodOrderLimit',
    ),
    organLevel: nonNegativeInteger(
      detail.organLevel,
      fallback.organLevel ?? DEFAULT_PLANT_DETAIL.organLevel,
      'organLevel',
    ),
    leafStride: positiveInteger(
      detail.leafStride,
      fallback.leafStride ?? DEFAULT_PLANT_DETAIL.leafStride,
      'leafStride',
    ),
    leafScale: positiveNumber(
      detail.leafScale,
      fallback.leafScale ?? DEFAULT_PLANT_DETAIL.leafScale,
      'leafScale',
    ),
    dropKinds,
    billboard,
    shadowCast,
    shadowReceive,
  };
}

/**
 * Select branch sections for a lower-detail mesh without losing the tip or
 * any attachment landmarks. Omitting `landmarks` preserves the exact source
 * section frames; passing an array enables interpolated landmark mode and
 * also interpolates the two endpoints, matching attachment-aware shrub tubes.
 */
export function samplePlantDetailSections(sections, stride, landmarks = null) {
  const resolvedStride = positiveInteger(stride, 1, 'sectionStride');
  const samples = new Map();
  const addSample = (position, section) => {
    samples.set(position.toFixed(12), { position, section });
  };

  for (let index = 0; index < sections.length; index += resolvedStride) {
    addSample(index / Math.max(1, sections.length - 1), sections[index]);
  }

  if (landmarks == null) {
    const finalIndex = sections.length - 1;
    addSample(finalIndex / Math.max(1, finalIndex), sections[finalIndex]);
  } else {
    if (!Array.isArray(landmarks)) {
      throw new TypeError('Plant detail landmarks must be an array.');
    }
    for (const landmark of [{ position: 0 }, ...landmarks, { position: 1 }]) {
      const position = THREE.MathUtils.clamp(landmark.position, 0, 1);
      const sampled =
        landmark.section ?? sampleBranchSection(sections, position);
      addSample(position, {
        origin: sampled.origin,
        tangent: sampled.tangent,
        normal: sampled.normal,
        binormal: sampled.binormal,
        radius: sampled.radius,
      });
    }
  }

  const ordered = [...samples.values()].sort((a, b) => a.position - b.position);
  return {
    sections: ordered.map(({ section }) => section),
    positions: ordered.map(({ position }) => position),
  };
}

/**
 * Thin the attachment landmarks a woody tube is pinned to.
 *
 * Every organ attached to an axis contributes a landmark, and every landmark
 * forces a ring into the tube. On a leafy shrub that is the dominant term: the
 * landmarks outnumber the curve's own sections, so raising `sectionStride`
 * alone barely moves the triangle count. Thinning them alongside the organs
 * they anchor is what actually makes a distant plant cheap.
 *
 * Endpoints are never dropped. A `base` or `tip` landmark carries the axis'
 * true origin rather than a sampled one, so losing it visibly detaches a twig
 * from its parent -- the one artefact this simplification must not produce.
 */
export function sampleWoodyLandmarks(landmarks, stride) {
  const resolvedStride = positiveInteger(stride, 1, 'landmarkStride');
  if (resolvedStride <= 1) return landmarks;
  if (!Array.isArray(landmarks)) {
    throw new TypeError('Woody landmarks must be an array.');
  }

  let interior = 0;
  return landmarks.filter((landmark) => {
    if (landmark.kind !== 'node') return true;
    return interior++ % resolvedStride === 0;
  });
}

/**
 * Return the requested organ scale when a stable ID survives detail culling,
 * or zero when it is culled. Keyed selection prevents temporal popping caused
 * by active-array reordering while keeping scaling in the same detail rule.
 */
export function stablePlantOrganDetailScale(
  seed,
  organId,
  stride,
  scale = 1,
  channel = 'plant-detail-organ-stride',
) {
  const resolvedStride = positiveInteger(stride, 1, 'organStride');
  const resolvedScale = positiveNumber(scale, 1, 'organScale');
  return resolvedStride <= 1 ||
    Math.floor(keyedRandom(seed, organId, channel) * resolvedStride) === 0
    ? resolvedScale
    : 0;
}
