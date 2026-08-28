import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createPlantPrototype } from '../src/lib/field/plant-prototype.js';

/**
 * Library rule 9: every LOD band has a triangle budget and a draw budget.
 *
 * The numbers come from EZ-Tree, measured rather than invented. Its
 * `generateLODs()` defaults state a contract in `src/lib/tree.js` — *"LOD1 is
 * roughly 40% of the full triangle count, LOD2 roughly 20%"* — and across all
 * fifteen presets they hit it: 40% and 20% on the mean, with the heaviest tree
 * in the set (Oak Large) at 22,566 / 9,240 / 5,364 triangles and exactly two
 * draws at every level, forever.
 *
 * That is the bar. A cultivated shrub is not a more complex object than an oak.
 *
 * ---------------------------------------------------------------------------
 * Why this is a ratchet and not a plain assertion
 * ---------------------------------------------------------------------------
 * The library did not start inside this budget, so a test that simply asserted
 * the target would fail the whole suite on the day it landed and be skipped by
 * the end of the week. Instead:
 *
 *   - A plant already in RECORDED may not get worse. Progress is locked in as
 *     it is made, and the numbers only ever move down.
 *   - A plant NOT in RECORDED is held to the full target immediately. A plant
 *     added tomorrow is inside the budget on the day it lands or it fails the
 *     build — the same stance `draw-call-budget.test.js` takes.
 *
 * When a plant improves, lower its RECORDED entry in the same commit. The
 * failure message tells you the new numbers to paste.
 */

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Triangles per plant, per band. Rounded up from the heaviest EZ-Tree preset,
 * whose ladder is 22,566 / 9,240 / 5,364.
 */
export const TARGET_TRIANGLES = Object.freeze([25_000, 10_000, 5_000]);

/**
 * Draws per plant, per band — one per organ kind, plus one for the wood.
 *
 * Band 0 gets a third for whatever the plant is actually about: a panicle, a
 * raceme, a truss of fruit. Past band 0 a plant is wood and foliage, and the
 * feature organ has to be carried by the leaf card or baked into the
 * silhouette, exactly as EZ-Tree drops a leaf to a single billboard at LOD2.
 *
 * This is a design constraint, not a performance fix: at field scale the draws
 * are pooled per kind across every plant of a species, and 32 of them is
 * nowhere near a bottleneck. The budget matters because the geometry that
 * leaves with a dropped kind is what actually costs.
 */
export const TARGET_DRAWS = Object.freeze([3, 2, 2]);

/** Uniform, so the roster stays derivable and a new plant needs no entry. */
const AGE_YEARS = 5;
/** Peak season: the most leaf, flower and fruit a plant ever carries at once. */
const DAY_OF_YEAR = 230;

/**
 * Measured 2026-08-28. Every one of these is a debt, not an achievement — see
 * the target above. Lower them as plants improve; never raise them.
 */
const RECORDED = Object.freeze({
  // Inside the budget as of the petiole drop — kept here so it cannot regress.
  blackcurrant: { triangles: [16242, 5096, 3592], draws: [3, 2, 2] },
  forsythia: { triangles: [154508, 86334, 58780], draws: [4, 4, 4] },
  hydrangea: { triangles: [437865, 413170, 267737], draws: [9, 9, 9] },
  miscanthus: { triangles: [336804, 261612, 87036], draws: [7, 7, 7] },
});

function triangleCount(geometry) {
  const attribute = geometry?.index ?? geometry?.attributes?.position;
  return attribute ? attribute.count / 3 : 0;
}

async function createPlant(name) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({
    seed: 'budget',
    ageYears: AGE_YEARS,
    dayOfYear: DAY_OF_YEAR,
  });
}

/**
 * What one plant costs at each of its own LOD bands, counted the way the field
 * draws it: one draw per organ kind that has instances, plus one for the wood.
 */
