import * as THREE from 'three';

/**
 * One plant, frozen at every band it will ever be drawn at.
 *
 * ## Why a field needs prototypes rather than plants
 *
 * Woody geometry depends on the seed, and on age, and on day, and on the LOD
 * band. Two plants with different seeds have genuinely different skeletons, so
 * there is nothing to instance between them. Instancing a field therefore means
 * accepting a **pool of prototypes**: bake a handful of distinct seeds, and
 * scatter the field across them, taking variety from per-placement yaw and
 * scale rather than from per-placement geometry.
 *
 * That is the standard vegetation approach — prefab or tuft prototypes, jittered
 * per instance — and the reason it works is that the cost is bounded by the
 * number of prototypes rather than by the number of plants. Eight seeds at three
 * bands is twenty-four wood geometries, whether the field holds fifty plants or
 * five thousand.
 *
 * A plant that must have a unique skeleton is simply not a candidate for this,
 * and should be rendered on its own.
 *
 * ## What the prototype keeps
 *
 * A bake per band. Wood differs between them and is copied; organ geometry is
 * byte-identical across bands and comes from the shared cache, so only the
 * matrices and counts actually differ.
 *
 * **The source plant must stay alive.** A prototype holds the plant's
 * materials — including the leaf wind, which lives on the material's compiled
 * shader — and disposing the plant disposes them. Prototypes deliberately do
 * not clone: a cloned material loses its `onBeforeCompile` chain, and with it
 * the wind.
 */

/**
 * Bake one plant at each of its LOD bands.
 *
 * @param {import('../plant-renderer.js').PlantRenderer} plant Kept alive by the
 *   caller for as long as the prototype is used.
 * @param {object} [options]
 * @param {readonly object[]} [options.levels] Bands to bake at. Defaults to the
 *   plant's own `lodLevels`, so a field switches where the plant would have.
 * @param {string} [options.id]
 * @returns {object} prototype
 */
export function createPlantPrototype(plant, { levels = null, id = null } = {}) {
  if (typeof plant?.bake !== 'function') {
    throw new TypeError('A prototype needs a plant renderer to bake.');
  }

  const bands = levels ?? plant.lodLevels ?? [{ distance: 0, hysteresis: 0 }];
  const baked = bands.map((band) => plant.bake(band.detail ?? null));

  // Organ kinds are read off what the plant actually baked, never off a species
  // list. A plant with no wood contributes no wood; a plant with an organ kind
  // nothing else has contributes that kind. Adding a plant to the library needs
  // no change here.
  const organKinds = [];
  for (const bake of baked) {
    for (const organ of bake.organs) {
      if (!organKinds.includes(organ.kind)) organKinds.push(organ.kind);
    }
  }

  const bounds = new THREE.Box3();
  for (const bake of baked) bounds.union(bake.bounds);

  return {
    id: id ?? plant.name,
    plant,
    bands: bands.map((band, index) => ({
      distance: band.distance,
      hysteresis: band.hysteresis ?? 0,
      baked: baked[index],
    })),
    organKinds,
    bounds,

    /** Instances of one organ kind this prototype draws at one band. */
    organCount(kind, band) {
      const bake = baked[band];
      if (!bake) return 0;
      return bake.organs.find((organ) => organ.kind === kind)?.count ?? 0;
    },

    /** Total organ instances at one band — the number the budget counts. */
    instanceCount(band) {
      const bake = baked[band];
      if (!bake) return 0;
      return bake.organs.reduce((total, organ) => total + organ.count, 0);
    },

    /** Release the wood copies this prototype owns. Never the plant's own. */
    dispose() {
      for (const bake of baked) bake.dispose();
    },
  };
}

/**
 * Bake several plants into one pool a field can scatter across.
 *
 * Prototypes in a pool must be the same species: a field draws each organ kind
 * with one material, and takes it from the first prototype that declares the
 * kind.
 *
 * @param {readonly import('../plant-renderer.js').PlantRenderer[]} plants
 * @param {object} [options] Passed through to `createPlantPrototype`.
 * @returns {object[]}
 */
export function createPrototypePool(plants, options = {}) {
  if (!Array.isArray(plants) || plants.length === 0) {
    throw new TypeError('A prototype pool needs at least one plant.');
  }
  return plants.map((plant, index) =>
    createPlantPrototype(plant, {
      ...options,
      id: options.id ? `${options.id}:${index}` : undefined,
    }),
  );
}
