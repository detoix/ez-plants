import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlantPrototype } from '../src/lib/field/plant-prototype.js';
import { TARGET_DRAWS, TARGET_TRIANGLES } from './geometry-budget.test.js';

/**
 * Rule 9, on the day each plant is actually most expensive.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists next to `geometry-budget.test.js`
 * ---------------------------------------------------------------------------
 * That file measures every plant at one instant: age 5, day 230. The comment
 * over its constant calls day 230 *"peak season: the most leaf, flower and
 * fruit a plant ever carries at once"*, and for most of the library that is
 * true enough. For a lavender it is precisely, unluckily false. Day 230 falls
 * about four days **after** the late-summer shear, so the one plant in the
 * library whose entire ornament is cut off in a single day is measured on the
 * first day it is gone. Swept across the year, its flowering peak carries
 * roughly 80% more triangles than the day the ratchet looks at, and every one
 * of them was unguarded.
 *
 * That is not a lavender problem. Measured across ages 3/5/8 and every
 * fifteenth day of the year, four of the nine plants here are heaviest on a
 * day that ratchet never visits, and two of them by an order of magnitude. A
 * budget that is only enforced on one arbitrary date is not enforced.
 *
 * ---------------------------------------------------------------------------
 * Why the peaks are recorded rather than searched for
 * ---------------------------------------------------------------------------
 * The honest version of this test re-runs that whole sweep, which is 216 plant
 * builds and about four and a half minutes. That is far too slow to sit in
 * `npm test`, and a test nobody waits for is a test nobody runs.
 *
 * So the sweep is done offline and its answer is written down: each plant is
 * rebuilt at the single age and day it was measured worst on, which is nine
 * builds and a few seconds. The cost is that the record is only as good as the
 * last sweep — a change that moves a plant's peak somewhere else will be
 * measured slightly off its true worst. That is a real limitation and it is
 * still enormously better than one fixed date, because a peak moves by days
 * when geometry changes, not by months. **Re-run the sweep when a plant's
 * phenology changes**, not only when its geometry does.
 *
 * ---------------------------------------------------------------------------
 * Why this is a ratchet too
 * ---------------------------------------------------------------------------
 * Same stance as its sibling, and for the same reason: the sweep found four
 * plants already far outside the target on their worst day, and a test that
 * simply asserted the target would fail on the day it landed and be deleted in
 * the morning. A plant with a recorded peak may not exceed it; a plant without
 * one is held to rule 9's target immediately.
 *
 * Nothing here is a licence to spend. A recorded peak is debt, and the numbers
 * only ever move down.
 */

/** Uniform seed, so a peak is a property of the plant and not of a draw. */
const SEED = 'budget';

/**
 * The worst (age, day) found for each plant, and what it cost there.
 *
 * Measured 2026-09-06 by sweeping ages 3/5/8 across every fifteenth day of the
 * year and keeping the band-0 maximum, then refining lavender on a three-day
 * grid over ages 1-10 through its flowering season. That refinement moved its
 * peak from age 5 day 175 to age 4 day 165 and found 600 more triangles, which
 * is the coarse grid's error bar made visible: treat every entry here that has
 * not had the fine treatment as approximate, and low rather than high.
 *
 * `triangles` and `draws` are ceilings. `age` and `day` are where to look.
 */
