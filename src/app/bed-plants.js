import * as THREE from 'three';
import { selectPlantLODLevel } from '@detoix/ez-plants';
import {
  createPrototypePool,
  PlantField,
} from '@detoix/ez-plants/field/webgpu';

import { aggregateFieldStats } from './field-stats.js';
import { FieldViewDriver } from './field-view.js';
import {
  BED_DEFAULT_AGE,
  BED_DEFAULT_DAY,
  clampAge,
  clampDay,
} from './bed-state.js';
import { getPlantDescriptor } from './plants.js';

/**
 * The three species of the planting. `bed-layout.js` owns where they stand
 * and in what band; this owns how they are grown.
 */
export const BED_SPECIES = Object.freeze(['lavender', 'pennisetum', 'hydrangea']);

export const BED_DEFAULT_PROTOTYPES = 3;
export const BED_DEFAULT_BUDGET = 900_000;

/**
 * How far to stretch each species' own LOD distance ladder.
 *
 * The shipped ladders are tuned for walking a field: a lavender drops to its
 * coarsest band past 3.5 m, which is correct when you stroll past hundreds of
 * them. This page never gets closer than 4.5 m, so unscaled the whole skirt
 * renders at the coarsest band -- measured on the first build, 33 of 33
 * lavenders at level 2.
 *
 * The 4 this shipped with was set against a 13.2 m camera. The bed is a
 * domestic 3.85 m now and the orbit sits at 6, so the same scale would hold
 * every plant on its finest band; 2 keeps the ratio the ladder was tuned at.
 */
export const BED_DEFAULT_LOD_SCALE = 2;

/**
 * Grown states kept in hand.
 *
 * Both sliders are continuous, so the reachable set is 15 x 365 and caching
 * everything is not an option. Six is enough to make scrubbing back and forth
 * across a couple of dates free, which is what somebody filming actually does,
 * and small enough that the bakes it holds stay bounded.
 */
const CACHE_LIMIT = 6;

const plantPosition = new THREE.Vector3();

/** Selection distances only: the geometry bands come from the prototype. */
function scaledLevels(levels, scale) {
  if (scale === 1) return levels;
  return levels.map((level) => ({ ...level, distance: level.distance * scale }));
}

/**
 * Build the bed, with age and day-of-year both scrubbable after load.
 *
 * ## Why a slider costs a rebuild
 *
 * Age and day are fixed when a plant is built -- `setState` regrows the model
 * -- so neither can be animated per frame. The single-plant page rebuilds on
 * every `input` event because it holds one plant; this holds nine (three
 * species by three prototypes) and three `PlantField`s, so it rebuilds on
 * `change` instead, once per drag, when the handle is released.
 *
 * Prototypes are CPU bakes and only `PlantField` owns GPU buffers, so a state
 * the cache still holds costs three field rebuilds and regrows no geometry.
 */
