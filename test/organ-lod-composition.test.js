import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import { createPlantPrototype } from '../src/lib/field/index.js';
import { composeSurvivorMatrix } from '../src/lib/field/organ-composition.js';

/**
 * Is a coarser organ band the finer band with organs culled and the survivors
 * rescaled?
 *
 * The field stores every band as an independent instance set, freed and
 * reallocated on every band change. If a coarser band were only ever a
 * *subset* of the finest one, the field could allocate once for the finest
 * band and make a band change a survivor mask plus an LOD override -- which is
 * how wood already works, and which would end buffer growth and the
 * synchronous shader recompilation that comes with it.
 *
 * That is only sound for the kinds where the relation actually holds. A plant
 * is free to **substitute** at a coarse band rather than cull -- folding a
 * dropped kind's work into a surviving one -- and four kinds once did. All
 * four were changed, because each was buying a draw with memory it turned out
 * not to have. This test records, per organ kind, every relation the library
 * exhibits, so that
 *
 *   - a compositional builder can be pointed at the kinds that permit it, and
 *   - a plant change that moves a kind between classes fails here rather than
 *     silently corrupting a field.
 *
 * Two details of the method matter.
 *
 * **Placements are matched on position *and* rotation together.** Matching on
 * position alone mispairs organs that share a node -- an opposite leaf pair,
 * of which forsythia has some 1500 -- and a mispaired organ then reports a
 * meaningless scale ratio and a meaningless rotation change. Rotation is
 * compared with a tolerance, because a coarse band re-derives the placement
 * and lands a few ulps from the finest band's matrix rather than exactly on it.
 *
 * **The matrix sweeps days as well as seeds.** Eight of the thirty organ kinds
 * are phenology-gated -- buds, flowers, the grass panicles -- and never appear
 * on a single sampled day.
 */

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * The bakes each species is swept at, as `[seed, dayOfYear]`.
 *
 * Enough of the calendar to reach every organ kind the library bakes: eight of
 * the thirty are phenology-gated and appear on no single day. Day 30 has the
 * winter buds and the grass panicles, 110 the flowers, 200 the lavender spikes
 * and the blackcurrant fruit, 260 the capsules.
 *
 * One seed carries the calendar and a second is spot-checked on one day. The
 * relation is a property of the plant's code rather than of its dice, so the
 * second seed is there to catch a classification that only held by luck, not
 * to re-walk the year -- and a full second pass doubled the slowest file in
 * the suite to buy nothing that this does not.
 */
const BAKES = Object.freeze([
  Object.freeze([1, 30]),
  Object.freeze([1, 110]),
  Object.freeze([1, 200]),
  Object.freeze([1, 260]),
  Object.freeze(['field', 200]),
]);

/** Radians. A re-derived placement lands well inside this; 0.1 degrees. */
const ROTATION_TOLERANCE = 2e-3;
/** Relative spread allowed across one band's per-organ scale ratios. */
const RATIO_TOLERANCE = 1e-3;
/** Absolute agreement required between the three axes of a uniform rescale. */
const UNIFORM_TOLERANCE = 1e-3;

/**
 * Every relation each organ kind exhibits across the matrix.
 *
 *   `subset`      every organ the coarse band draws sits on a distinct organ
 *                 of the finest band, same rotation, same colour, and the
 *                 whole band shares one scalar scale ratio. The compositional
 *                 path is sound.
 *   `axes`        as `subset`, but the ratio differs between axes while
 *                 staying constant per organ. Sound too, given a vector scale
 *                 rather than a scalar one.
 *   `dropped`     the kind is not drawn at this band at all.
 *   `substitutes` the coarse band draws organs the finest band has no organ
 *                 for, or re-orients the ones it keeps. Not compositional;
 *                 these keep today's independent-instance-set path.
 *   `absentAtFinest`
 *                 the kind is drawn at a *coarser* band and not at the finest,
 *                 so the finest band is not the superset at all.
 *
 * The substituting entries are not defects. Each is a deliberate decision with
 * a reason recorded next to it.
 */