const PEAKS = Object.freeze({
  /**
   * Inside the whole budget at every band on its worst day as well as on the
   * ratchet's, and the only flowering plant in the library that can currently
   * say so. Its peak is spike emergence, when the plant is carrying a full
   * mound of leaf *and* a full complement of heads and has not yet been cut.
   */
  lavender: {
    age: 4,
    day: 165,
    triangles: [23243, 7612, 3138],
    draws: [3, 2, 2],
  },

  /**
   * Inside the whole budget at bands 1 and 2, on this day and on every other
   * day of the year; band 0 is still the largest debt in the library.
   *
   * The coarse bands used to cost 96% of the fine one -- 143,078 and 141,942
   * against 148,674, in six draws each. That was not a thinning bug in the
   * wood or the leaves, both of which thinned correctly: it was that the
   * raceme, the leaf stalks and the dormant buds were never dropped, so a
   * plant three pixels wide still drew 856 pedicels and 856 flower buds in
   * full. Dropping them past band 0 leaves wood and leaves, which is what rule
   * 9 allows a coarse band, and takes the ladder to 148,674 / 3,998 / 2,862.
   *
   * Band 0 came down from 148,674 with the buds. `buds` and `flowerBuds` were
   * instanced from the berry's own 120-triangle sphere; on their own spindle
   * at 24 they cost a quarter of that, which takes the spring flush this day
   * measures to 52,866 and the bare December bush to 15,040 -- inside band
   * 0's target, where it was at six times it.
   *
   * What is left at band 0 is the fruit, and this day does not see it. In
   * fruit the plant is about 144,000: 856 berries at 120 triangles and 856
   * pedicels at 20. Neither is a ladder fault and neither is reachable by
   * turning a mesh down -- 856 berries cannot fit a 25,000 budget at any
   * resolution that is still a sphere, so closing that gap means a card or a
   * clustered impostor, and a visual verdict rather than a measurement.
   */
  blackcurrant: {
    age: 3,
    day: 100,
    triangles: [52866, 3998, 2862],
    draws: [7, 2, 2],
  },
  /**
   * Band 0 debt, and the coarse bands are comfortably inside theirs.
   *
   * The thing that was very large and very late in the year turned out to be
   * the buds: 2,029 of them on a bare December shrub, each turned at the
   * generator's 8x5 default for 64 triangles, which was 129,856 triangles and
   * 86% of the plant. At 6x3 they are 24 and the day costs 69,236.
   *
   * What is left is 2,029 buds at 48,696, and that is the whole remaining
   * gap: even free, the panicles and wood this day carries are 20,540 of a
   * 25,000 budget. A bud cheap enough to close it is a card, which is what
   * forsythia did -- and is a modelling decision rather than a measurement.
   *
   * Band 1 is 6,342 here, but this day is the reason it needed fixing rather
   * than evidence it was fine: out of leaf the band falls back inside a
   * budget it broke all summer. See the sibling file.
   */
  hydrangea: {
    age: 8,
    day: 325,
    triangles: [69236, 6342, 3490],
    draws: [4, 2, 2],
  },
  /** Debt at band 0 and band 2; inside the ladder elsewhere. */
  forsythia: {
    age: 8,
    day: 100,
    triangles: [31240, 10218, 5763],
    draws: [3, 2, 2],
  },
  /** Debt at band 0 and band 1. The third draw is argued for in the sibling. */
  miscanthus: {
    age: 8,
    day: 235,
    triangles: [28168, 10096, 4460],
    draws: [3, 3, 3],
  },

  // Inside the target on their worst day, recorded so they cannot drift out.
  echinacea: {
    age: 3,
    day: 205,
    triangles: [8172, 4340, 2206],
    draws: [3, 3, 3],
  },
  pennisetum: {
    age: 8,
    day: 220,
    triangles: [20358, 5166, 3286],
    draws: [3, 2, 2],
  },
  cherrylaurel: {
    age: 8,
    day: 175,
    triangles: [7166, 3630, 2102],
    draws: [2, 2, 2],
  },
  thuja: { age: 8, day: 130, triangles: [9408, 3272, 904], draws: [3, 2, 2] },
});

function triangleCount(geometry) {
  const attribute = geometry?.index ?? geometry?.attributes?.position;
  return attribute ? attribute.count / 3 : 0;
}

async function createPlant(name, ageYears, dayOfYear) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ seed: SEED, ageYears, dayOfYear });
}

/** Identical accounting to the sibling file: one part per drawn organ kind. */
function measure(plant) {
  const prototype = createPlantPrototype(plant);
  try {
    return prototype.bands.map((band) => {
      const drawn = band.baked.organs.filter((organ) => organ.count > 0);
      const triangles =
        drawn.reduce(
          (total, organ) => total + triangleCount(organ.geometry) * organ.count,
          0,
        ) + (band.baked.wood ? triangleCount(band.baked.wood.geometry) : 0);
      return {
        triangles: Math.round(triangles),
        draws: drawn.length + (band.baked.wood ? 1 : 0),
      };
    });
  } finally {
    prototype.dispose();
  }
}

