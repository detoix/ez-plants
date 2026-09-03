import * as THREE from 'three';
import { selectPlantLODLevel } from '@detoix/ez-plants';

const position = new THREE.Vector3();
const projection = new THREE.Matrix4();

/**
 * Decide, each frame, which plants are worth drawing and at what detail.
 *
 * Both halves are the application's job. The library publishes each plant's
 * suggested distances and its placements' bounds, and acts on neither -- it
 * reads no camera at all. This is the camera.
 *
 * ## Culling is the renderer's job now
 *
 * It did not used to be. Culling 434,000 pooled organs on the CPU cost ~36 ms
 * at 400 plants, so this driver culled whole plants instead -- one sphere each,
 * 0.007 ms -- and hid the losers with `setVisibility`. The WebGPU backend now
 * runs that test per instance in a compute pass at no measurable CPU cost, and
 * against each instance's own bounds, so it rejects strictly more than a
 * whole-plant sphere could.
 *
 * This driver therefore no longer hides anything. It still computes which
 * plants are on screen, for one reason only: to spend its level-change budget
 * on plants somebody can see.
 *
 * ## Deferring detail nobody can see
 *
 * A level change costs the plant it touches, so it is worth not spending on a
 * plant that is not on screen. Changes for hidden plants stay queued and are
 * applied when they come back into view.
 */
export class FieldViewDriver {
  /**
   * @param {object[]} fields Mixed-field entries with `field`, `levels` and
   *   `chosen` members.
   * @param {object} [options]
   * @param {number} [options.budgetPerFrame] Level changes applied per frame.
   *   Walking produces a trickle of them; turning on the spot can re-band a
   *   whole quadrant at once, and this is what stops that landing in one frame.
   */
  constructor(fields, { budgetPerFrame = 6 } = {}) {
    this.budgetPerFrame = budgetPerFrame;
    this.entries = fields.map((entry) => {
      const count = entry.chosen.length;
      return {
        entry,
        // Placements never move, so their bounds are worth computing once.
        spheres: Array.from({ length: count }, (_, index) =>
          entry.field.placementSphere(index),
        ),
        visible: new Uint8Array(count).fill(1),
        // Which placements want a level they have not been given yet. A flag
        // array rather than a queue: a placement that changes its mind twice
        // before its turn comes round should be applied once, at its latest
        // level, not twice.
        dirty: new Uint8Array(count),
        pending: 0,
        cursor: 0,
      };
    });
    this.frustum = new THREE.Frustum();
    this.stats = {
      visible: 0,
      plants: 0,
      queued: 0,
      applied: 0,
      pending: 0,
      ms: 0,
    };
  }

  /** @param {THREE.PerspectiveCamera} camera */
  update(camera) {
    const started = performance.now();
    camera.updateMatrixWorld();
    projection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    // WebGPU's clip-space near plane differs from WebGL's. Passing the
    // camera's coordinate system is not optional here: using Three's default
    // WebGL extraction accepts objects between the eye and WebGPU near plane,
    // which then disagree with the renderer's own culling.
    this.frustum.setFromProjectionMatrix(
      projection,
      camera.coordinateSystem,
      camera.reversedDepth,
    );

    let visibleCount = 0;
    let total = 0;
    let queued = 0;

    for (const record of this.entries) {
      const { entry, spheres, visible, dirty } = record;
      const { chosen, levels } = entry;
      const count = chosen.length;
      total += count;

      for (let index = 0; index < count; index += 1) {
        const onScreen = this.frustum.intersectsSphere(spheres[index]) ? 1 : 0;
        visible[index] = onScreen;
        if (onScreen) visibleCount += 1;

        // Levels are still decided for everything. The decision is arithmetic
        // on a distance; it is the *applying* that costs, and that is deferred.
        position.copy(spheres[index].center);
        const next = selectPlantLODLevel(
          camera.position.distanceTo(position),
          levels,
          chosen[index],
        );
        if (next === chosen[index]) continue;
        chosen[index] = next;
        if (!dirty[index]) {
          dirty[index] = 1;
          record.pending += 1;
          queued += 1;
        }
      }
    }

    // Drain round-robin across species, so one crowded field cannot starve the
    // others, and never spend the budget on a plant nobody can see.
    let remaining = this.budgetPerFrame;
    let applied = 0;
    while (remaining > 0) {
      let progressed = false;
      for (const record of this.entries) {
        if (remaining === 0) break;
        if (record.pending === 0) continue;

        const { entry, dirty, visible } = record;
        const count = dirty.length;
        for (let step = 0; step < count; step += 1) {
          const index = (record.cursor + step) % count;
          if (!dirty[index] || !visible[index]) continue;
          entry.field.setLevelAt(index, entry.chosen[index]);
          dirty[index] = 0;
          record.pending -= 1;
          record.cursor = (index + 1) % count;
          remaining -= 1;
          applied += 1;
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }

    let pending = 0;
    for (const record of this.entries) pending += record.pending;

    this.stats = {
      visible: visibleCount,
      plants: total,
      queued,
      applied,
      pending,
      ms: performance.now() - started,
    };
    return this.stats;
  }
}