const EXPECTED = Object.freeze({
  // The raceme and everything hanging off it, the leaf stalks and the dormant
  // buds are dropped past band 0 rather than thinned: they were the whole of
  // this plant's coarse-band cost and none of its coarse-band silhouette. See
  // `geometry-budget-peak.test.js`, where the ladder they used to flatten is
  // recorded.
  'blackcurrant/berries': ['dropped'],
  'blackcurrant/buds': ['dropped'],
  'blackcurrant/calyces': ['dropped'],
  'blackcurrant/flowers': ['dropped'],
  'blackcurrant/leaves': ['subset'],
  'blackcurrant/pedicels': ['dropped'],
  'blackcurrant/petioles': ['dropped'],
  'blackcurrant/racemeAxes': ['dropped'],
  'cherrylaurel/leaves': ['subset'],
  // This used to substitute: a coarse band dropped `stems` and re-rooted each
  // head at its stem base, stretched to the stem's length, so the head drew
  // the stem too -- and out of flower it drew stem stand-ins where the finest
  // band drew nothing at all. Echinacea keeps its stems at every band now, and
  // records the third part that costs in `geometry-budget`.
  'echinacea/heads': ['subset'],
  'echinacea/leaves': ['subset'],
  'echinacea/stems': ['subset'],
  'forsythia/buds': ['dropped'],
  'forsythia/capsules': ['dropped'],
  'forsythia/flowers': ['dropped'],
  'forsythia/leaves': ['subset'],
  'hydrangea/buds': ['dropped'],
  'hydrangea/leaves': ['subset'],
  // The panicle's coarse geometry is narrower than its fine one and the
  // instance scale widens it back to the same silhouette without touching its
  // height: constant per organ, but not one number.
  'hydrangea/panicles': ['axes'],
  'hydrangea/stems': ['dropped'],
  // This kind used to substitute in flower: a coarse band dropped the `spikes`
  // mesh and re-seated each spike as a leaf card, at placements no leaf
  // occupied. It was the library's only case of a relation that depended on
  // the day rather than on the species, and it cost lavender its whole
  // composed-path saving. The spikes are now simply dropped.
  'lavender/leaves': ['subset'],
  'lavender/spikes': ['dropped'],
  'miscanthus/blades': ['subset'],
  // These used to substitute: the culm was walked with a wider stride at a
  // coarse band, so one coarse segment spanned several fine ones and sat on a
  // new chord. The segments are fixed now and the band changes the geometry
  // instead -- a six-triangle tube near, a two-triangle card beyond -- so the
  // placements are identical and the rescale is exactly 1. See the grasses'
  // `CULM_SECTION_STRIDE`.
  'miscanthus/culms': ['subset'],
  'miscanthus/panicles': ['axes'],
  'pennisetum/blades': ['subset'],
  'pennisetum/culms': ['subset'],
  'pennisetum/panicles': ['dropped'],
  'thuja/shell': ['dropped'],
  'thuja/sprays': ['subset'],
});

/**
 * Kinds with a local axis their geometry has no extent along.
 *
 * The scale there moves no vertex, so this file's own classifier does not read
 * a varying ratio on it as a re-placement. That is *not* the same as the axis
 * being meaningless, and the difference cost a real bug: a thuja spray is a
 * flat plate, and its wind metadata is packed into the ratio of its Z scale to
 * its X scale precisely because Z cannot move a vertex. Rescaling such an axis
 * by anything other than what its geometry axes got rewrites that channel.
 * `dataAxisRatiosSurvive` below is the assertion that pins it.
 */
const DEGENERATE_AXIS = Object.freeze({ 'thuja/sprays': 2 });

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, ...options });
}

const POSITION = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();

function decompose(matrices, index) {
  MATRIX.fromArray(matrices, index * 16);
  MATRIX.decompose(POSITION, QUATERNION, SCALE);
  // q and -q are the same rotation. angleTo copes either way; canonicalizing
  // keeps the numbers readable when an assertion prints them.
  if (QUATERNION.w < 0) {
    QUATERNION.set(-QUATERNION.x, -QUATERNION.y, -QUATERNION.z, -QUATERNION.w);
  }
  return {
    position: POSITION.clone(),
    quaternion: QUATERNION.clone(),
    scale: SCALE.clone(),
  };
}

const positionKey = (placement) =>
  [placement.position.x, placement.position.y, placement.position.z]
    .map((value) => value.toFixed(4))
    .join(',');

function relativeSpread(values) {
  if (values.length === 0) return 0;
  const magnitude = Math.max(...values.map(Math.abs));
  if (magnitude === 0) return 0;
  return (Math.max(...values) - Math.min(...values)) / magnitude;
}

