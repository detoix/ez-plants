import { ShadowCast } from './enums.js';
import { normalizePlantDetail } from './plant-detail.js';

/**
 * Level-of-detail vocabulary for plants.
 *
 * ## The library does not know about your camera
 *
 * A plant declares the levels it can be drawn at, each carrying a **suggested**
 * distance, and the caller says which one to draw:
 *
 * ```js
 * plant.setLevel(1);
 * ```
 *
 * That is the whole contract. Nothing in this library reads a camera, computes
 * a distance, or changes a level on its own. An application knows things the
 * library cannot — whether the plant is behind the viewer, whether it is a
 * thumbnail or a hero shot, whether it is being rendered for a print at ten
 * times the screen resolution, what its frame budget looks like this frame —
 * and any of those can matter more than metres.
 *
 * The distances are still worth stating, because the library *does* know
 * roughly where each level stops looking right for a plant of that size. They
 * are advice, published as data, for a caller that wants it:
 *
 * ```js
 * plant.lodLevels; // [{ distance: 0, ... }, { distance: 7, ... }, ...]
 * ```
 *
 * `PlantLODController` below turns that advice into a level index, with
 * hysteresis, if you want it. It is opt-in and nothing in the library
 * constructs one.
 */

/**
 * Validate and fully resolve a plant's LOD levels.
 *
 * Each level is normalized against a base detail, so a level never accidentally
 * inherits a value from the level before it in the list.
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

  // Shadow LOD is derived from level position rather than spelled out per
  // species, so a plant added tomorrow gets it without touching its level
  // table -- and a species that wants something else just says so, in which
  // case `declaresShadowCast` keeps this off its back.
  //
  // The ladder: the finest level casts everything, the coarsest casts nothing,
  // and the levels between keep only the woody silhouette. Casting is an extra
  // draw per shadow-casting light, and a leaf contributes almost nothing to a
  // distant silhouette, so organs are what drops out first.
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
 * Choose a level for one distance, honouring per-level hysteresis.
 *
 * Pure. `previous` is the level currently in effect, or null when nothing has
 * been chosen yet — a first choice has no level to be sticky about.
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
 * Turn a distance into a level index, with hysteresis. **Entirely optional.**
 *
 * Nothing in this library constructs one of these. It exists because picking a
 * level from a distance is fiddly in one specific way — without hysteresis a
 * plant sitting exactly on a boundary flips between levels every frame, and
 * the remesh that follows is expensive and the flicker is visible — and there
 * is no reason for every caller to rediscover that.
 *
 * It holds no plant and no camera. Give it a distance, get an index back, and
 * do what you like with it:
 *
 * ```js
 * const lod = new PlantLODController({ levels: plant.lodLevels });
 *
 * // in your own frame loop, from your own camera
 * const distance = camera.position.distanceTo(plant.position);
 * plant.setLevel(lod.levelFor(distance));
 * ```
 *
 * One controller tracks one plant's history, because hysteresis is per-plant
 * state. For a field, keep one per placement, or call the pure
 * `selectPlantLODLevel` with your own previous-level array.
 */
export class PlantLODController {
  /**
   * @param {object} options
   * @param {readonly object[]} options.levels Usually `plant.lodLevels`.
   */
  constructor({ levels } = {}) {
    if (!Array.isArray(levels) && !Object.isFrozen(levels)) {
      throw new TypeError('PlantLODController requires LOD levels.');
    }
    this.levels = normalizePlantLODLevels([...levels]);
    this.currentLevel = null;
    this.currentDistance = null;
  }

  /**
   * The level index for a world-space distance.
   * @param {number} distance
   * @returns {number}
   */
  levelFor(distance) {
    if (!Number.isFinite(distance) || distance < 0) {
      throw new RangeError('Plant LOD distance must be non-negative.');
    }
    this.currentDistance = distance;
    this.currentLevel = selectPlantLODLevel(
      distance,
      this.levels,
      this.currentLevel,
    );
    return this.currentLevel;
  }

  /** Forget the history hysteresis is measured against. */
  reset() {
    this.currentLevel = null;
    this.currentDistance = null;
    return this;
  }
}
