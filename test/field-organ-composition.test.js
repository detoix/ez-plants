import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import { createPrototypePool, PlantField } from '../src/lib/field/index.js';

const REPO = new URL('..', import.meta.url).pathname;

/**
 * The field's composed organ path.
 *
 * A kind whose coarser bands are subsets of its finest one is allocated
 * **once**, for the finest band, and a band change becomes a survivor mask, a
 * matrix rewrite and a geometry-rung override — instead of freeing one
 * instance set and allocating another, which is what makes a buffer grow, and
 * a growing storage buffer is a synchronous shader recompilation.
 *
 * These tests assert on behaviour over time rather than on a single frame's
 * output, because that is where this class of change goes wrong: the picture
 * stays correct while the data lifecycle underneath it does not. So they watch
 * allocation counts across band changes, not just which organs are drawn.
 *
 * `test/organ-lod-composition.test.js` is the other half: it proves the
 * relation the path depends on actually holds, per species and per bake.
 */

function grid(count, spacing = 2) {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    position: [(index % side) * spacing, 0, Math.floor(index / side) * spacing],
    rotationY: index * 0.7,
  }));
}

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

async function withField(name, { seeds = [1], count = 12, ...rest }, body) {
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

/** Organ kinds the field drew, all of which are composed. */
const composedKinds = (field) => [...field._organMeshes.keys()].sort();

test('a composed kind allocates once and never grows across band changes', async () => {
  await withField('forsythia', { count: 12 }, (field) => {
    const kinds = composedKinds(field);
    assert.ok(
      kinds.includes('leaves'),
      `forsythia leaves should compose; composed kinds were ${kinds.join(', ')}`,
    );

    const entry = field._organMeshes.get('leaves');
    const span = () => entry.mesh._instancesArrayCount;
    const built = span();
    assert.ok(built > 0);

    // Walk every band, repeatedly and out of order. Under the old path a band
    // nobody started at grows the buffer the first time a plant enters it.
    for (const pass of [2, 1, 0, 2, 0, 1, 2]) {
      field.setLevels(new Array(12).fill(pass));
      assert.equal(
        span(),
        built,
        `band ${pass} changed the allocated span from ${built} to ${span()}`,
      );
    }

    // And a mixed field, which is what a real camera produces.
    field.setLevels(Array.from({ length: 12 }, (_, index) => index % 3));
    assert.equal(span(), built);
  });
});

test('a band draws exactly what the plant baked at that band', () => {
  // The claim the whole path rests on, checked against the bake itself rather
  // than against another implementation: for every plant, at every band, the
  // organ the field draws must land where the plant put it.
  //
  // Each of a band's organs is paired with the field instance it was written
  // to. The bake writes its organ `local` in its own order; the field writes
  // it to the slot of the base organ it survived from, `survivors[local]`. So
  // the correspondence is exact, and no two organs can cancel out in a sorted
  // comparison.
  //
  // Compared as transformed geometry corners, in metres. A thuja spray is a
  // flat plate whose local Z extent is zero, so its Z scale is unconstrained
  // and the rebuild differs there by a part in ten thousand while every vertex
  // lands in the same place. Metres are also the unit a tolerance means
  // something in.
  const tolerance = 1e-4;

  const cornersOf = (geometry) => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    const corners = [];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    return corners;
  };

  return Promise.all(
    ['forsythia', 'blackcurrant', 'thuja', 'hydrangea', 'miscanthus'].map(
      (name) =>
        withField(name, { count: 6 }, (field, prototypes) => {
          const fromBake = new THREE.Matrix4();
          const fromField = new THREE.Matrix4();
          const organMatrix = new THREE.Matrix4();
          const here = new THREE.Vector3();
          const there = new THREE.Vector3();

          for (const band of [0, 1, 2]) {
            field.setLevels(new Array(6).fill(band));

            for (const [kind, entry] of field._organMeshes) {
              for (let index = 0; index < 6; index += 1) {
                const placement = field._placements[index];
                const composition = placement.prototype.organComposition(kind);
                const baked = composition.bands[band];
                const slot = field._slots[index].get(kind);

                if (!baked.drawn) {
                  for (const id of slot.ids) {
                    assert.equal(
                      entry.mesh.getVisibilityAt(id),
                      false,
                      `${name}/${kind} band ${band}: a dropped kind still draws`,
                    );
                  }
                  continue;
                }

                const organ = baked.organ;
                const corners = cornersOf(organ.geometry);
                for (let local = 0; local < organ.count; local += 1) {
                  organMatrix.fromArray(organ.matrices, local * 16);
                  fromBake.multiplyMatrices(placement.transform, organMatrix);
                  entry.mesh.getMatrixAt(
                    slot.ids[baked.survivors[local]],
                    fromField,
                  );

                  for (const corner of corners) {
                    here.copy(corner).applyMatrix4(fromBake);
                    there.copy(corner).applyMatrix4(fromField);
                    assert.ok(
                      here.distanceTo(there) <= tolerance,
                      `${name}/${kind} band ${band}, plant ${index}, organ ${local}: ` +
                        `a corner lands ${here.distanceTo(there).toExponential(2)} m ` +
                        'from where the plant baked it',
                    );
                  }
                }
              }
            }
          }
        }),
    ),
  );
});