function colorsAgree(coarse, coarseIndex, fine, fineIndex) {
  if (!coarse.colors || !fine.colors) {
    return Boolean(coarse.colors) === Boolean(fine.colors);
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const a = coarse.colors[coarseIndex * 3 + channel];
    const b = fine.colors[fineIndex * 3 + channel];
    if (Math.abs(a - b) > 1e-4) return false;
  }
  return true;
}

/** Index the finest band's placements by position, keeping ties together. */
function indexFinestBand(fine) {
  const placements = Array.from({ length: fine.count }, (_, index) =>
    decompose(fine.matrices, index),
  );
  const byPosition = new Map();
  placements.forEach((placement, index) => {
    const at = positionKey(placement);
    if (!byPosition.has(at)) byPosition.set(at, []);
    byPosition.get(at).push(index);
  });
  return { placements, byPosition };
}

/**
 * Classify one organ kind at one coarse band against the finest band.
 *
 * @returns {{ relation: string, detail: string }}
 */
function classifyBand(fine, index, coarse, degenerateAxis) {
  const claimed = new Set();
  const ratios = [[], [], []];
  let newPlacements = 0;
  let reoriented = 0;
  let colorMismatches = 0;

  for (let instance = 0; instance < coarse.count; instance += 1) {
    const placement = decompose(coarse.matrices, instance);
    const candidates = index.byPosition.get(positionKey(placement)) ?? [];

    let hit = candidates.find(
      (candidate) =>
        !claimed.has(candidate) &&
        index.placements[candidate].quaternion.angleTo(placement.quaternion) <=
          ROTATION_TOLERANCE,
    );
    if (hit === undefined) {
      // The position is one a fine organ occupies, but no unclaimed organ
      // there points the same way: the coarse band re-oriented it.
      const free = candidates.find((candidate) => !claimed.has(candidate));
      if (free === undefined) {
        newPlacements += 1;
        continue;
      }
      hit = free;
      reoriented += 1;
    }
    claimed.add(hit);

    const survivor = index.placements[hit];
    ratios[0].push(placement.scale.x / survivor.scale.x);
    ratios[1].push(placement.scale.y / survivor.scale.y);
    ratios[2].push(placement.scale.z / survivor.scale.z);
    if (!colorsAgree(coarse, instance, fine, hit)) colorMismatches += 1;
  }

  // Colour parity is a precondition of the redesign independent of placement:
  // a survivor must keep its colour, or one colour buffer cannot serve both
  // bands. It holds for every kind today, substitutes included, so it is an
  // outright failure rather than another relation to record.
  assert.equal(
    colorMismatches,
    0,
    `${colorMismatches} of ${coarse.count} survivors change colour between bands, so one colour buffer cannot serve both`,
  );

  if (newPlacements > 0 || reoriented > 0) {
    return {
      relation: 'substitutes',
      detail: `${newPlacements} new placements and ${reoriented} re-oriented, of ${coarse.count}`,
    };
  }

  const axes = [0, 1, 2].filter((axis) => axis !== degenerateAxis);
  const spreads = axes.map((axis) => relativeSpread(ratios[axis]));
  if (spreads.some((spread) => spread > RATIO_TOLERANCE)) {
    return {
      relation: 'substitutes',
      detail: `the scale ratio varies per organ (relative spread ${spreads
        .map((spread) => spread.toFixed(4))
        .join('/')})`,
    };
  }

  const means = axes.map((axis) => {
    const values = ratios[axis];
    return values.reduce((total, value) => total + value, 0) / values.length;
  });
  const uniform = means.every(
    (mean) => Math.abs(mean - means[0]) < UNIFORM_TOLERANCE,
  );
  return {
    relation: uniform ? 'subset' : 'axes',
    detail: `scale ratio ${means.map((mean) => mean.toFixed(4)).join('/')}`,
  };
}

/* -------------------------------------------------------------------- *
 * What the library emits
 * -------------------------------------------------------------------- */

/**
 * Largest world-space error, in metres, allowed between an organ as the plant
 * baked it and the same organ reconstructed from the base band.
 *
 * A reconstruction is not expected to be bit-exact: the survivor's rescale is
 * the mean of the band's per-organ ratios, and the placements it is built on
 * were matched within a tolerance rather than by identity. The measured worst
 * case across the library is an order of magnitude under this, and this is
 * itself far under a millimetre — well below what a leaf a few centimetres
 * across can show.
 */