export async function createBedPlanting({
  renderer = null,
  camera,
  layout,
  shadows = true,
  prototypeCount = BED_DEFAULT_PROTOTYPES,
  budget = BED_DEFAULT_BUDGET,
  age = BED_DEFAULT_AGE,
  day = BED_DEFAULT_DAY,
  lodScale = BED_DEFAULT_LOD_SCALE,
  wind = true,
  onProgress = () => {},
} = {}) {
  if (!camera?.isCamera) throw new TypeError('The bed needs a camera.');
  if (!layout?.species?.length) throw new TypeError('The bed needs a layout.');
  if (!Number.isInteger(prototypeCount) || prototypeCount < 1) {
    throw new RangeError('Prototype count must be a positive integer.');
  }

  const group = new THREE.Group();
  group.name = 'Bed planting';

  /** `${age}:${day}` -> [{ id, label, prototypes, levels, plants }] */
  const cache = new Map();
  let fields = [];
  let view = null;
  let state = { age: clampAge(age), day: clampDay(day) };
  /**
   * Where the last slider commit went, in milliseconds.
   *
   * A slider that stalls is a UI bug, and the three phases have completely
   * different fixes, so the page reports them separately rather than reporting
   * one total nobody can act on.
   */
  let lastCommit = { bake: 0, dispose: 0, build: 0, total: 0, cached: true };
  let viewStats = emptyViewStats(layout.plantCount);
  let disposed = false;

  function emptyViewStats(plants) {
    return { visible: 0, plants, queued: 0, applied: 0, pending: 0, ms: 0 };
  }

  function disposeBakes(bakes) {
    for (const bake of bakes) {
      for (const prototype of bake.prototypes) prototype.dispose();
      for (const plant of bake.plants) plant.dispose();
    }
  }

  async function bakeFor(next) {
    const key = `${next.age}:${next.day}`;
    const cached = cache.get(key);
    lastCommit.cached = Boolean(cached);
    if (cached) {
      // Re-insert so the least recently *used* state is the one evicted.
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const built = [];
    for (const [speciesIndex, entry] of layout.species.entries()) {
      const descriptor = getPlantDescriptor(entry.id);
      // Each species stops modelling at its own horizon; a lavender is
      // replaced rather than grown on past it.
      const grownAge = Math.min(next.age, descriptor.maxYears);
      onProgress(`${descriptor.labelPl} · rok ${grownAge}…`);
      // Yield so the loading text paints between species.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const plants = Array.from({ length: prototypeCount }, (_, slot) =>
        descriptor.create({
          age: grownAge,
          day: next.day,
          phenologyProfile: descriptor.profileControl.options[0][0],
          seed: 4200 + speciesIndex * 131 + slot * 17,
          // Ported to TSL by the WebGPU field entry; the backend still rejects
          // any GLSL hook it does not know.
          leafWind: { enabled: wind },
        }),
      );
      built.push({
        id: entry.id,
        label: descriptor.labelPl,
        plants,
        prototypes: createPrototypePool(plants, { id: `${entry.id}:${key}` }),
        levels: scaledLevels(plants[0].lodLevels, lodScale),
      });
    }

    cache.set(key, built);
    while (cache.size > CACHE_LIMIT) {
      const [oldestKey, oldest] = cache.entries().next().value;
      cache.delete(oldestKey);
      disposeBakes(oldest);
    }
    return built;
  }

  function disposeFields() {
    for (const entry of fields) {
      group.remove(entry.field);
      entry.field.dispose();
    }
    fields = [];
    view = null;
  }

  function buildFields(bakes) {
    fields = bakes.map((bake, speciesIndex) => {
      const placements = layout.species[speciesIndex].placements;
      for (const placement of placements) {
        plantPosition.fromArray(placement.position);
        placement.level = selectPlantLODLevel(
          camera.position.distanceTo(plantPosition),
          bake.levels,
          null,
        );
      }

      const field = new PlantField({
        prototypes: bake.prototypes,
        placements,
        renderer,
        budget: Math.round(budget / layout.species.length),
        castShadow: shadows,
        receiveShadow: shadows,
        name: `${bake.id}Band`,
        // Per-instance, in a compute pass: a hydrangea half out of frame draws
        // only the leaves that are on screen, at no measurable CPU cost.
        perInstanceCulling: true,
      });
      group.add(field);
      return {
        id: bake.id,
        label: bake.label,
        field,
        levels: bake.levels,
        chosen: Int32Array.from(placements, (placement) => placement.level),
      };
    });
    view = new FieldViewDriver(fields);
  }

  buildFields(await bakeFor(state));

  return {
    group,
    get fields() {
      return fields;
    },
    get state() {
      return { ...state };
    },
    get lastCommit() {
      return { ...lastCommit };
    },
    /** True when this state is in hand, so the swap will not stall. */
    isReady({ age: nextAge = state.age, day: nextDay = state.day } = {}) {
      return cache.has(`${clampAge(nextAge)}:${clampDay(nextDay)}`);
    },
    async setState(
      { age: nextAge = state.age, day: nextDay = state.day } = {},
      { onProgress: progress = onProgress } = {},
    ) {
      if (disposed) return { ...state };
      const next = { age: clampAge(nextAge), day: clampDay(nextDay) };
      if (next.age === state.age && next.day === state.day && fields.length) {
        return { ...state };
      }
      const startedAt = performance.now();
      const bakes = await bakeFor(next);
      const baked = performance.now();
      if (disposed) return { ...state };
      progress('');
      disposeFields();
      const disposedAt = performance.now();
      state = next;
      buildFields(bakes);
      const builtAt = performance.now();
      lastCommit = {
        ...lastCommit,
        bake: baked - startedAt,
        dispose: disposedAt - baked,
        build: builtAt - disposedAt,
        total: builtAt - startedAt,
      };
      viewStats = emptyViewStats(layout.plantCount);
      return { ...state };
    },
    update(cameraToUse, deltaSeconds = 0, elapsedSeconds = 0) {
      if (disposed || !fields.length) {
        return aggregateFieldStats(fields, viewStats);
      }
      for (const entry of fields) {
        entry.field.update(deltaSeconds, elapsedSeconds);
      }
      viewStats = view.update(cameraToUse);
      return aggregateFieldStats(fields, viewStats);
    },
    stats() {
      return aggregateFieldStats(fields, viewStats);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeFields();
      for (const bakes of cache.values()) disposeBakes(bakes);
      cache.clear();
      group.clear();
    },
  };
}
