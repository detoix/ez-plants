import * as THREE from 'three';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';

import { assertInstancingPatch } from './three-copy-guard.js';

/**
 * Many plants, few draw calls.
 *
 * ## The shape of the problem
 *
 * A single plant is already efficient — one instanced mesh per organ kind, one
 * merged mesh for wood, eight to ten draw calls however many thousand organs it
 * carries. What it does not do is share anything with the plant next to it. A
 * hundred plants is a hundred separate sets of meshes.
 *
 * The field closes that, and it does so differently for the two mesh families,
 * because they want opposite answers:
 *
 * **Organs — one mesh for the whole field, spanning every band.** Organ LOD in
 * this library does not simplify geometry; it draws *fewer* organs and fattens
 * the survivors to compensate. The `BufferGeometry` is byte-identical between
 * bands. So a near plant contributing three thousand leaves and a far one
 * contributing four hundred belong in the same buffer and the same draw call,
 * and the band shows up only in how many instances each writes.
 *
 * **Wood — one mesh per prototype, with real geometry LODs.** Here the buffers
 * genuinely differ between bands: different vertex counts, different indices,
 * a real remesh. Those must be separate geometries, which is exactly what
 * `addLOD` is for, and the per-instance distance selection comes for free.
 *
 * ## What this class is not
 *
 * A thin adapter, deliberately. Everything specific to `@three.ez/instanced-mesh`
 * lives in this file, so the dependency stays swappable, and nothing outside
 * `src/lib/field/` imports it. The dependency arrow points **field → plant, and
 * never plant → field**: that is what keeps `three` the only thing an extracted
 * plant needs.
 *
 * The field also knows nothing about which plants exist. It reads organ kinds
 * off what a prototype baked. A plant added to the library tomorrow works here
 * with no change to this file.
 *
 * ## It knows nothing about your camera either
 *
 * Levels are the caller's decision, exactly as they are for a single plant.
 * The field never measures a distance and never changes a level on its own:
 *
 * ```js
 * field.setLevels(levels);          // one index per placement
 * field.setLevelAt(index, 2);       // or one at a time
 * ```
 *
 * The budget is advisory for the same reason. If the levels you chose need
 * more instances than you budgeted for, the field draws them anyway and says
 * so in `stats().overBudget`. Silently coarsening a plant you explicitly asked
 * for would be the library overruling you, which is the thing this design is
 * built to avoid.
 */

/**
 * Organ instances the whole field may draw at once, across every organ kind.
 *
 * One field-wide number rather than one per kind, deliberately: band assignment
 * has to enforce it, and a placement is promoted or demoted as a whole plant —
 * its leaves and its petioles move together. Because the total is capped, no
 * single kind can exceed it either, which is what lets each buffer be allocated
 * once and never overflow.
 *
 * Roughly 32 MB of matrices. Raise it for a static hero shot, lower it for a
 * tight frame budget.
 *
 * **What this default actually buys, measured.** A mature Forsythia still draws
 * about 2,100 organ instances at its *coarsest* band — the far band coarsens
 * the wood but keeps every surviving leaf as real geometry. So this budget
 * seats somewhere around 230 of them before band assignment runs out of
 * demotions and starts dropping plants outright, which `stats().dropped`
 * reports. That ceiling is not a property of the budget; it is the missing
 * far/imposter band. Until the coarsest band becomes a card rather than a
 * canopy, a large field either costs proportionally more memory or loses its
 * furthest plants, and no choice of number here changes that.
 */
export const DEFAULT_INSTANCE_BUDGET = 500_000;

const matrix = new THREE.Matrix4();
const organMatrix = new THREE.Matrix4();
const colour = new THREE.Color();