const RECONSTRUCTION_TOLERANCE = 1e-4;

/** The corners of a geometry's bounds, in its own local frame. */
const CORNERS = [];
function localCorners(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  CORNERS.length = 0;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) CORNERS.push(new THREE.Vector3(x, y, z));
    }
  }
  return CORNERS;
}

const BAKED_MATRIX = new THREE.Matrix4();
const REBUILT_MATRIX = new THREE.Matrix4();
const BAKED_CORNER = new THREE.Vector3();
const REBUILT_CORNER = new THREE.Vector3();

/**
 * The library's own answer must agree with this file's independent one, and
 * where it claims a band is a subset, that band must actually rebuild from the
 * base band.
 *
 * The rebuild is checked on the geometry's corners rather than on matrix
 * elements, because that is what a viewer sees: an unconstrained scale on an
 * axis the geometry has no extent along (a thuja spray's local Z) moves a
 * matrix element and moves no vertex.
 */
function checkComposition(prototype, name, kind, relations, where) {
  const key = `${name}/${kind}`;
  const composition = prototype.organComposition(kind);
  assert.ok(
    composition,
    `${key} at ${where}: a prototype asked for composition returned none`,
  );

  const expected = [...relations].every((relation) =>
    ['subset', 'axes', 'dropped'].includes(relation),
  );
  assert.equal(
    composition.compositional,
    expected,
    `${key} at ${where}: the library calls this ${
      composition.compositional ? 'compositional' : 'not compositional'
    } and this file's independent classification disagrees.\n` +
      `  relations found here: ${[...relations].join(', ')}\n` +
      `  library's reason: ${composition.reason ?? '(none)'}`,
  );
  if (!composition.compositional) return;

  const bakes = prototype.bands.map((band) => band.baked);
  assert.equal(composition.bands.length, bakes.length);
  assert.equal(
    composition.capacity,
    composition.base.count,
    `${key} at ${where}: capacity must be the base band's count, which every other band is a subset of`,
  );

  for (const [band, entry] of composition.bands.entries()) {
    const organ =
      bakes[band].organs.find((candidate) => candidate.kind === kind) ?? null;
    if (!entry.drawn) {
      assert.ok(
        !organ || organ.count === 0,
        `${key} at ${where}: band ${band} is reported as not drawn, but the bake draws ${organ?.count} organs`,
      );
      continue;
    }

    assert.equal(entry.survivors.length, organ.count);
    assert.ok(
      entry.survivors.every((survivor) => survivor < composition.capacity),
      `${key} at ${where}: band ${band} survives an organ outside the base band`,
    );
    assert.equal(
      new Set(entry.survivors).size,
      entry.survivors.length,
      `${key} at ${where}: band ${band} maps two organs onto one base organ, so they would share a slot`,
    );

    const corners = localCorners(organ.geometry);
    let worst = 0;
    for (let instance = 0; instance < organ.count; instance += 1) {
      BAKED_MATRIX.fromArray(organ.matrices, instance * 16);
      composeSurvivorMatrix(
        REBUILT_MATRIX,
        composition.base.matrices,
        entry.survivors[instance],
        entry.scale,
      );
      for (const corner of corners) {
        BAKED_CORNER.copy(corner).applyMatrix4(BAKED_MATRIX);
        REBUILT_CORNER.copy(corner).applyMatrix4(REBUILT_MATRIX);
        worst = Math.max(worst, BAKED_CORNER.distanceTo(REBUILT_CORNER));
      }

      // The base band's colours have to serve every band, because the whole
      // point is that one colour buffer is allocated once.
      if (composition.base.colors) {
        const survivor = entry.survivors[instance];
        for (let channel = 0; channel < 3; channel += 1) {
          assert.ok(
            Math.abs(
              organ.colors[instance * 3 + channel] -
                composition.base.colors[survivor * 3 + channel],
            ) <= 1e-4,
            `${key} at ${where}: band ${band} organ ${instance} does not carry its base organ's colour`,
          );
        }
      }
    }

    dataAxisRatiosSurvive(key, band, entry, organ.geometry);

    assert.ok(
      worst <= RECONSTRUCTION_TOLERANCE,
      `${key} at ${where}: band ${band} rebuilt from the base band is ${worst.toExponential(2)} m off, over the ${RECONSTRUCTION_TOLERANCE} m allowed`,
    );
    RECONSTRUCTION_ERROR.worst = Math.max(RECONSTRUCTION_ERROR.worst, worst);
    if (worst > (RECONSTRUCTION_ERROR.byKind.get(key) ?? 0)) {
      RECONSTRUCTION_ERROR.byKind.set(key, worst);
    }
  }
}

