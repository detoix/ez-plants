import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import {
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
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

function grid(count, spacing = 2) {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    position: [(index % side) * spacing, 0, Math.floor(index / side) * spacing],
    rotationY: index * 0.7,
  }));
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

test('the caller sets levels, and a coarser one costs less', async () => {
  for (const name of PLANTS) {
    await withField(name, { count: 80 }, (field, prototypes) => {
      const coarsest = prototypes[0].bands.length - 1;

      field.setLevels(new Array(80).fill(0));
      const fine = field.stats();

      field.setLevels(new Array(80).fill(coarsest));
      const coarse = field.stats();

      assert.ok(
        coarse.organInstances < fine.organInstances,
        `${name}: ${coarse.organInstances} coarse vs ${fine.organInstances} fine`,
      );
      assert.equal(coarse.drawCalls, fine.drawCalls, `${name}: draws moved`);
      assert.equal(coarse.levelCounts.at(-1), 80);
      assert.deepEqual(field.levels, new Array(80).fill(coarsest));
    });
  }
});

test("the budget is reported, never enforced behind the caller's back", async () => {
  await withField('forsythia', { count: 60, budget: 1000 }, (field) => {
    field.setLevels(new Array(60).fill(0));
    const stats = field.stats();

    // The caller asked for the finest level on sixty plants against a budget
    // that cannot possibly hold them. The field draws them anyway and says so.
    assert.ok(stats.organInstances > stats.budget);
    assert.equal(stats.overBudget, true);
    assert.equal(stats.levelCounts[0], 60, 'nothing may be coarsened silently');
    assert.ok(stats.drawCalls > 0);
    assert.deepEqual(field.levels, new Array(60).fill(0));
  });

  await withField('forsythia', { count: 60, budget: 10_000_000 }, (field) => {
    assert.equal(field.stats().overBudget, false);
  });
});

test('setting the same levels again does not repack', async () => {
  await withField('forsythia', { count: 40 }, (field) => {
    const levels = field.levels;
    const before = field.stats().repacks;

    field.setLevels(levels);
    field.setLevelAt(0, levels[0]);
    for (let frame = 0; frame < 5; frame += 1) field.update(0.016, frame);

    assert.equal(
      field.stats().repacks,
      before,
      'an unchanged level set must not rebuild the buffers',
    );
  });
});

test('a field reads no camera and cannot be made to change level by one', async () => {
  await withField('forsythia', { count: 10 }, (field, prototypes, plants) => {
    const plant = plants[0];
    const woodBefore = plant._woodMesh.geometry;
    const detailBefore = plant._detail;
    const levelsBefore = field.levels;

    // Passing a camera is not an error; it is simply ignored, because
    // `update` takes only time.
    field.update(0.016, 1, new THREE.PerspectiveCamera());

    assert.deepEqual(field.levels, levelsBefore);
    assert.strictEqual(plant._detail, detailBefore);
    assert.strictEqual(plant._woodMesh.geometry, woodBefore);
  });
});

test("a level outside the prototype's range is refused", async () => {
  await withField('forsythia', { count: 4 }, (field) => {
    assert.throws(() => field.setLevelAt(0, 99), /it has 3/);
    assert.throws(() => field.setLevelAt(99, 0), /No placement at index/);
    assert.throws(() => field.setLevels([0, 0]), /Expected 4 levels/);
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