test('a composed kind hides the organs its band culls', async () => {
  await withField('forsythia', { count: 4 }, (field, prototypes) => {
    const entry = field._organMeshes.get('leaves');
    const composition = prototypes[0].organComposition('leaves');

    for (const band of [0, 1, 2]) {
      field.setLevels(new Array(4).fill(band));

      let visible = 0;
      for (const ids of field._slots.map((slots) => slots.get('leaves').ids)) {
        for (const id of ids) {
          if (entry.mesh.getVisibilityAt(id)) visible += 1;
        }
      }
      assert.equal(
        visible,
        composition.bands[band].survivors.length * 4,
        `band ${band}: visible instances do not match the band's survivors`,
      );
      // The instances themselves never go away, whatever the band.
      assert.equal(
        field._slots[0].get('leaves').ids.length,
        composition.capacity,
      );
    }
  });
});

test('hiding a plant hides it, and showing it restores only its band', async () => {
  // A composed kind keeps culled organs allocated but invisible, so "show this
  // plant again" must not be implemented as "make its instances visible".
  await withField('forsythia', { count: 4 }, (field, prototypes) => {
    const entry = field._organMeshes.get('leaves');
    const composition = prototypes[0].organComposition('leaves');
    field.setLevels(new Array(4).fill(2));

    const visibleFor = (index) => {
      let visible = 0;
      for (const id of field._slots[index].get('leaves').ids) {
        if (entry.mesh.getVisibilityAt(id)) visible += 1;
      }
      return visible;
    };
    const atBand2 = composition.bands[2].survivors.length;
    assert.equal(visibleFor(0), atBand2);

    field.setVisibleAt(0, false);
    assert.equal(visibleFor(0), 0, 'a hidden plant still draws organs');
    assert.equal(visibleFor(1), atBand2, 'hiding one plant hid another');

    field.setVisibleAt(0, true);
    assert.equal(
      visibleFor(0),
      atBand2,
      'showing a plant restored organs its band culls',
    );
  });
});

