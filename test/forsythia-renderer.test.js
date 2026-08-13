import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Forsythia } from '../src/lib/plants/forsythia/forsythia.js';
import { LYNWOOD_CALENDAR } from '../src/lib/plants/forsythia/phenology.js';
import { LYNWOOD_PROFILE } from '../src/lib/plants/forsythia/lynwood.js';

const MESH_NAMES = Object.freeze({
  wood: 'Forsythia_Wood',
  leaves: 'Forsythia_Leaves_Opposite',
  petioles: 'Forsythia_Petioles',
  buds: 'Forsythia_DormantBuds',
  pedicels: 'Forsythia_Pedicels',
  flowerBuds: 'Forsythia_FlowerBuds',
  flowers: 'Forsythia_Flowers_FourLobed',
  capsules: 'Forsythia_Capsules',
});

function meshes(plant) {
  const result = [];
  plant.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

function meshNamed(plant, name) {
  const found = meshes(plant).find((mesh) => mesh.name === name);
  assert.ok(found, `missing scene mesh ${name}`);
  return found;
}

function makePlant(options = {}) {
  return new Forsythia({ seed: 4242, maxYears: 20, ...options });
}

/* -------------------------------------------------------------------- *
 * Construction
 * -------------------------------------------------------------------- */

test('the renderer builds every declared organ pool and one combined wood mesh', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 200 });
  try {
    for (const name of Object.values(MESH_NAMES)) meshNamed(plant, name);
    assert.equal(plant.name, 'Forsythia_Lynwood');
    assert.equal(plant.userData.species, 'Forsythia × intermedia');
    assert.equal(plant.userData.units, 'metre');
    // One batched woody mesh, not one mesh per cane.
    assert.equal(
      meshes(plant).filter((mesh) => mesh.name === MESH_NAMES.wood).length,
      1,
    );
  } finally {
    plant.dispose();
  }
});

test('the renderer rejects cultivars it does not model, and accepts the synonym', () => {
  assert.throws(() => makePlant({ cultivar: 'Spectabilis' }), RangeError);
  const plant = makePlant({ cultivar: 'Lynwood Gold' });
  try {
    assert.equal(plant.cultivar, 'Lynwood');
  } finally {
    plant.dispose();
  }
});

test('construction validates its time domain', () => {
  assert.throws(() => makePlant({ ageYears: 2.5 }), RangeError);
  assert.throws(() => makePlant({ events: 'not-an-array' }), TypeError);
  assert.throws(
    () => makePlant({ events: [{ id: 'dup' }, { id: 'dup' }] }),
    /unique/,
  );
});

/* -------------------------------------------------------------------- *
 * The defining seasonal behaviour
 * -------------------------------------------------------------------- */

test('flowers render on bare wood: no leaf instance is drawn at peak bloom', () => {
  const plant = makePlant({ ageYears: 6 });
  try {
    plant.setTime({ dayOfYear: LYNWOOD_CALENDAR.floweringPeak });
    const flowers = meshNamed(plant, MESH_NAMES.flowers);
    const leaves = meshNamed(plant, MESH_NAMES.leaves);

    assert.ok(flowers.count > 0, 'corollas must be drawn at peak bloom');
    assert.equal(leaves.count, 0, 'no leaf card may be drawn at peak bloom');
    assert.equal(plant.stats().visibleLeaves, 0);
    assert.equal(plant.stats().phenology.bareWoodFlowering, true);
  } finally {
    plant.dispose();
  }
});

test('the canopy replaces the display: leaves in, flowers out', () => {
  const plant = makePlant({ ageYears: 6 });
  try {
    plant.setTime({ dayOfYear: 200 });
    assert.equal(meshNamed(plant, MESH_NAMES.flowers).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.flowerBuds).count, 0);
    assert.ok(meshNamed(plant, MESH_NAMES.leaves).count > 0);
    // Opposite leaves: petioles are drawn one per leaf.
    assert.equal(
      meshNamed(plant, MESH_NAMES.petioles).count,
      meshNamed(plant, MESH_NAMES.leaves).count,
    );
  } finally {
    plant.dispose();
  }
});

