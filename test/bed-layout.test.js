import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BED_BANDS,
  BED_BOULDERS,
  BED_PLANTING,
  BED_SPECIES_ORDER,
  bedOutline,
  createBedLayout,
  depthInBed,
  insideBed,
} from '../src/app/bed-layout.js';

const flat = () => 0;

test('the bed layout is deterministic', () => {
  const first = createBedLayout({ groundAt: flat });
  const second = createBedLayout({ groundAt: flat });
  assert.deepEqual(
    first.species.map((entry) => entry.placements),
    second.species.map((entry) => entry.placements),
  );
});

test('a different seed moves the planting', () => {
  const first = createBedLayout({ groundAt: flat });
  const second = createBedLayout({ groundAt: flat, seed: 7 });
  assert.notDeepEqual(
    first.species[0].placements,
    second.species[0].placements,
  );
});

test('every species is planted', () => {
  const layout = createBedLayout({ groundAt: flat });
  assert.deepEqual(
    layout.species.map((entry) => entry.id),
    [...BED_SPECIES_ORDER],
  );
  for (const entry of layout.species) {
    assert.ok(
      entry.placements.length > 0,
      `${entry.id} was given no ground in the bed`,
    );
  }
});

test('plantCount counts plants, not boulders', () => {
  const layout = createBedLayout({ groundAt: flat });
  const summed = layout.species.reduce(
    (total, entry) => total + entry.placements.length,
    0,
  );
  assert.equal(layout.plantCount, summed);
});

test('every plant stands in its own band', () => {
  const layout = createBedLayout({ groundAt: flat });
  for (const entry of layout.species) {
    const band = BED_BANDS.find((candidate) => candidate.id === entry.id);
    for (const placement of entry.placements) {
      const [x, , z] = placement.position;
      const depth = depthInBed(x, z);
      assert.ok(
        depth >= band.from && depth < band.to,
        `${entry.id} sits ${depth.toFixed(2)} m in, outside [${band.from}, ${band.to})`,
      );
    }
  }
});

test('the bands run outermost lavender, then grass, then hydrangea', () => {
  const layout = createBedLayout({ groundAt: flat });
  const meanDepth = (id) => {
    const entry = layout.species.find((candidate) => candidate.id === id);
    const total = entry.placements.reduce(
      (sum, placement) =>
        sum + depthInBed(placement.position[0], placement.position[2]),
      0,
    );
    return total / entry.placements.length;
  };
  assert.ok(meanDepth('lavender') < meanDepth('pennisetum'));
  assert.ok(meanDepth('pennisetum') < meanDepth('hydrangea'));
});

test('no plant is planted outside the mulch', () => {
  const layout = createBedLayout({ groundAt: flat });
  for (const entry of layout.species) {
    for (const placement of entry.placements) {
      const [x, , z] = placement.position;
      assert.ok(
        insideBed(x, z),
        `${entry.id} at ${x.toFixed(2)}, ${z.toFixed(2)} leaves the bed`,
      );
    }
  }
});

test('no two plants are planted on top of each other', () => {
  const layout = createBedLayout({ groundAt: flat });
  const all = layout.species.flatMap((entry) =>
    entry.placements.map((placement) => ({
      x: placement.position[0],
      z: placement.position[2],
      footprint: BED_PLANTING[entry.id].footprint,
    })),
  );
  for (let a = 0; a < all.length; a += 1) {
    for (let b = a + 1; b < all.length; b += 1) {
      const minimum = (all[a].footprint + all[b].footprint) * 0.58;
      const distance = Math.hypot(all[a].x - all[b].x, all[a].z - all[b].z);
      assert.ok(
        distance >= minimum - 1e-9,
        `two plants are ${distance.toFixed(3)} m apart, minimum ${minimum.toFixed(3)}`,
      );
    }
  }
});

test('nothing is planted through a boulder', () => {
  const layout = createBedLayout({ groundAt: flat });
  for (const entry of layout.species) {
    const footprint = BED_PLANTING[entry.id].footprint;
    for (const placement of entry.placements) {
      const [x, , z] = placement.position;
      for (const boulder of BED_BOULDERS) {
        const minimum = (footprint + boulder.radius) * 0.58;
        assert.ok(
          Math.hypot(x - boulder.x, z - boulder.z) >= minimum - 1e-9,
          `a ${entry.id} grows through the boulder at ${boulder.x}, ${boulder.z}`,
        );
      }
    }
  }
});

test('every boulder sits inside the bed', () => {
  for (const boulder of BED_BOULDERS) {
    assert.ok(
      insideBed(boulder.x, boulder.z, boulder.radius),
      `the boulder at ${boulder.x}, ${boulder.z} is on the lawn`,
    );
  }
});

test('the layout refuses ground it cannot read', () => {
  assert.throws(() => createBedLayout({ groundAt: null }), TypeError);
  assert.throws(
    () => createBedLayout({ groundAt: () => Number.NaN }),
    RangeError,
  );
});

test('the outline is a kidney, not a circle', () => {
  const outline = bedOutline(180);
  // A kidney is concave somewhere. Walking the polygon, the sign of the
  // cross product has to change; on a circle or an ellipse it never does.
  let positive = 0;
  let negative = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const [ax, az] = outline[index];
    const [bx, bz] = outline[(index + 1) % outline.length];
    const [cx, cz] = outline[(index + 2) % outline.length];
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (cross > 0) positive += 1;
    if (cross < 0) negative += 1;
  }
  assert.ok(
    positive > 0 && negative > 0,
    'the outline is convex everywhere -- that is an ellipse, not a kidney',
  );
});