test('every organ kind of every species composes', async () => {
  // The library-wide guarantee, checked through the field rather than through
  // the analysis: no species may leave a kind on the reallocating path.
  //
  // Four kinds once did, each folding a dropped kind's work into a surviving
  // one to save a draw -- lavender's spikes into its leaf pool, echinacea's
  // stems into its heads, and both grasses' culms onto wider chords. Every one
  // of them was buying a draw with memory, and every one was changed. The
  // fallback still exists, for correctness; it is not a design option.
  const names = readdirSync(join(REPO, 'src/lib/plants'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    await withField(name, { count: 4 }, (field, prototypes) => {
      for (const prototype of prototypes) {
        for (const kind of prototype.organKinds) {
          const composition = prototype.organComposition(kind);
          assert.equal(
            composition.compositional,
            true,
            `${name}/${kind} no longer composes: ${composition.reason}`,
          );
        }
      }
      assert.deepEqual(
        composedKinds(field),
        [...field._organMeshes.keys()].sort(),
        `${name}: the field left a kind on the old path`,
      );
    });
  }
});

test('a grass culm keeps its segments and changes its geometry instead', async () => {
  // Culms used to be walked with a wider stride at a coarse band, which moved
  // every surviving segment onto a new chord and cost the kind its composed
  // path. The segments are fixed now, so every band draws the same count at
  // the same placements, and the band picks a cheaper geometry rung.
  for (const name of ['miscanthus', 'pennisetum']) {
    await withField(name, { count: 4 }, (field, prototypes) => {
      const composition = prototypes[0].organComposition('culms');
      assert.equal(
        composition.compositional,
        true,
        `${name} culms should compose; the analysis says: ${composition.reason}`,
      );
      assert.ok(composedKinds(field).includes('culms'));

      // Identical placements at every band: same count, and a rescale of one.
      const counts = composition.bands.map((band) =>
        band.drawn ? band.survivors.length : 0,
      );
      assert.ok(counts.every((count) => count === counts[0]));
      for (const band of composition.bands) {
        for (const axis of ['x', 'y', 'z']) {
          assert.ok(
            Math.abs(band.scale[axis] - 1) < 1e-6,
            `${name}: a culm band rescales by ${band.scale[axis]}, not 1`,
          );
        }
      }

      // And the coarse bands really are cheaper, in geometry rather than count.
      const rungs = composition.bands.map((band) =>
        band.organ.geometry.getIndex()
          ? band.organ.geometry.getIndex().count / 3
          : band.organ.geometry.attributes.position.count / 3,
      );
      assert.ok(
        rungs[1] < rungs[0] && rungs[2] < rungs[0],
        `${name}: coarse culm bands cost ${rungs.join('/')} triangles`,
      );
    });
  }
});

test('lavender in flower composes its leaves', async () => {
  // This is the case that used to fail, and the reason the plant changed. The
  // leaf pool carried two stand-in cards per spike at coarse bands, at
  // placements no leaf occupied, so it could not be allocated once. The spikes
  // are dropped now and the pool holds leaves only.
  await withField('lavender', { count: 4, seeds: [1] }, (field, prototypes) => {
    const composition = prototypes[0].organComposition('leaves');
    assert.equal(
      composition.compositional,
      true,
      `lavender leaves should compose; the analysis says: ${composition.reason}`,
    );
    assert.ok(
      composedKinds(field).includes('leaves'),
      'the field left lavender leaves on the old path',
    );

    // And the spikes really are gone past band 0, rather than hiding in the
    // leaf pool: every coarse band draws strictly fewer leaves than band 0.
    field.setLevels(new Array(4).fill(0));
    const atBand0 = field.stats().organInstances;
    for (const band of [1, 2]) {
      field.setLevels(new Array(4).fill(band));
      assert.ok(
        field.stats().organInstances < atBand0,
        `band ${band} draws no fewer organs than band 0`,
      );
    }
  });
});

test('a kind that does not compose is refused, not quietly reallocated', async () => {
  // There is no longer a fallback to reallocate on. A field allocates each
  // organ kind once, for its finest band, so a bake whose coarse band is not a
  // subset of that has no home here -- and saying so is better than drawing
  // the wrong thing. Every plant in the library composes; this is what happens
  // if one stops.
  const plants = [await createPlant('forsythia', { seed: 1 })];
  const prototypes = createPrototypePool(plants);
  const real = prototypes[0].organComposition.bind(prototypes[0]);
  prototypes[0].organComposition = (kind) =>
    kind === 'leaves'
      ? {
          kind,
          compositional: false,
          reason: 'band 1: the band re-orients organs it keeps',
          base: null,
          capacity: 0,
          bands: [],
        }
      : real(kind);

  try {
    assert.throws(
      () => new PlantField({ prototypes, placements: grid(4) }),
      /leaves.*does not compose.*re-orients/s,
    );
  } finally {
    for (const prototype of prototypes) prototype.dispose();
    for (const plant of plants) plant.dispose();
  }
});

test('a band change writes one plant, not the field', async () => {
  // The property the old path bought with reallocation, and which the composed
  // path must not lose: work is proportional to the plants that moved.
  await withField('forsythia', { count: 16 }, (field, prototypes) => {
    field.setLevels(new Array(16).fill(0));
    const before = field.stats().instanceWrites;

    field.setLevelAt(3, 2);
    const one = field.stats().instanceWrites - before;
    const composition = prototypes[0].organComposition('leaves');
    assert.ok(one > 0);
    assert.ok(
      one <= composition.capacity * 2,
      `one plant's band change wrote ${one} instances, which is not one plant's worth`,
    );
  });
});

test('the allocated span is fixed for the life of the field', async () => {
  await withField('forsythia', { count: 8 }, (field) => {
    const span = () => field.stats().slots;
    const built = span();

    for (const levels of [
      new Array(8).fill(2),
      Array.from({ length: 8 }, (_, index) => index % 3),
      new Array(8).fill(0),
      new Array(8).fill(1),
    ]) {
      field.setLevels(levels);
      assert.equal(span(), built, 'a band change moved the allocation');
      assert.equal(
        field.stats().unusedSlots,
        built - field.stats().organInstances,
      );
    }
  });
});
