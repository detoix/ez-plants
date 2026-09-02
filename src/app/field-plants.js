import * as THREE from 'three';
import { selectPlantLODLevel } from '@detoix/ez-plants';
import {
  createPrototypePool,
  PlantField,
} from '@detoix/ez-plants/field/webgpu';

import { createFieldLayout, FIELD_DEFAULT_COUNT } from './field-layout.js';
import { aggregateFieldStats } from './field-stats.js';
import { FieldViewDriver } from './field-view.js';
import { getPlantDescriptor } from './plants.js';

export const FIELD_SPECIES = Object.freeze([
  Object.freeze({ id: 'blackcurrant', age: 4 }),
  Object.freeze({ id: 'cherrylaurel', age: 5 }),
  Object.freeze({ id: 'forsythia', age: 5 }),
  Object.freeze({ id: 'hydrangea', age: 5 }),
  Object.freeze({ id: 'lavender', age: 4 }),
  Object.freeze({ id: 'echinacea', age: 5 }),
  Object.freeze({ id: 'miscanthus', age: 5 }),
  Object.freeze({ id: 'pennisetum', age: 5 }),
]);

export const FIELD_DEFAULT_PROTOTYPES = 3;
export const FIELD_DEFAULT_BUDGET = 1_600_000;

const plantPosition = new THREE.Vector3();

function scaledLevels(levels, scale) {
  if (scale === 1) return levels;
  return levels.map((level) => ({
    ...level,
    distance: level.distance * scale,
  }));
}

/** Build the eight-species field on the WebGPU PlantField backend. */
export async function createMixedPlantField({
  renderer = null,
  camera,
  groundAt,
  shadows = true,
  count = FIELD_DEFAULT_COUNT,
  day = 230,
  prototypeCount = FIELD_DEFAULT_PROTOTYPES,
  budget = FIELD_DEFAULT_BUDGET,
  lodScale = 1,
  wind = true,
  onProgress = () => {},
} = {}) {
  if (!camera?.isCamera || !camera.position) {
    throw new TypeError('The mixed field needs a camera.');
  }
  if (!Number.isInteger(prototypeCount) || prototypeCount < 1) {
    throw new RangeError('Prototype count must be a positive integer.');
  }

  const layout = createFieldLayout({
    count,
    speciesCount: FIELD_SPECIES.length,
    groundAt,
  });
  const startZ = layout.extent + 6;
  camera.position.set(0, groundAt(0, startZ) + 1.7, startZ);
  camera.lookAt(0, groundAt(0, 0) + 1.2, 0);
  camera.far = layout.extent * 6;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = 'Mixed EZ-Plants field';
  const fields = [];
  const ownedPlants = [];
  const ownedPrototypes = [];
  let view = null;
  let viewStats = {
    visible: 0,
    plants: count,
    queued: 0,
    applied: 0,
    pending: 0,
    ms: 0,
  };
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of fields) {
      group.remove(entry.field);
      entry.field.dispose();
    }
    for (const prototype of ownedPrototypes) prototype.dispose();
    for (const plant of ownedPlants) plant.dispose();
    fields.length = 0;
    ownedPrototypes.length = 0;
    ownedPlants.length = 0;
    group.clear();
  }

  try {
    for (const [speciesIndex, species] of FIELD_SPECIES.entries()) {
      const descriptor = getPlantDescriptor(species.id);
      onProgress(`Growing ${descriptor.label.toLowerCase()}…`);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const plants = Array.from({ length: prototypeCount }, (_, index) =>
        descriptor.create({
          age: species.age,
          day,
          phenologyProfile: descriptor.profileControl.options[0][0],
          seed: 1000 + speciesIndex * 97 + index * 13,
          // The WebGPU PlantField entry adapts this supported leaf-wind hook
          // to TSL and still rejects any unknown GLSL material mutation.
          leafWind: { enabled: wind },
        }),
      );
      ownedPlants.push(...plants);

      const prototypes = createPrototypePool(plants, { id: species.id });
      ownedPrototypes.push(...prototypes);

      const levels = scaledLevels(plants[0].lodLevels, lodScale);
      const placements = layout.perSpecies[speciesIndex];
      for (const placement of placements) {
        plantPosition.fromArray(placement.position);
        placement.level = selectPlantLODLevel(
          camera.position.distanceTo(plantPosition),
          levels,
          null,
        );
      }

      const field = new PlantField({
        prototypes,
        placements,
        renderer,
        budget: Math.round(budget / FIELD_SPECIES.length),
        castShadow: shadows,
        receiveShadow: shadows,
        name: `${descriptor.label}Field`,
        // FieldViewDriver owns one conservative sphere per whole plant. A
        // second leaf/branch culler uses different bounds and can split a
        // plant at the edge of the view, so the production field deliberately
        // has one visibility authority.
        perInstanceCulling: false,
      });
      group.add(field);
      fields.push({
        id: species.id,
        label: descriptor.label,
        field,
        levels,
        chosen: Int32Array.from(placements, (placement) => placement.level),
      });
    }

    view = new FieldViewDriver(fields);

    return {
      group,
      fields,
      layout,
      update(cameraToUse, deltaSeconds = 0, elapsedSeconds = 0) {
        if (disposed) return aggregateFieldStats(fields, viewStats);
        for (const entry of fields) {
          entry.field.update(deltaSeconds, elapsedSeconds);
        }
        viewStats = view.update(cameraToUse);
        return aggregateFieldStats(fields, viewStats);
      },
      stats() {
        return aggregateFieldStats(fields, viewStats);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
