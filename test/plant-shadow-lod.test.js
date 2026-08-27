import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ShadowCast } from '../src/lib/enums.js';
import { normalizePlantDetail } from '../src/lib/plant-detail.js';
import { normalizePlantLODLevels } from '../src/lib/plant-lod.js';
import { PlantInstancePool } from '../src/lib/plant-instance-pool.js';

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Construct any plant in the library by folder name, using the same
 * folder-to-class convention `scripts/add-plant.mjs` relies on. Reading the
 * roster rather than listing it means a plant added tomorrow is held to these
 * guarantees without anyone editing this file.
 */
async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  assert.ok(Plant, `${name} must export a renderer named after its folder`);
  return new Plant({ ageYears: 3, dayOfYear: 200, ...options });
}

test('a plant with no LOD casts exactly as it always did', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const stats = plant.stats();
      assert.equal(
        stats.shadowDrawCalls,
        stats.drawCalls,
        `${name} must cast from every visible mesh when detail is untouched`,
      );
      assert.ok(stats.shadowTriangles > 0);
    } finally {
      plant.dispose();
    }
  }
});

test('shadow cost falls band by band while the colour pass does not', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name, { lod: true });
    try {
      const controller = plant._lodController;
      assert.ok(controller, `${name} must build a LOD controller for lod:true`);

      const bands = controller.levels.map((level) => {
        controller.updateDistance(level.distance);
        const stats = plant.stats();
        return {
          distance: level.distance,
          shadowCast: level.detail.shadowCast,
          shadowTriangles: stats.shadowTriangles,
          shadowDrawCalls: stats.shadowDrawCalls,
          drawCalls: stats.drawCalls,
        };
      });

      // The derived ladder: everything up close, wood only in the middle,
      // nothing at the back.
      assert.equal(bands.at(0).shadowCast, ShadowCast.All);
      assert.equal(bands.at(-1).shadowCast, ShadowCast.None);
      for (const band of bands.slice(1, -1)) {
        assert.equal(band.shadowCast, ShadowCast.Wood);
      }

      // Materially cheaper, not marginally: dropping the organs must remove
      // the bulk of the shadow-pass triangles, and the far band all of them.
      assert.equal(bands.at(-1).shadowTriangles, 0, `${name} far band`);
      assert.equal(bands.at(-1).shadowDrawCalls, 0, `${name} far band`);
      assert.ok(
        bands[1].shadowTriangles < bands[0].shadowTriangles * 0.5,
        `${name}: ${bands[1].shadowTriangles} is not materially below ` +
          `${bands[0].shadowTriangles}`,
      );

      // Shadow LOD must be a shadow-pass change only. The colour pass is
      // driven by the existing geometry/organ strides and is not this rule's
      // business, so its draw-call count must not move because of it.
      const colour = new Set(bands.map((band) => band.drawCalls));
      assert.equal(
        colour.size,
        1,
        `${name} colour-pass draw calls changed with the shadow band`,
      );
    } finally {
      plant.dispose();
    }
  }
});

test('a band that states its own shadow policy keeps it', () => {
  const levels = normalizePlantLODLevels([
    { distance: 0 },
    { distance: 10, detail: { shadowCast: ShadowCast.All } },
    { distance: 20 },
  ]);

  assert.equal(levels[0].detail.shadowCast, ShadowCast.All);
  assert.equal(levels[1].detail.shadowCast, ShadowCast.All, 'explicit wins');
  assert.equal(levels[2].detail.shadowCast, ShadowCast.None);
});

test('a single band is a near band, so it casts everything', () => {
  const levels = normalizePlantLODLevels([{ distance: 0 }]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].detail.shadowCast, ShadowCast.All);
});

test('shadow detail is validated like every other detail field', () => {
  assert.throws(
    () => normalizePlantDetail({ shadowCast: 'sometimes' }),
    /Unknown shadow cast mode/,
  );
  assert.throws(
    () => normalizePlantDetail({ shadowReceive: 1 }),
    /shadowReceive must be a boolean/,
  );
  assert.equal(normalizePlantDetail().shadowCast, ShadowCast.All);
  assert.equal(normalizePlantDetail().shadowReceive, true);
});

test('an organ kind can opt out of shadows permanently', () => {
  const pool = new PlantInstancePool({ capacities: { leaf: 4, petiole: 4 } });
  const leaf = pool.add('leaf', {});
  const petiole = pool.add('petiole', { castsShadow: false });

  assert.equal(leaf.castShadow, true);
  assert.equal(petiole.castShadow, false, 'opt-out applies at construction');

  // The band saying "organs cast" cannot override a kind's own opt-out.
  pool.applyShadowPolicy({ cast: true, receive: true });
  assert.equal(leaf.castShadow, true);
  assert.equal(petiole.castShadow, false);

  pool.applyShadowPolicy({ cast: false, receive: false });
  assert.equal(leaf.castShadow, false);
  assert.equal(leaf.receiveShadow, false);
  assert.equal(petiole.castShadow, false);
});
