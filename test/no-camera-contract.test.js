import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import { PlantLODController } from '../src/lib/plant-lod.js';

/**
 * The library states what it suggests; the caller decides.
 *
 * A plant publishes the levels it can be drawn at, each with a *suggested*
 * distance, and `setLevel` is the only thing that changes one. Nothing in the
 * library reads a camera, measures a distance, or switches level on its own —
 * an application knows things the library cannot, and metres are only one of
 * the bases it might choose from.
 *
 * `PlantLODController` is the one exception, and it is opt-in: a calculator a
 * caller may use, holding no plant and reaching no scene. These tests pin all
 * of that, including at the source level, because it is the kind of contract
 * that erodes one convenience at a time.
 */

const REPO = new URL('..', import.meta.url).pathname;
const LIB = join(REPO, 'src/lib');

const PLANTS = readdirSync(join(LIB, 'plants'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Every .js file under src/lib, recursively. */
function libSources(directory = LIB) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...libSources(path));
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found;
}

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

test('no plant reads a camera, and passing one changes nothing', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const before = plant.stats().visibleLeaves;
      const level = plant.level;

      // A camera as the third argument is ignored: `update` takes only time.
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 5000);
      camera.updateMatrixWorld(true);
      plant.update(0.016, 1, camera);

      assert.equal(plant.level, level, `${name} changed level on its own`);
      assert.equal(plant.stats().visibleLeaves, before, name);
    } finally {
      plant.dispose();
    }
  }
});

test('every plant publishes its levels, and setLevel is what moves them', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      assert.ok(Array.isArray(plant.lodLevels) || plant.lodLevels.length >= 0);
      assert.ok(plant.lodLevels.length > 0, `${name} publishes no levels`);
      assert.equal(plant.level, 0, `${name} must start at its finest level`);

      // The suggested distances are advice: present, ordered, starting at 0.
      const distances = plant.lodLevels.map((level) => level.distance);
      assert.equal(distances[0], 0, name);
      assert.deepEqual(
        distances,
        [...distances].sort((a, b) => a - b),
        name,
      );

      const coarsest = plant.lodLevels.length - 1;
      plant.setLevel(coarsest);
      assert.equal(plant.level, coarsest);
      assert.ok(
        plant.stats().visibleLeaves < (await countAtFinest(name)),
        `${name}: the coarsest level did not thin anything`,
      );

      assert.throws(() => plant.setLevel(coarsest + 1), RangeError, name);
      assert.throws(() => plant.setLevel(-1), RangeError, name);
      assert.throws(() => plant.setLevel(1.5), RangeError, name);
    } finally {
      plant.dispose();
    }
  }
});

async function countAtFinest(name) {
  const plant = await createPlant(name);
  try {
    return plant.stats().visibleLeaves;
  } finally {
    plant.dispose();
  }
}

test('every plant in the library declares the same number of levels', async () => {
  const counts = new Map();
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    counts.set(name, plant.lodLevels.length);
    plant.dispose();
  }

  const distinct = new Set(counts.values());
  assert.equal(
    distinct.size,
    1,
    `levels differ across the library: ${[...counts]
      .map(([name, count]) => `${name}=${count}`)
      .join(', ')}`,
  );
  assert.equal([...distinct][0], 3, 'the library settled on three levels');
});

test('nothing in src/lib reads a camera except the opt-in helper', () => {
  // A source-level check, because this is a design boundary rather than a
  // behaviour: the moment one module takes a camera "just for convenience",
  // the contract is gone and no runtime test would notice.
  // One exemption, and it is inherited rather than chosen: `Tree` is upstream
  // ez-tree, unchanged (library rule 6), and its `generateLODs()` builds a
  // `THREE.LOD` that three.js itself drives from the camera. The garden plants
  // are the library's own work and hold the line.
  const allowed = new Set([join(LIB, 'tree.js')]);

  const offenders = [];
  for (const file of libSources()) {
    if (allowed.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    // Comments explain the rule constantly; only code counts.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/\bcamera\b/i.test(code)) {
      offenders.push(file.slice(LIB.length + 1));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules reach for a camera: ${offenders.join(', ')}`,
  );
});

test('the LOD helper is a calculator, not a driver', () => {
  const controller = new PlantLODController({
    levels: [
      { distance: 0 },
      { distance: 10, hysteresis: 0.1 },
      { distance: 30, hysteresis: 0.1 },
    ],
  });

  assert.equal(controller.levelFor(0), 0);
  assert.equal(controller.levelFor(40), 2);

  // It cannot touch a plant even if someone wanted it to.
  assert.equal(controller.target, undefined);
  assert.equal(controller.applyDetail, undefined);
  assert.equal(typeof controller.update, 'undefined');
});
