import * as THREE from 'three';
import { ShadowCast } from './enums.js';
import { normalizePlantDetail } from './plant-detail.js';

const cameraPosition = new THREE.Vector3();
const plantPosition = new THREE.Vector3();

/**
 * Validate and fully resolve distance-driven PlantDetail levels.
 *
 * Each level is normalized against the detail active when the controller is
 * created. This makes switching independent of traversal history: a far level
 * never accidentally inherits a value from the medium level that preceded it.
 */
export function normalizePlantLODLevels(levels, baseDetail = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('Plant LOD requires at least one level.');
  }

  const normalizedBase = normalizePlantDetail(baseDetail);
  const ordered = levels
    .map((level, index) => {
      if (level == null || typeof level !== 'object' || Array.isArray(level)) {
        throw new TypeError(`Plant LOD level ${index} must be an object.`);
      }

      const distance = level.distance ?? 0;
      const hysteresis = level.hysteresis ?? 0;
      if (!Number.isFinite(distance) || distance < 0) {
        throw new RangeError(
          `Plant LOD level ${index} distance must be non-negative.`,
        );
      }
      if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis > 1) {
        throw new RangeError(
          `Plant LOD level ${index} hysteresis must be between 0 and 1.`,
        );
      }

      return {
        distance,
        hysteresis,
        detail: normalizePlantDetail(level.detail ?? {}, normalizedBase),
        // Captured before sorting: whether this level chose its own shadow
        // policy, as opposed to inheriting the base detail's.
        declaresShadowCast: level.detail?.shadowCast != null,
        sourceIndex: index,
      };
    })
    .sort((a, b) => a.distance - b.distance || a.sourceIndex - b.sourceIndex);

  if (ordered[0].distance !== 0) {
    throw new RangeError(
      'The nearest Plant LOD level must start at distance 0.',
    );
  }
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].distance === ordered[index - 1].distance) {
      throw new RangeError('Plant LOD level distances must be unique.');
    }
  }

  // Shadow LOD is derived from band position rather than spelled out per
  // species, so a plant added tomorrow gets it without touching its level
  // table -- and a species that wants something else just says so, in which
  // case `declaresShadowCast` keeps this off its back.
  //
  // The ladder: the near band casts everything, the far band casts nothing,
  // and the bands in between keep only the woody silhouette. Casting is an
  // extra draw per shadow-casting light, and a leaf contributes almost
  // nothing to a distant silhouette, so organs are what drops out first.
  const lastIndex = ordered.length - 1;
  for (const [index, level] of ordered.entries()) {
    if (level.declaresShadowCast) continue;
    const derived =
      index === 0
        ? ShadowCast.All
        : index === lastIndex
          ? ShadowCast.None
          : ShadowCast.Wood;
    level.detail = { ...level.detail, shadowCast: derived };
  }

  return Object.freeze(
    ordered.map(
      ({
        sourceIndex: _sourceIndex,
        declaresShadowCast: _declared,
        ...level
      }) => Object.freeze({ ...level, detail: Object.freeze(level.detail) }),
    ),
  );
}

/**
 * Choose a band for one distance, honouring per-level hysteresis.
 *
 * Split out because the field layer assigns bands for hundreds of plants and
 * must make exactly the same choice a single plant would: hysteresis is easy
 * to get subtly wrong, and the failure mode is visible popping. `previous` is
 * the band currently in effect, or null when nothing has been selected yet —
 * a first selection has no band to be sticky about.
 *
 * @param {number} distance
 * @param {readonly object[]} levels Normalized, ascending by distance.
 * @param {number|null} [previous]
 * @returns {number} index into `levels`
 */
export function selectPlantLODLevel(distance, levels, previous = null) {
  let next = previous ?? 0;
  while (next + 1 < levels.length && distance >= levels[next + 1].distance) {
    next++;
  }
  if (previous == null) return next;

  while (
    next > 0 &&
    distance < levels[next].distance * (1 - levels[next].hysteresis)
  ) {
    next--;
  }
  return next;
}

/**
 * Lazily remesh one procedural plant as camera distance crosses LOD bands.
 *
 * Unlike THREE.LOD, this controller does not retain several complete plants.
 * It invokes an injected private detail sink, so the biological graph and
 * non-detail organs remain single and persistent without exposing renderer
 * internals on the plant object.
 */
export class PlantLODController {
  constructor({ target, detail, levels, applyDetail } = {}) {
    if (!target?.isObject3D || typeof applyDetail !== 'function') {
      throw new TypeError(
        'PlantLODController requires a THREE.Object3D and applyDetail().',
      );
    }

    this.target = target;
    this.applyDetail = applyDetail;
    this.baseDetail = Object.freeze(normalizePlantDetail(detail));
    this.levels = normalizePlantLODLevels(levels, this.baseDetail);
    this.currentLevel = null;
    this.currentDistance = null;
    this.disposed = false;
  }

  /** Select a level for an explicit world-space distance. */
  updateDistance(distance) {
    if (this.disposed) return false;
    if (!Number.isFinite(distance) || distance < 0) {
      throw new RangeError('Plant LOD distance must be non-negative.');
    }

    const nextLevel = selectPlantLODLevel(
      distance,
      this.levels,
      this.currentLevel,
    );

    this.currentDistance = distance;
    if (nextLevel === this.currentLevel) return false;

    this.applyDetail(this.levels[nextLevel].detail);
    this.currentLevel = nextLevel;
    return true;
  }

  /** Select a level from camera-to-plant world distance, like THREE.LOD. */
  update(camera) {
    if (this.disposed) return false;
    if (!camera?.isCamera) {
      throw new TypeError('Plant LOD update requires a THREE.Camera.');
    }

    camera.getWorldPosition(cameraPosition);
    this.target.getWorldPosition(plantPosition);
    const zoom =
      Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    return this.updateDistance(cameraPosition.distanceTo(plantPosition) / zoom);
  }

  /** Stop automatic switching and optionally restore the original detail. */
  dispose({ restore = true } = {}) {
    if (this.disposed) return;
    if (restore) this.applyDetail(this.baseDetail);
    this.disposed = true;
    this.target = null;
    this.applyDetail = null;
  }
}
