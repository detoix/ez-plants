import * as THREE from 'three';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';

import { assignBands } from './band-assignment.js';
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
const cameraPosition = new THREE.Vector3();
const worldPosition = new THREE.Vector3();

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
      return { prototype, which, transform };
    });

    this._assignment = null;
    this._organMeshes = new Map();
    this._woodMeshes = [];
    this._stats = {
      drawCalls: 0,
      organInstances: 0,
      demoted: 0,
      dropped: 0,
      repacks: 0,
    };

    this._createWoodMeshes({ castShadow, receiveShadow });
    this._createOrganMeshes({ castShadow, receiveShadow });
    this._repack(this._assignNearest());
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

      // The theoretical peak, then the budget's opinion of it. Allocating the
      // smaller of the two is the whole point of having a budget.
      //
      // This clamp can never truncate: band assignment holds the total across
      // all kinds at or below the budget, so one kind's share is at or below it
      // too. `_repack` asserts that rather than trusting the argument.
      const peak = this._placements.reduce(
        (total, placement) => total + placement.prototype.organCount(kind, 0),
        0,
      );
      const capacity = Math.max(1, Math.min(peak, this._budget));

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

      this._organMeshes.set(kind, { mesh, capacity, peak });
      this.add(mesh);
    }
  }

  /* ------------------------------------------------------------------ *
   * Band assignment and packing
   * ------------------------------------------------------------------ */

  _bands() {
    return this._prototypes[0].bands;
  }

  _costOf(index, band) {
    return this._placements[index].prototype.instanceCount(band);
  }

  /**
   * Everything at its nearest affordable band, for a field nobody has shown a
   * camera yet. The first `update(camera)` replaces it with a real assignment.
   */
  _assignNearest() {
    return assignBands({
      count: this._placements.length,
      bands: this._bands(),
      distanceOf: () => 0,
      costOf: (index, band) => this._costOf(index, band),
      budget: this._budget,
    });
  }

  /**
   * Rewrite every organ buffer from the current band assignment.
   *
   * A dense repack, in placement order, exactly as `PlantInstancePool` does for
   * one plant. It is O(active instances) and it runs only when an assignment
   * actually changes — which hysteresis makes uncommon — so the cost lands on
   * band crossings rather than on every frame. If it ever shows up in a
   * profile, the lever is `budget`.
   */
  _repack(assignment) {
    this._assignment = assignment;
    this._stats.demoted = assignment.demoted;
    this._stats.dropped = assignment.dropped;
    this._stats.repacks += 1;

    let organInstances = 0;

    for (const [kind, entry] of this._organMeshes) {
      const { mesh, capacity } = entry;
      mesh.clearInstances();

      let needed = 0;
      for (const [index, placement] of this._placements.entries()) {
        const band = assignment.bands[index];
        if (band < 0) continue;
        needed += placement.prototype.organCount(kind, band);
      }
      if (needed > capacity) {
        // Not a runtime condition to absorb quietly — silently dropping some
        // plant's leaves mid-plant is exactly the failure the budget exists to
        // prevent, so it is a bug in assignment if it ever happens.
        throw new Error(
          `${mesh.name}: band assignment produced ${needed} instances for a ` +
            `buffer of ${capacity}. This is a bug in the field's budget maths.`,
        );
      }
      if (needed === 0) continue;

      mesh.addInstances(needed);

      let slot = 0;
      for (const [index, placement] of this._placements.entries()) {
        const band = assignment.bands[index];
        if (band < 0) continue;
        const organ = placement.prototype.bands[band].baked.organs.find(
          (candidate) => candidate.kind === kind,
        );
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
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Frame loop
   * ------------------------------------------------------------------ */

  /**
   * Advance wind and re-assign bands.
   *
   * The wind belongs to the source plants: the field draws their materials, and
   * the wind uniforms live on those materials' compiled shaders. Advancing the
   * prototypes' plants is what makes the whole field move.
   *
   * @param {number} [deltaSeconds]
   * @param {number} [elapsedSeconds]
   * @param {THREE.Camera} [camera] Omit to advance wind without re-banding.
   */
  update(deltaSeconds = 0, elapsedSeconds, camera) {
    const advanced = new Set();
    for (const prototype of this._prototypes) {
      if (advanced.has(prototype.plant)) continue;
      advanced.add(prototype.plant);
      // No camera: the plant's own LOD controller must not remesh the geometry
      // the field baked out of it.
      prototype.plant.update(deltaSeconds, elapsedSeconds);
    }

    if (!camera) return this;
    if (!camera.isCamera) {
      throw new TypeError('A field update needs a THREE.Camera.');
    }

    camera.getWorldPosition(cameraPosition);
    this.updateWorldMatrix(true, false);

    const next = assignBands({
      count: this._placements.length,
      bands: this._bands(),
      distanceOf: (index) => {
        worldPosition.setFromMatrixPosition(this._placements[index].transform);
        worldPosition.applyMatrix4(this.matrixWorld);
        return cameraPosition.distanceTo(worldPosition);
      },
      costOf: (index, band) => this._costOf(index, band),
      previous: this._assignment?.bands ?? null,
      budget: this._budget,
    });

    let changed = false;
    for (let index = 0; index < next.bands.length; index += 1) {
      if (next.bands[index] !== this._assignment.bands[index]) {
        changed = true;
        break;
      }
    }
    if (changed) this._repack(next);

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

    const bandCounts = new Array(this._bandsPerPrototype).fill(0);
    for (const band of this._assignment?.bands ?? []) {
      if (band >= 0) bandCounts[band] += 1;
    }

    return {
      plants: this._placements.length,
      prototypes: this._prototypes.length,
      drawCalls: organDraws + woodDraws,
      organDrawCalls: organDraws,
      woodDrawCalls: woodDraws,
      organInstances: this._stats.organInstances,
      budget: this._budget,
      bandCounts,
      demoted: this._stats.demoted,
      dropped: this._stats.dropped,
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