/**
 * An axis with no geometric extent must be rescaled exactly as its geometry
 * axes were, so any ratio between them survives untouched.
 *
 * Comparing geometry corners cannot see this: nothing moves on such an axis by
 * definition, so a wrong scale there is invisible to every positional check in
 * this file. It is still wrong. A thuja spray carries its wind metadata in
 * `scale.z / scale.x`, and a band that averaged the Z ratios instead of
 * matching the X factor shifted the packed value into a different quantisation
 * bucket -- which produced the wrong LOD level at one band and threw outright
 * at the next. Nothing here caught it; a WebGPU material test did.
 */
function dataAxisRatiosSurvive(key, band, entry, geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest === 0) return;

  const axes = ['x', 'y', 'z'];
  const extents = [size.x, size.y, size.z];
  const carrying = axes.filter((_, axis) => extents[axis] / largest < 1e-6);
  const geometric = axes.filter((_, axis) => extents[axis] / largest >= 1e-6);
  if (carrying.length === 0 || geometric.length === 0) return;

  const reference = entry.scale[geometric[0]];
  for (const axis of carrying) {
    assert.ok(
      Math.abs(entry.scale[axis] - reference) < 1e-9,
      `${key} band ${band}: the ${axis} axis carries no geometry, so it may ` +
        `carry data -- it must be rescaled by ${reference}, as its geometry ` +
        `axes were, but it is rescaled by ${entry.scale[axis]}. Any ratio ` +
        'between the two would be rewritten.',
    );
  }
}

/** Reported at the end, so the margin is visible rather than merely asserted. */
const RECONSTRUCTION_ERROR = { worst: 0, byKind: new Map() };

/**
 * Sweep the matrix for one species.
 *
 * Memoized: the sweep bakes each species at every seed and day, which is by
 * far the most expensive thing here, and the staleness check below needs the
 * same answer the per-species tests do.
 *
 * @returns {Promise<Map<string, Map<string, string>>>} kind -> relation -> an
 *   example
 */
const SWEEPS = new Map();
const relationsFor = (name) => {
  if (!SWEEPS.has(name)) SWEEPS.set(name, sweep(name));
  return SWEEPS.get(name);
};

async function sweep(name) {
  const found = new Map();
  const record = (kind, relation, detail) => {
    if (!found.has(kind)) found.set(kind, new Map());
    if (!found.get(kind).has(relation)) found.get(kind).set(relation, detail);
  };

  for (const [seed, dayOfYear] of BAKES) {
    {
      const plant = await createPlant(name, { seed, dayOfYear });
      const prototype = createPlantPrototype(plant);
      try {
        const bakes = prototype.bands.map((band) => band.baked);
        assert.ok(
          bakes.length > 1,
          'a plant with one band says nothing about band composition',
        );

        for (const kind of prototype.organKinds) {
          const where = `seed ${seed}, day ${dayOfYear}`;
          const relations = new Set();
          const fine = bakes[0].organs.find((organ) => organ.kind === kind);
          if (!fine || fine.count === 0) {
            record(kind, 'absentAtFinest', where);
            relations.add('absentAtFinest');
          } else {
            const index = indexFinestBand(fine);

            for (let band = 1; band < bakes.length; band += 1) {
              const coarse = bakes[band].organs.find(
                (organ) => organ.kind === kind,
              );
              if (!coarse || coarse.count === 0) {
                record(kind, 'dropped', `${where}, band ${band}`);
                relations.add('dropped');
                continue;
              }
              const { relation, detail } = classifyBand(
                fine,
                index,
                coarse,
                DEGENERATE_AXIS[`${name}/${kind}`] ?? null,
              );
              record(
                kind,
                relation,
                `${where}, band ${band}: ${fine.count} -> ${coarse.count} organs, ${detail}`,
              );
              relations.add(relation);
            }
          }

          checkComposition(prototype, name, kind, relations, where);
        }
      } finally {
        prototype.dispose();
        plant.dispose();
      }
    }
  }
  return found;
}

