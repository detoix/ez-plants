import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import {
  assignBands,
  createPlantPrototype,
  createPrototypePool,
  PlantField,
} from '../src/lib/field/index.js';

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, lod: true, ...options });
}

function grid(count, spacing = 2) {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    position: [(index % side) * spacing, 0, Math.floor(index / side) * spacing],
    rotationY: index * 0.7,
  }));
}

function camera(x, y, z) {
  const result = new THREE.PerspectiveCamera();
  result.position.set(x, y, z);
  result.updateMatrixWorld(true);
  return result;
}

/** Build a field, run `body`, and tear the whole thing down in order. */
async function withField(name, { seeds = [1, 2], count = 60, ...rest }, body) {
  const plants = await Promise.all(
    seeds.map((seed) => createPlant(name, { seed })),
  );
  const prototypes = createPrototypePool(plants);
  const field = new PlantField({
    prototypes,
    placements: grid(count),
    ...rest,
  });
  try {
    return await body(field, prototypes, plants);
  } finally {
    field.dispose();
    for (const prototype of prototypes) prototype.dispose();
    for (const plant of plants) plant.dispose();
  }
}

/* -------------------------------------------------------------------- *
 * Band assignment — pure, no instancing library involved
 * -------------------------------------------------------------------- */

const BANDS = [
  { distance: 0, hysteresis: 0 },
  { distance: 10, hysteresis: 0.1 },
  { distance: 30, hysteresis: 0.1 },
];

test('distance picks the band, exactly as it would for one plant', () => {
  const distances = [0, 5, 12, 40];
  const { bands } = assignBands({
    count: distances.length,
    bands: BANDS,
    distanceOf: (index) => distances[index],
    costOf: () => 1,
  });
  assert.deepEqual([...bands], [0, 0, 1, 2]);
});

test('hysteresis keeps a plant in its band across the boundary', () => {
  const previous = Int32Array.from([1]);
  // 9.5 is below the 10 m boundary but inside the 10% sticky zone, so a plant
  // already at band 1 stays there rather than flickering.
  const sticky = assignBands({
    count: 1,
    bands: BANDS,
    distanceOf: () => 9.5,
    costOf: () => 1,
    previous,
  });
  assert.equal(sticky.bands[0], 1);

  const released = assignBands({
    count: 1,
    bands: BANDS,
    distanceOf: () => 8,
    costOf: () => 1,
    previous,
  });
  assert.equal(released.bands[0], 0, 'past the sticky zone it must let go');
});

test('the budget demotes the furthest plants, not the nearest', () => {
  const distances = [1, 2, 12, 15];
  const cost = [100, 10, 1];
  const result = assignBands({
    count: 4,
    bands: BANDS,
    distanceOf: (index) => distances[index],
    costOf: (_index, band) => cost[band],
    // Distance alone would give bands [0, 0, 1, 1] and cost 220. This does not
    // fit, so something has to give.
    budget: 130,
  });

  assert.ok(result.total <= 130);
  assert.ok(result.demoted > 0);
  // The nearest plant, the one filling the screen, keeps every bit of its
  // detail. Loss is taken from the back of the field forwards.
  assert.equal(result.bands[0], 0, 'the nearest plant must not give way first');
  assert.deepEqual([...result.bands], [0, 1, 2, 2]);
});

test('a budget nothing fits into drops plants rather than overflowing', () => {
  const result = assignBands({
    count: 10,
    bands: BANDS,
    distanceOf: (index) => index,
    costOf: () => 100,
    budget: 250,
  });
  assert.ok(result.total <= 250);
  assert.equal(result.dropped, 8);
  // Dropping is the last resort: every survivor has already been demoted as
  // far as it can go. And a dropped plant is marked, never silently packed as
  // if it were still there.
  assert.deepEqual([...result.bands.slice(0, 2)], [2, 2]);
  assert.ok([...result.bands.slice(2)].every((band) => band === -1));
});

/* -------------------------------------------------------------------- *
 * Prototypes
 * -------------------------------------------------------------------- */

test('a prototype bakes every band and reads its organ kinds off the bake', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name, { seed: 'proto' });
    const prototype = createPlantPrototype(plant);
    try {
      assert.equal(prototype.bands.length, plant.lodLevels.length);
      assert.ok(prototype.organKinds.length > 0);

      // Coarser bands cost less. That is the whole reason bands exist, and the
      // field's budget maths depends on it being true.
      const counts = prototype.bands.map((_band, index) =>
        prototype.instanceCount(index),
      );
      assert.ok(
        counts.at(-1) < counts[0],
        `${name}: coarsest band is not cheaper (${counts.join(' -> ')})`,
      );
      assert.ok(prototype.bounds.max.y > prototype.bounds.min.y);
    } finally {
      prototype.dispose();
      plant.dispose();
    }
  }
});

/* -------------------------------------------------------------------- *
 * The field, and rule 5's budget
 * -------------------------------------------------------------------- */

