import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIELD_DEFAULT_COUNT,
  FIELD_LAYOUT_SEED,
  FIELD_SPECIES_COUNT,
  createFieldLayout,
} from '../src/app/field-layout.js';
import { aggregateFieldStats } from '../src/app/field-stats.js';
import { terrainHeightAt } from '../src/app/field-terrain-height.js';

test('the original 400-plant mixed scatter remains deterministic and terrain-conforming', () => {
  const groundAt = (x, z) => terrainHeightAt(x, z, { amplitude: 1.7 });
  const first = createFieldLayout({ groundAt });
  const second = createFieldLayout({ groundAt });

  assert.deepEqual(first, second);
  assert.equal(FIELD_DEFAULT_COUNT, 400);
  assert.equal(FIELD_SPECIES_COUNT, 4);
  assert.equal(FIELD_LAYOUT_SEED, 20260828);
  assert.equal(first.extent, 25.2);
  assert.deepEqual(
    first.perSpecies.map((placements) => placements.length),
    [100, 100, 100, 100],
  );

  for (const placements of first.perSpecies) {
    for (const placement of placements) {
      const [x, y, z] = placement.position;
      assert.equal(y, groundAt(x, z));
      assert.ok(placement.scale >= 0.85 && placement.scale <= 1.15);
      assert.ok(placement.rotationY >= 0 && placement.rotationY < Math.PI * 2);
    }
  }

  assert.notDeepEqual(
    first,
    createFieldLayout({ groundAt, seed: FIELD_LAYOUT_SEED + 1 }),
  );
});

test('mixed scatter rejects invalid allocation and terrain data', () => {
  assert.throws(() => createFieldLayout(), /terrain height function/);
  assert.throws(
    () => createFieldLayout({ count: 0, groundAt: () => 0 }),
    /positive finite number/,
  );
  assert.throws(
    () => createFieldLayout({ speciesCount: 0, groundAt: () => 0 }),
    /positive integer/,
  );
  assert.throws(
    () => createFieldLayout({ groundAt: () => Number.NaN }),
    /not finite/,
  );
});

test('mixed field statistics aggregate every species field', () => {
  const stats = (overrides) => ({
    plants: 100,
    prototypes: 3,
    drawCalls: 3,
    organDrawCalls: 2,
    woodDrawCalls: 1,
    organInstances: 1000,
    budget: 400000,
    overBudget: false,
    levelCounts: [20, 30, 50],
    visiblePlants: 70,
    repacks: 1,
    instanceWrites: 1000,
    slots: 1100,
    unusedSlots: 100,
    slotsByKind: { leaves: 900, stems: 200 },
    ...overrides,
  });
  const fields = [
    { field: { stats: () => stats({}) } },
    {
      field: {
        stats: () =>
          stats({
            drawCalls: 4,
            overBudget: true,
            levelCounts: [10, 40, 50],
            slotsByKind: { leaves: 700, panicles: 400 },
          }),
      },
    },
  ];
  const culling = { visible: 140, pending: 2, ms: 0.25 };

  assert.deepEqual(aggregateFieldStats(fields, culling), {
    plants: 200,
    prototypes: 6,
    drawCalls: 7,
    organDrawCalls: 4,
    woodDrawCalls: 2,
    organInstances: 2000,
    budget: 800000,
    overBudget: true,
    levelCounts: [30, 70, 100],
    visiblePlants: 140,
    repacks: 2,
    instanceWrites: 2000,
    slots: 2200,
    unusedSlots: 200,
    slotsByKind: { leaves: 1600, stems: 200, panicles: 400 },
    culling,
  });
});