/** Accept a Vector3, an array or an {x,y,z}. */
function toVector(value) {
  if (value == null) return new THREE.Vector3();
  if (value.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3().fromArray(value);
  return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

export class PlantField extends THREE.Group {
  /**
   * @param {object} options
   * @param {object[]} options.prototypes Same species, from
   *   `createPlantPrototype`. A field scatters placements across them.
   * @param {object[]} options.placements `{ position, rotationY?, scale?,
   *   prototype? }`. `prototype` is an index into `prototypes`; omitted, one is
   *   chosen deterministically from the placement's index.
   * @param {number} [options.budget] Peak organ instances for the whole
   *   field, across every organ kind.
   * @param {THREE.WebGLRenderer} [options.renderer] Strongly recommended.
   *   Without it instanced-mesh initialises its buffers during the first render
   *   and draws nothing on frame one — invisible in a render loop, a blank
   *   image for a single-shot render such as a thumbnail or a poster.
   * @param {boolean} [options.castShadow]
   * @param {boolean} [options.receiveShadow]
   */
  constructor({
    prototypes,
    placements,
    budget = DEFAULT_INSTANCE_BUDGET,
    renderer = null,
    castShadow = true,
    receiveShadow = true,
    name = 'PlantField',
  } = {}) {
    super();

    // Fail here rather than render a field whose per-instance transforms never
    // reach the shader. See three-copy-guard.js for why this is not paranoia.
    assertInstancingPatch();

    if (!Array.isArray(prototypes) || prototypes.length === 0) {
      throw new TypeError('A field needs at least one prototype.');
    }
    if (!Array.isArray(placements) || placements.length === 0) {
      throw new TypeError('A field needs at least one placement.');
    }

    this.name = name;
    this._prototypes = prototypes;
    this._budget = budget;
    this._renderer = renderer;
    this._bandsPerPrototype = prototypes[0].bands.length;

    for (const prototype of prototypes) {
      if (prototype.bands.length !== this._bandsPerPrototype) {
        throw new RangeError(
          'Every prototype in a field must share the same LOD bands.',
        );
      }
    }

    this._placements = placements.map((placement, index) => {
      const which = placement.prototype ?? index % prototypes.length;
      const prototype = prototypes[which];
      if (!prototype) {
        throw new RangeError(`Placement ${index} names no known prototype.`);
      }
      const transform = new THREE.Matrix4().compose(
        toVector(placement.position),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          placement.rotationY ?? 0,
        ),
        new THREE.Vector3().setScalar(placement.scale ?? 1),
      );
      const level = placement.level ?? 0;
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level >= prototype.bands.length
      ) {
        throw new RangeError(
          `Placement ${index} asks for level ${level}; this prototype has ` +
            `${prototype.bands.length}.`,
        );
      }
      return { prototype, which, transform, level };
    });

    this._levels = Int32Array.from(this._placements.map((p) => p.level));
    this._organMeshes = new Map();
    this._woodMeshes = [];
    this._stats = {
      drawCalls: 0,
      organInstances: 0,
      overBudget: false,
      repacks: 0,
    };

    this._createWoodMeshes({ castShadow, receiveShadow });
    this._createOrganMeshes({ castShadow, receiveShadow });
    this._repack();
  }

  /* ------------------------------------------------------------------ *
   * Construction
   * ------------------------------------------------------------------ */

  /**
   * One mesh per prototype, carrying that prototype's wood at every band as
   * real geometry LODs. instanced-mesh picks the level per instance from
   * camera distance, so a field of mixed distances costs one draw call per
   * prototype per level actually in use.
   */
  _createWoodMeshes({ castShadow, receiveShadow }) {
    for (const [index, prototype] of this._prototypes.entries()) {
      const placements = this._placements.filter(
        (placement) => placement.prototype === prototype,
      );
      const [near, ...rest] = prototype.bands;
      if (!near.baked.wood || placements.length === 0) {
        this._woodMeshes.push(null);
        continue;
      }

      const mesh = new InstancedMesh2(
        near.baked.wood.geometry,
        near.baked.wood.material,
        { capacity: placements.length, renderer: this._renderer },
      );
      mesh.name = `${this.name}_Wood_${index}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;

      for (const band of rest) {
        if (!band.baked.wood) continue;
        mesh.addLOD(
          band.baked.wood.geometry,
          band.baked.wood.material,
          band.distance,
          band.hysteresis,
        );
      }

      // The shadow pass gets the coarsest wood it can. A silhouette needs the
      // outline, not the bark, and this is the same trade Phase 1 makes for a
      // single plant — expressed per instance here rather than per plant.
      const coarsest = prototype.bands.at(-1);
      if (castShadow && coarsest !== near && coarsest.baked.wood) {
        mesh.addShadowLOD(near.baked.wood.geometry);
        mesh.addShadowLOD(coarsest.baked.wood.geometry, coarsest.distance);
      }

      mesh.addInstances(placements.length);
      for (const [slot, placement] of placements.entries()) {
        mesh.setMatrixAt(slot, placement.transform);
      }
      mesh.computeBoundingBox();

      this._woodMeshes.push(mesh);
      this.add(mesh);
    }
  }

  /**
   * One mesh per organ kind for the entire field, sized to the budget rather
   * than to the field's theoretical peak.
   */
  _createOrganMeshes({ castShadow, receiveShadow }) {
    const kinds = [];
    for (const prototype of this._prototypes) {
      for (const kind of prototype.organKinds) {
        if (!kinds.includes(kind)) kinds.push(kind);
      }
    }

    for (const kind of kinds) {
      const source = this._prototypes
        .flatMap((prototype) => prototype.bands[0].baked.organs)
        .find((organ) => organ.kind === kind);
      if (!source) continue;

      // Sized to the levels the caller actually chose, not to the field's
      // theoretical peak and not to the budget. instanced-mesh grows its
      // buffers when asked for more, so this is a starting size rather than a
      // wall -- which is what lets `setLevels` raise detail later without the
      // field having to refuse.
      const capacity = Math.max(
        1,
        this._placements.reduce(
          (total, placement) =>
            total + placement.prototype.organCount(kind, placement.level),
          0,
        ),
      );

      const mesh = new InstancedMesh2(source.geometry, source.material, {
        capacity,
        renderer: this._renderer,
      });
      mesh.name = `${this.name}_${source.name}`;
      mesh.castShadow = castShadow && source.castShadow;
      mesh.receiveShadow = receiveShadow && source.receiveShadow;
      // Real bounds and real culling, unlike a single plant's pools, which
      // switch culling off because their instances sit outside the base
      // geometry's bounds and there is only one of them anyway.
      mesh.perObjectFrustumCulled = true;

      this._organMeshes.set(kind, { mesh, capacity });
      this.add(mesh);
    }
  }

  /* ------------------------------------------------------------------ *
   * Levels and packing
   * ------------------------------------------------------------------ */

  /** The level each placement is drawn at. A copy; use `setLevels` to change. */
  get levels() {
    return Array.from(this._levels);
  }

  /**
   * Set every placement's level at once.
   *
   * @param {ArrayLike<number>} levels One index per placement, in the order
   *   the placements were given.
   */
  setLevels(levels) {
    if (levels?.length !== this._placements.length) {
      throw new RangeError(
        `Expected ${this._placements.length} levels, got ${levels?.length}.`,
      );
    }

    let changed = false;
    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index];
      this._validateLevel(index, level);
      if (level !== this._levels[index]) changed = true;
    }
    if (!changed) return this;

    this._levels.set(levels);
    return this._repack();
  }

  /**
   * Set one placement's level.
   *
   * @param {number} index
   * @param {number} level
   */
  setLevelAt(index, level) {
    if (!Number.isInteger(index) || index < 0 || index >= this._levels.length) {
      throw new RangeError(`No placement at index ${index}.`);
    }
    this._validateLevel(index, level);
    if (this._levels[index] === level) return this;
    this._levels[index] = level;
    return this._repack();
  }

  _validateLevel(index, level) {
    const available = this._placements[index].prototype.bands.length;
    if (!Number.isInteger(level) || level < 0 || level >= available) {
      throw new RangeError(
        `Placement ${index} was given level ${level}; it has ${available}.`,
      );
    }
  }

  _repack() {
    this._stats.repacks += 1;
    let organInstances = 0;

    for (const [kind, entry] of this._organMeshes) {
      const { mesh } = entry;
      mesh.clearInstances();

      let needed = 0;
      for (const [index, placement] of this._placements.entries()) {
        needed += placement.prototype.organCount(kind, this._levels[index]);
      }
      if (needed === 0) continue;

      // Draw what was asked for. If it is more than the buffer holds,
      // instanced-mesh grows it -- the caller chose these levels deliberately,
      // and quietly dropping some plant's leaves would be this class deciding
      // it knew better. Going over budget is reported, not corrected.
      mesh.addInstances(needed);

      let slot = 0;
      for (const [index, placement] of this._placements.entries()) {
        const organ = placement.prototype.bands[
          this._levels[index]
        ].baked.organs.find((candidate) => candidate.kind === kind);
        if (!organ) continue;

        for (let local = 0; local < organ.count; local += 1) {
          organMatrix.fromArray(organ.matrices, local * 16);
          matrix.multiplyMatrices(placement.transform, organMatrix);
          mesh.setMatrixAt(slot, matrix);
          if (organ.colors) {
            colour.fromArray(organ.colors, local * 3);
            mesh.setColorAt(slot, colour);
          }
          slot += 1;
        }
      }

      mesh.computeBoundingBox();
      organInstances += slot;
    }

    this._stats.organInstances = organInstances;
    this._stats.overBudget = organInstances > this._budget;
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Frame loop
   * ------------------------------------------------------------------ */

  /**
   * Advance wind.
   *
   * The wind belongs to the source plants: the field draws their materials, and
   * the wind uniforms live on those materials' compiled shaders. Advancing the
   * prototypes' plants is what makes the whole field move.
   *
   * Takes no camera. Levels are `setLevels` / `setLevelAt`, and they change
   * only when you say so.
   *
   * @param {number} [deltaSeconds]
   * @param {number} [elapsedSeconds]
   */
  update(deltaSeconds = 0, elapsedSeconds) {
    const advanced = new Set();
    for (const prototype of this._prototypes) {
      if (advanced.has(prototype.plant)) continue;
      advanced.add(prototype.plant);
      prototype.plant.update(deltaSeconds, elapsedSeconds);
    }
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Reporting and teardown
   * ------------------------------------------------------------------ */

  /**
   * What the field costs right now.
   *
   * `drawCalls` is the field's whole contribution to the frame: one per organ
   * kind carrying instances, plus one per prototype's wood. It does not grow
   * with the number of plants, which is the entire claim this class makes.
   */
  stats() {
    const organDraws = [...this._organMeshes.values()].filter(
      (entry) => entry.mesh.instancesCount > 0,
    ).length;
    const woodDraws = this._woodMeshes.filter(
      (mesh) => mesh && mesh.instancesCount > 0,
    ).length;

    const levelCounts = new Array(this._bandsPerPrototype).fill(0);
    for (const level of this._levels) levelCounts[level] += 1;

    return {
      plants: this._placements.length,
      prototypes: this._prototypes.length,
      drawCalls: organDraws + woodDraws,
      organDrawCalls: organDraws,
      woodDrawCalls: woodDraws,
      organInstances: this._stats.organInstances,
      budget: this._budget,
      /**
       * The levels you chose need more instances than you budgeted for. The
       * field drew them anyway; this is a number to act on, not a state it
       * corrected.
       */
      overBudget: this._stats.overBudget,
      /** How many placements sit at each level. */
      levelCounts,
      repacks: this._stats.repacks,
    };
  }

  /**
   * Release the field's own meshes.
   *
   * Not the prototypes, and never the source plants: their materials are what
   * this field was drawing, and the caller owns them. Dispose the prototypes,
   * then the plants, in that order, when the field is truly finished with.
   */
  dispose() {
    for (const mesh of this._woodMeshes) mesh?.dispose?.();
    for (const { mesh } of this._organMeshes.values()) mesh.dispose?.();
    this._woodMeshes.length = 0;
    this._organMeshes.clear();
    this.clear();
  }
}

export default PlantField;