function measure(plant) {
  const prototype = createPlantPrototype(plant);
  try {
    return prototype.bands.map((band) => {
      const drawn = band.baked.organs.filter((organ) => organ.count > 0);
      const wood = band.baked.wood ? 1 : 0;
      const triangles =
        drawn.reduce(
          (total, organ) => total + triangleCount(organ.geometry) * organ.count,
          0,
        ) + (band.baked.wood ? triangleCount(band.baked.wood.geometry) : 0);
      return { triangles: Math.round(triangles), draws: drawn.length + wood };
    });
  } finally {
    prototype.dispose();
  }
}

/** The ceiling a plant is held to: its recorded debt, or the target if new. */
function ceilingFor(name, bandCount) {
  const recorded = RECORDED[name];
  if (recorded) return recorded;
  return {
    triangles: Array.from(
      { length: bandCount },
      (_, band) =>
        TARGET_TRIANGLES[Math.min(band, TARGET_TRIANGLES.length - 1)],
    ),
    draws: Array.from(
      { length: bandCount },
      (_, band) => TARGET_DRAWS[Math.min(band, TARGET_DRAWS.length - 1)],
    ),
  };
}

test('no plant grows past the geometry it is already recorded at', async () => {
  for (const name of PLANTS) {
    const bands = measure(await createPlant(name));
    const ceiling = ceilingFor(name, bands.length);
    const known = Boolean(RECORDED[name]);

    bands.forEach((band, index) => {
      const triangleLimit = ceiling.triangles[index];
      const drawLimit = ceiling.draws[index];

      assert.ok(
        band.triangles <= triangleLimit,
        `${name} band ${index}: ${band.triangles.toLocaleString('en-US')} triangles, ` +
          `over its ${known ? 'recorded' : 'target'} ceiling of ${triangleLimit.toLocaleString('en-US')}. ` +
          (known
            ? 'Geometry may only shrink — see library rule 9.'
            : 'A new plant meets the budget on the day it lands.'),
      );

      assert.ok(
        band.draws <= drawLimit,
        `${name} band ${index}: ${band.draws} draws, over its ` +
          `${known ? 'recorded' : 'target'} ceiling of ${drawLimit}. ` +
          (known
            ? 'Merge organ kinds rather than adding one — see library rule 9.'
            : 'Band 0 is wood + leaves + one feature organ; later bands are wood + leaves.'),
      );
    });
  }
});

test('a plant that has improved has had its record lowered with it', async () => {
  const stale = [];
  for (const name of PLANTS) {
    const recorded = RECORDED[name];
    if (!recorded) continue;
    const bands = measure(await createPlant(name));
    bands.forEach((band, index) => {
      // A little slack: geometry generators drift by a triangle or two across
      // three.js versions, and a test that demanded exactness would fail on an
      // upgrade rather than on a real change.
      if (band.triangles < recorded.triangles[index] - 64) {
        stale.push(
          `  ${name} band ${index}: now ${band.triangles.toLocaleString('en-US')}, ` +
            `recorded ${recorded.triangles[index].toLocaleString('en-US')}`,
        );
      }
      if (band.draws < recorded.draws[index]) {
        stale.push(
          `  ${name} band ${index}: now ${band.draws} draws, recorded ${recorded.draws[index]}`,
        );
      }
    });
  }

  assert.equal(
    stale.length,
    0,
    'These plants got cheaper without RECORDED being lowered to match, so the ' +
      'ratchet has gone slack and the win can be silently given back:\n' +
      stale.join('\n'),
  );
});

test('the target ladder keeps EZ-Tree’s 40% / 20% shape', () => {
  const [full, mid, far] = TARGET_TRIANGLES;
  assert.ok(
    Math.abs(mid / full - 0.4) < 0.05,
    `band 1 is ${((mid / full) * 100).toFixed(0)}% of band 0; EZ-Tree's ladder is 40%`,
  );
  assert.ok(
    Math.abs(far / full - 0.2) < 0.05,
    `band 2 is ${((far / full) * 100).toFixed(0)}% of band 0; EZ-Tree's ladder is 20%`,
  );
});
