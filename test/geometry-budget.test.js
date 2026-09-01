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
 * Measured 2026-08-29. Nearly all of this is debt, not achievement — see the
 * target above. Lower them as plants improve; never raise them.
 */
const RECORDED = Object.freeze({
  // Inside the budget as of the petiole drop — kept here so it cannot regress.
  blackcurrant: { triangles: [16242, 5096, 3592], draws: [3, 2, 2] },
  // Inside the whole budget, triangles and draws, at every band -- and not
  // only on the peak-season day this file measures: the worst day of its year
  // is 24,774 / 8,752 / 4,804 at the flowering peak, when the plant is close
  // to eleven thousand corollas on bare wood.
  //
  // What got it there, in order of size: the corolla became a two-triangle
  // alpha card where it had been a 66-triangle mesh, the petiole moved into
  // the leaf plate, the pedicel was dropped, the leaf and flower buds merged
  // into one one-triangle kind, and `woodOrderLimit` stopped meshing the 309
  // short shoots at bands 1 and 2 while keeping everything growing on them.
  forsythia: { triangles: [22680, 8030, 4415], draws: [3, 2, 2] },
  // Inside the whole budget, triangles and draws, at every band -- and not
  // only on the peak-season day this file measures, which for this plant
  // falls a fortnight *after* the shears and so catches it at its cheapest.
  // Swept across every age and every day of the year, the worst case is
  // 23,589 / 8,600 / 3,410 in 3 / 2 / 2 draws, at spike emergence in the
  // fourth year of a replacement cycle.
  //
  // What kept it there: the flower stems are wood rather than a third organ
  // pool, so band 0's third draw goes to the spikes; a spike is eight
  // triangles of alpha card where the whorls it stands for are several
  // hundred parts; and `landmarkStride` drops every interior ring from the
  // green shoots, which a plant with sessile leaves on a 2 mm stem has no use
  // for. Past band 0 the spikes ride in the leaf pool as cards and
  // `woodOrderLimit` meshes only the framework, which is the one piece of
  // wood a lavender ever really shows.
  lavender: { triangles: [12578, 4184, 1798], draws: [2, 2, 2] },
  // Inside the *triangle* budget at every band as of the card panicle: the
  // head went from five meshes and 6,468 triangles to one mesh and 100, 40 or
  // 14. What is left is a draw debt, and only that. Band 0 spends its third
  // draw on the head and needs a fourth for the plant's green stems; bands 1
  // and 2 have dropped the stems and still need the head, which rule 9 says
  // should by then be carried by the leaf card. Doing that needs foliage-atlas
  // UVs per instance so heads and leaves can share one mesh — the geometry it
  // would save is 40 and 14 triangles a head, so this is now a structural debt
  // rather than a cost one.
  hydrangea: { triangles: [23841, 9498, 4145], draws: [4, 3, 3] },
  // Inside the triangle budget at every band as of the raceme cards, and
  // inside the draw budget at band 0. The head went from three meshes and
  // 3,620 triangles to one mesh and 136, 72 or 28; the three blade kinds
  // became one, because posture is a rotation rather than a mesh.
  //
  // The third draw at bands 1 and 2 is culms, and it is deliberate. Dropping
  // them fits the budget and looks wrong: the heads are carried on those
  // stems, and without them a clump at six metres has its plumes floating in
  // a gap above its own foliage. Merging culms into either of the other two
  // kinds would mean drawing a stem tube as a leaf ribbon. The triangles are
  // already gone — 1,584 of them at band 2 — so what is left here is one draw
  // call, and correctness is worth more than it.
  miscanthus: { triangles: [23526, 9076, 4368], draws: [3, 3, 3] },
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