test('closed buds hold the bare wood before the corollas open', () => {
  const plant = makePlant({ ageYears: 6 });
  try {
    plant.setTime({ dayOfYear: LYNWOOD_CALENDAR.budSwellingStart + 14 });
    assert.ok(meshNamed(plant, MESH_NAMES.flowerBuds).count > 0);
    assert.equal(meshNamed(plant, MESH_NAMES.flowers).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.leaves).count, 0);
  } finally {
    plant.dispose();
  }
});

test('a dormant winter plant draws wood and buds but no soft organs', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 20 });
  try {
    assert.equal(meshNamed(plant, MESH_NAMES.leaves).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.flowers).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.flowerBuds).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.capsules).count, 0);
    assert.ok(meshNamed(plant, MESH_NAMES.wood).visible);
    assert.ok(meshNamed(plant, MESH_NAMES.buds).count > 0);
  } finally {
    plant.dispose();
  }
});

/* -------------------------------------------------------------------- *
 * State cycle
 * -------------------------------------------------------------------- */

test('scrubbing time A to B to A restores identical instance counts', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 96 });
  try {
    const snapshot = () =>
      Object.fromEntries(
        Object.entries(MESH_NAMES)
          .filter(([kind]) => kind !== 'wood')
          .map(([kind, name]) => [kind, meshNamed(plant, name).count]),
      );

    const before = snapshot();
    plant.setState({ ageYears: 14, dayOfYear: 280 });
    plant.setState({ ageYears: 2, dayOfYear: 40 });
    plant.setState({ ageYears: 5, dayOfYear: 96 });
    assert.deepEqual(snapshot(), before);
  } finally {
    plant.dispose();
  }
});

test('a rejected state change leaves the plant on its previous state', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 200 });
  try {
    assert.throws(() => plant.setState({ scenario: 'wild' }), RangeError);
    assert.equal(plant.scenario, 'maintained');
    assert.equal(plant.ageYears, 6);
    assert.equal(plant.dayOfYear, 200);

    assert.throws(() => plant.setState({ ageYears: 3.5 }), RangeError);
    assert.equal(plant.ageYears, 6);
  } finally {
    plant.dispose();
  }
});

test('age and day are clamped into the simulated domain', () => {
  const plant = makePlant({ ageYears: 6 });
  try {
    plant.setTime({ dayOfYear: 999 });
    assert.equal(plant.dayOfYear, 365);
    plant.setTime({ dayOfYear: -4 });
    assert.equal(plant.dayOfYear, 1);
    plant.setState({ ageYears: 99 });
    assert.equal(plant.ageYears, plant.maxYears);
  } finally {
    plant.dispose();
  }
});

test('the regional profile shifts the whole display', () => {
  const plant = makePlant({ ageYears: 6 });
  try {
    const centralOnset = LYNWOOD_CALENDAR.floweringStart;
    plant.setPhenologyProfile({ region: 'northeast' });
    plant.setTime({ dayOfYear: centralOnset });
    // Central Poland is already flowering on this day; the north-east is not.
    assert.equal(meshNamed(plant, MESH_NAMES.flowers).count, 0);
    assert.equal(plant.stats().region, 'northeast');

    plant.setPhenologyProfile({ region: 'central' });
    assert.ok(meshNamed(plant, MESH_NAMES.flowers).count > 0);
  } finally {
    plant.dispose();
  }
});

/* -------------------------------------------------------------------- *
 * Pruning
 * -------------------------------------------------------------------- */

test('pruning is refused during the display and after buds are set', () => {
  const plant = makePlant({ ageYears: 8 });
  try {
    plant.setTime({ dayOfYear: LYNWOOD_CALENDAR.floweringPeak });
    assert.equal(
      plant.pruneOldestCane({ dayOfYear: LYNWOOD_CALENDAR.floweringPeak })
        .reason,
      'before-flowering-ends',
    );
    assert.equal(
      plant.pruneOldestCane({ dayOfYear: 230 }).reason,
      'after-bud-set',
    );
  } finally {
    plant.dispose();
  }
});

test('pruning immediately after flowering removes one whole cane', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 130 });
  try {
    const before = plant.stats().visibleCanes;
    const result = plant.pruneOldestCane({ dayOfYear: 130 });
    assert.equal(result.applied, true);
    assert.equal(result.type, 'prune');
    assert.equal(plant.stats().visibleCanes, before - 1);

    plant.resetEvents();
    assert.equal(plant.stats().visibleCanes, before);
  } finally {
    plant.dispose();
  }
});