const targetTriangles = (band) =>
  TARGET_TRIANGLES[Math.min(band, TARGET_TRIANGLES.length - 1)];
const targetDraws = (band) =>
  TARGET_DRAWS[Math.min(band, TARGET_DRAWS.length - 1)];

test('no plant grows past what it is recorded at on its worst day', async () => {
  for (const [name, peak] of Object.entries(PEAKS)) {
    const bands = measure(await createPlant(name, peak.age, peak.day));

    bands.forEach((band, index) => {
      // The budget, or the recorded peak if that is still worse. A peak below
      // the budget is not a ceiling -- it is just where the plant happened to
      // be on the day it was measured, and holding a plant to it would forbid
      // growth that rule 9 explicitly allows. See the sibling file's
      // `ceilingFor`, which had exactly this bug.
      const triangleLimit = Math.max(
        peak.triangles[index],
        targetTriangles(index),
      );
      const drawLimit = Math.max(peak.draws[index], targetDraws(index));
      const heldByRecord = triangleLimit > targetTriangles(index);
      const drawsHeldByRecord = drawLimit > targetDraws(index);

      assert.ok(
        band.triangles <= triangleLimit,
        `${name} band ${index} at age ${peak.age}, day ${peak.day}: ` +
          `${band.triangles.toLocaleString('en-US')} triangles, over its ` +
          `${heldByRecord ? 'recorded peak' : 'target'} of ` +
          `${triangleLimit.toLocaleString('en-US')}. ` +
          'Geometry may only shrink — see library rule 9.',
      );

      assert.ok(
        band.draws <= drawLimit,
        `${name} band ${index} at age ${peak.age}, day ${peak.day}: ` +
          `${band.draws} draws, over its ` +
          `${drawsHeldByRecord ? 'recorded peak' : 'target'} of ${drawLimit}. ` +
          'Merge organ kinds rather than adding one — see library rule 9.',
      );
    });
  }
});

test('a plant whose peak has improved has had its record lowered with it', async () => {
  const stale = [];
  for (const [name, peak] of Object.entries(PEAKS)) {
    const bands = measure(await createPlant(name, peak.age, peak.day));
    bands.forEach((band, index) => {
      // Only while the peak is still over the budget: below it the record no
      // longer holds the plant, so chasing it downwards would re-impose the
      // freeze. The sibling file carries the argument.
      const inDebt = peak.triangles[index] > targetTriangles(index);
      const drawsInDebt = peak.draws[index] > targetDraws(index);
      // The sibling file's slack, for the same reason: generators drift by a
      // triangle or two across three.js versions.
      if (inDebt && band.triangles < peak.triangles[index] - 64) {
        stale.push(
          `  ${name} band ${index}: now ${band.triangles.toLocaleString('en-US')}, ` +
            `recorded ${peak.triangles[index].toLocaleString('en-US')}`,
        );
      }
      if (drawsInDebt && band.draws < peak.draws[index]) {
        stale.push(
          `  ${name} band ${index}: now ${band.draws} draws, recorded ${peak.draws[index]}`,
        );
      }
    });
  }

  assert.equal(
    stale.length,
    0,
    'These plants got cheaper on their worst day without PEAKS being lowered ' +
      'to match, so the ratchet has gone slack:\n' +
      stale.join('\n'),
  );
});

test('every plant in the library has a recorded peak', async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const repo = new URL('..', import.meta.url).pathname;
  const plants = readdirSync(join(repo, 'src/lib/plants'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const missing = plants.filter((name) => !PEAKS[name]);
  assert.deepEqual(
    missing,
    [],
    'A plant with no recorded peak is only budgeted on one arbitrary day of ' +
      'the year. Sweep it across age and day of year and record its worst ' +
      'case here, held to the rule 9 target:\n' +
      `  triangles ${TARGET_TRIANGLES.join(' / ')}, draws ${TARGET_DRAWS.join(' / ')}`,
  );
});