/* -------------------------------------------------------------------- *
 * The recorded relations
 * -------------------------------------------------------------------- */

for (const name of PLANTS) {
  test(`${name}: every organ kind relates its bands the recorded way`, async () => {
    const found = await relationsFor(name);

    for (const [kind, relations] of found) {
      const key = `${name}/${kind}`;
      const expected = EXPECTED[key];
      assert.ok(
        expected,
        `${key} has no recorded band relation. Classify it and record one; a new kind must not join the compositional path by default.`,
      );

      const actual = [...relations.keys()].sort();
      assert.deepEqual(
        actual,
        [...expected].sort(),
        `${key} relates its bands differently than recorded.\n` +
          `  recorded: ${[...expected].sort().join(', ')}\n` +
          `  found:    ${actual.join(', ')}\n` +
          [...relations]
            .map(([relation, detail]) => `  ${relation}: ${detail}`)
            .join('\n'),
      );
    }
  });
}

test('the recorded relations name only kinds the library still bakes', async () => {
  // A renamed or removed kind must not leave a stale relation behind, or the
  // redesign would be aimed at something that no longer exists.
  const baked = new Set();
  for (const name of PLANTS) {
    for (const kind of await relationsFor(name))
      baked.add(`${name}/${kind[0]}`);
  }

  const stale = Object.keys(EXPECTED).filter((key) => !baked.has(key));
  assert.deepEqual(stale, [], 'recorded relations for kinds nothing bakes');
});

test('the compositional path has a majority of organ kinds to serve', () => {
  // The redesign is only worth building if it covers most of the library. This
  // is the headline: every organ kind in the library composes. Keep it that
  // way. A kind that substitutes cannot share one allocation across its bands,
  // and the fallback exists for correctness, not as a design option.
  const substituting = Object.entries(EXPECTED).filter(([, relations]) =>
    relations.some(
      (relation) => !['subset', 'axes', 'dropped'].includes(relation),
    ),
  );
  assert.deepEqual(
    substituting.map(([kind]) => kind),
    [],
    'a kind stopped composing; it cannot share one allocation across its bands',
  );
  assert.equal(Object.keys(EXPECTED).length, 30);
});

test('the reconstruction margin is reported, not merely asserted', () => {
  // Ordered last. Every species test has run by now, so this prints the real
  // worst case rather than a partial one -- the number that says whether
  // rebuilding a band from the base band is visually free.
  const worst = [...RECONSTRUCTION_ERROR.byKind]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, error]) => `${key} ${error.toExponential(2)} m`)
    .join(', ');
  console.log(
    `  worst rebuild error ${RECONSTRUCTION_ERROR.worst.toExponential(2)} m of ${RECONSTRUCTION_TOLERANCE} m allowed; largest: ${worst}`,
  );
  assert.ok(RECONSTRUCTION_ERROR.worst > 0, 'nothing was reconstructed at all');
});

test('every prototype carries the analysis, because a field cannot be built without it', async () => {
  // The analysis used to be opt-in. It is not any more: a field allocates each
  // organ kind once, for its finest band, so it has to know how the bands
  // relate before it can allocate anything at all.
  const plant = await createPlant('forsythia', { seed: 1, dayOfYear: 200 });
  const prototype = createPlantPrototype(plant);
  try {
    for (const kind of prototype.organKinds) {
      const composition = prototype.organComposition(kind);
      // Compared on a field of the result rather than on the result itself:
      // a composition holds the bake's matrices, and asking `assert` to render
      // one in a failure diff serialises tens of thousands of floats.
      assert.equal(
        typeof composition?.compositional,
        'boolean',
        `${kind}: a prototype returned no composition`,
      );
    }
  } finally {
    prototype.dispose();
    plant.dispose();
  }
});

test('an unknown organ kind has no composition', async () => {
  const plant = await createPlant('thuja', { seed: 1, dayOfYear: 200 });
  const prototype = createPlantPrototype(plant);
  try {
    assert.equal(prototype.organComposition('nothing-bakes-this'), null);
  } finally {
    prototype.dispose();
    plant.dispose();
  }
});