test('draw calls do not grow with the number of plants', async () => {
  for (const name of PLANTS) {
    const measured = [];
    for (const count of [10, 100, 400]) {
      await withField(name, { count }, (field) => {
        field.update(0.016, 1, camera(20, 5, 40));
        measured.push(field.stats().drawCalls);
      });
    }

    assert.equal(
      new Set(measured).size,
      1,
      `${name}: draw calls moved with plant count (${measured.join(', ')})`,
    );
    // The bound rule 5 actually asks for: one draw per organ kind plus one per
    // prototype's wood, and nothing else.
    assert.ok(
      measured[0] <= 16,
      `${name}: ${measured[0]} draw calls for a whole field`,
    );
  }
});

test('a field of many plants costs fewer draws than the plants would alone', async () => {
  const count = 100;
  for (const name of PLANTS) {
    const solo = await createPlant(name, { seed: 1 });
    const perPlant = solo.stats().drawCalls;
    solo.dispose();

    await withField(name, { count }, (field) => {
      field.update(0.016, 1, camera(20, 5, 40));
      const fieldDraws = field.stats().drawCalls;
      assert.ok(
        fieldDraws < perPlant * count,
        `${name}: field ${fieldDraws} vs ${perPlant * count} placed separately`,
      );
      // Not marginally cheaper — an order of magnitude at this size.
      assert.ok(fieldDraws * 10 < perPlant * count, `${name}: ${fieldDraws}`);
    });
  }
});

test('the field never exceeds the instance budget it was given', async () => {
  for (const name of PLANTS) {
    await withField(name, { count: 300, budget: 40_000 }, (field) => {
      for (const distance of [5, 25, 80, 300]) {
        field.update(0.016, 1, camera(20, 5, distance));
        const stats = field.stats();
        assert.ok(
          stats.organInstances <= stats.budget,
          `${name} at ${distance} m: ${stats.organInstances} > ${stats.budget}`,
        );
      }
    });
  }
});

test('pulling the camera back coarsens the field instead of costing more', async () => {
  for (const name of PLANTS) {
    await withField(name, { count: 80 }, (field) => {
      field.update(0.016, 1, camera(10, 5, 5));
      const near = field.stats();

      field.update(0.016, 2, camera(10, 5, 400));
      const far = field.stats();

      assert.ok(
        far.organInstances < near.organInstances,
        `${name}: ${far.organInstances} instances far vs ${near.organInstances} near`,
      );
      assert.equal(far.drawCalls, near.drawCalls, `${name}: draw calls moved`);
      // Everything ends up in the coarsest band, not scattered.
      assert.equal(far.bandCounts.at(-1) > 0, true);
    });
  }
});

test('a stationary camera does not repack, so the cost lands on crossings', async () => {
  await withField('forsythia', { count: 40 }, (field) => {
    const view = camera(10, 5, 20);
    field.update(0.016, 1, view);
    const first = field.stats().repacks;

    for (let frame = 0; frame < 5; frame += 1) field.update(0.016, frame, view);
    assert.equal(
      field.stats().repacks,
      first,
      'a still camera must not rebuild the buffers every frame',
    );
  });
});

test('the field advances wind without letting per-plant LOD remesh underneath it', async () => {
  await withField('forsythia', { count: 10 }, (field, prototypes, plants) => {
    const plant = plants[0];
    const woodBefore = plant._woodMesh.geometry;
    const before = plant._detail;

    field.update(0.016, 1, camera(10, 5, 400));

    assert.strictEqual(
      plant._detail,
      before,
      'the field must not drive the source plant through its own LOD',
    );
    assert.strictEqual(plant._woodMesh.geometry, woodBefore);
  });
});

test('a field is built from what a plant declares, never from its name', async () => {
  // The roster-independence guarantee, checked the only way that means
  // anything: every plant in the library goes through the same code path with
  // no per-species branch, whatever organ kinds it happens to have.
  for (const name of PLANTS) {
    await withField(name, { count: 12 }, (field, prototypes) => {
      const stats = field.stats();
      assert.ok(stats.drawCalls > 0, name);
      assert.equal(stats.plants, 12);
      assert.equal(stats.prototypes, prototypes.length);
      for (const kind of prototypes[0].organKinds) {
        assert.ok(
          field._organMeshes.has(kind),
          `${name}: no field mesh for declared organ kind ${kind}`,
        );
      }
    });
  }
});

test('disposing a field leaves the prototypes and their plants alone', async () => {
  const plants = [await createPlant('forsythia', { seed: 1 })];
  const prototypes = createPrototypePool(plants);
  const field = new PlantField({ prototypes, placements: grid(10) });

  field.dispose();

  assert.equal(field.children.length, 0);
  assert.ok(plants[0].stats().drawCalls > 0, 'the source plant still renders');
  assert.ok(prototypes[0].bands[0].baked.organs.length > 0);

  for (const prototype of prototypes) prototype.dispose();
  plants[0].dispose();
});

test('mismatched prototypes are refused rather than rendered wrongly', async () => {
  const plant = await createPlant('forsythia', { seed: 1 });
  try {
    const full = createPlantPrototype(plant);
    const single = createPlantPrototype(plant, {
      levels: [{ distance: 0, hysteresis: 0 }],
    });
    try {
      assert.throws(
        () =>
          new PlantField({
            prototypes: [full, single],
            placements: grid(4),
          }),
        /same LOD bands/,
      );
    } finally {
      full.dispose();
      single.dispose();
    }
  } finally {
    plant.dispose();
  }
});