test('a shrub younger than the renewal age is not pruned', () => {
  const plant = makePlant({ ageYears: 1, dayOfYear: 130 });
  try {
    assert.equal(plant.pruneOldestCane({ dayOfYear: 130 }).reason, 'too-young');
    assert.ok(LYNWOOD_PROFILE.management.renewalPruningMinimumAgeYears > 1);
  } finally {
    plant.dispose();
  }
});

test('renewal pruning stops at the one-fifth quota', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 130 });
  try {
    const canes = plant.stats().visibleCanes;
    const quota = Math.max(
      1,
      Math.floor(canes * LYNWOOD_PROFILE.management.oldestCaneRemovalFraction),
    );
    let applied = 0;
    for (let attempt = 0; attempt < canes; attempt += 1) {
      if (plant.pruneOldestCane({ dayOfYear: 130 }).applied) applied += 1;
    }
    assert.equal(applied, quota);
    assert.equal(
      plant.pruneOldestCane({ dayOfYear: 130 }).reason,
      'quota-reached',
    );
  } finally {
    plant.dispose();
  }
});

/* -------------------------------------------------------------------- *
 * LOD, serialisation and teardown
 * -------------------------------------------------------------------- */

test('distance LOD thins the canopy without dropping the plant', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 200, lod: true });
  try {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1, 2);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    const near = meshNamed(plant, MESH_NAMES.leaves).count;

    camera.position.set(0, 1, 40);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    const far = meshNamed(plant, MESH_NAMES.leaves).count;

    assert.ok(far < near, 'far LOD must draw fewer leaves');
    assert.ok(far > 0, 'far LOD must still draw a plant');
    assert.ok(meshNamed(plant, MESH_NAMES.wood).visible);
  } finally {
    plant.dispose();
  }
});

test('serialize round-trips the state needed to rebuild the same plant', () => {
  const plant = makePlant({ ageYears: 7, dayOfYear: 130, seed: 99 });
  try {
    plant.pruneOldestCane({ dayOfYear: 130 });
    const state = plant.serialize();
    assert.equal(state.type, 'Forsythia');
    assert.equal(state.cultivar, 'Lynwood');
    assert.equal(state.species, 'Forsythia × intermedia');
    assert.equal(state.seed, 99);
    assert.equal(state.ageYears, 7);
    assert.equal(state.region, 'central');
    assert.equal(state.events.length, 1);

    const restored = new Forsythia({ ...state, maxYears: plant.maxYears });
    try {
      assert.equal(restored.stats().visibleCanes, plant.stats().visibleCanes);
      assert.equal(restored.stats().visibleLeaves, plant.stats().visibleLeaves);
    } finally {
      restored.dispose();
    }
  } finally {
    plant.dispose();
  }
});

test('stats report rendered organs, dimensions and sourced care hints', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 200 });
  try {
    const stats = plant.stats();
    assert.equal(stats.cultivar, 'Lynwood');
    assert.ok(stats.visibleLeaves > 0);
    assert.ok(stats.drawCalls > 0);
    assert.ok(stats.dimensions.heightM > 1);
    assert.ok(Array.isArray(stats.careHints));
    for (const hint of stats.careHints) {
      assert.match(
        hint.source,
        /^https:\/\//,
        'every care hint cites a source',
      );
    }
  } finally {
    plant.dispose();
  }
});

test('dispose releases GPU resources once and is safe to repeat', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 200, lod: true });
  const geometries = new Set();
  const materials = new Set();
  let disposedGeometries = 0;
  let disposedMaterials = 0;

  for (const mesh of meshes(plant)) {
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
  }
  for (const geometry of geometries) {
    const original = geometry.dispose.bind(geometry);
    geometry.dispose = () => {
      disposedGeometries += 1;
      original();
    };
  }
  for (const material of materials) {
    const original = material.dispose.bind(material);
    material.dispose = () => {
      disposedMaterials += 1;
      original();
    };
  }

  plant.dispose();
  plant.dispose();

  assert.equal(disposedGeometries, geometries.size);
  assert.equal(disposedMaterials, materials.size);
  assert.equal(plant.children.length, 0);
});
