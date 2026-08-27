import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Library rule 5 states a budget: *"a mature plant is a handful of draw calls,
 * and scrubbing the sliders must never rebuild it."* Until now that was
 * enforced for one plant and asserted as `drawCalls > 0` for another, which is
 * not a budget.
 *
 * These tests hold every plant to it, and derive the roster from the plants
 * directory rather than listing it, so a plant added tomorrow is inside the
 * budget on the day it lands or it fails the build.
 */

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** "A handful", stated as a number so it cannot drift upward unnoticed. */
const HANDFUL = 12;

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

/** The structural ceiling: one draw per organ kind, plus one for the wood. */
function ceiling(plant) {
  return plant._organKinds.length + 1;
}

test('every plant stays inside a handful of draw calls, all year', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const bound = ceiling(plant);
      assert.ok(
        bound <= HANDFUL,
        `${name} declares ${bound} possible draws, which is not a handful`,
      );

      let peak = 0;
      for (let day = 1; day <= 365; day += 7) {
        plant.setTime({ dayOfYear: day });
        const drawCalls = plant.stats().drawCalls;
        peak = Math.max(peak, drawCalls);
        assert.ok(
          drawCalls <= bound,
          `${name} on day ${day}: ${drawCalls} draws exceeds ${bound}`,
        );
      }

      // Not a vacuous bound: the plant really does draw most of its kinds at
      // some point in the year.
      assert.ok(peak > 1, `${name} never draws more than ${peak}`);
    } finally {
      plant.dispose();
    }
  }
});

test("the budget holds across the plant's whole modelled life", async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const bound = ceiling(plant);
      for (let age = 0; age <= plant.maxYears; age += 1) {
        plant.setState({ ageYears: age, dayOfYear: 200 });
        assert.ok(
          plant.stats().drawCalls <= bound,
          `${name} at ${age} years: ${plant.stats().drawCalls} > ${bound}`,
        );
      }
    } finally {
      plant.dispose();
    }
  }
});

test('scrubbing the sliders never allocates a new mesh', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const identity = () => {
        const found = [];
        plant.traverse((object) => {
          if (object.isMesh) found.push(object);
        });
        return found;
      };

      const before = identity();
      for (const day of [1, 60, 120, 180, 240, 300, 360, 200]) {
        plant.setTime({ dayOfYear: day });
      }
      for (const age of [0, 1, 3, 8, 2, 5]) {
        plant.setState({ ageYears: Math.min(age, plant.maxYears) });
      }

      const after = identity();
      assert.equal(after.length, before.length, `${name} changed mesh count`);
      for (const [index, mesh] of after.entries()) {
        assert.strictEqual(
          mesh,
          before[index],
          `${name} replaced mesh ${mesh.name} while scrubbing`,
        );
      }
    } finally {
      plant.dispose();
    }
  }
});

test('the shadow pass is inside the budget too', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const stats = plant.stats();
      assert.ok(stats.shadowDrawCalls <= stats.drawCalls);
      assert.ok(stats.shadowTriangles >= 0);
    } finally {
      plant.dispose();
    }
  }
});
