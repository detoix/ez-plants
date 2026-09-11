import assert from 'node:assert/strict';
import test from 'node:test';

import { describeWebGPUSupport } from '../src/app/grass-webgpu/capability.js';
import {
  GRASS_RINGS,
  TOTAL_GRASS_CANDIDATES,
  createRingState,
  ringDistance,
  ringForDistance,
  snapRingState,
  targetDensityAt,
  worldCellForSlot,
  worldCellRandom,
  bladeTriangleCount,
  bladeVertexCount,
  grassTriangleCount,
} from '../src/app/grass-webgpu/grid.js';
import { LAWN } from '../src/app/grass-webgpu/preset.js';

test('the three persistent grids have fixed capacities', () => {
  assert.deepEqual(
    GRASS_RINGS.map(({ id, side, capacity, segments }) => ({
      id,
      side,
      capacity,
      segments,
    })),
    [
      { id: 'near', side: 642, capacity: 412_164, segments: 3 },
      { id: 'mid', side: 642, capacity: 412_164, segments: 2 },
      { id: 'far', side: 522, capacity: 272_484, segments: 1 },
    ],
  );
  assert.equal(TOTAL_GRASS_CANDIDATES, 1_096_812);
});

test('snapping mutates one control object only at cell boundaries', () => {
  const ring = GRASS_RINGS[0];
  const state = createRingState(ring);
  const identity = state;

  assert.equal(snapRingState(state, 0.001, -0.001), true);
  const origin = [state.originCellX, state.originCellZ];
  assert.equal(snapRingState(state, 0.024, -0.024), false);
  assert.deepEqual([state.originCellX, state.originCellZ], origin);

  assert.equal(snapRingState(state, 0.025, -0.024), true);
  assert.strictEqual(state, identity);
  assert.equal(state.originCellX, origin[0] + 1);
  assert.equal(state.originCellZ, origin[1]);
});

test('returning to a camera cell restores exactly the same world cells', () => {
  const state = createRingState(GRASS_RINGS[1]);
  snapRingState(state, 3.4, -9.2);
  const first = worldCellForSlot(state, 93_217, {});
  const remembered = { ...first };

  snapRingState(state, 31.7, 18.6);
  assert.notDeepEqual(worldCellForSlot(state, 93_217, {}), remembered);

  snapRingState(state, 3.4, -9.2);
  assert.deepEqual(worldCellForSlot(state, 93_217, {}), remembered);
});

test('world-cell randomness is deterministic and camera-history independent', () => {
  const a = worldCellRandom(-10, 4, 97);
  assert.equal(a, worldCellRandom(-10, 4, 97));
  assert.equal(a, 0.272232158575207);
  assert.notEqual(a, worldCellRandom(-9, 4, 97));
  assert.notEqual(a, worldCellRandom(-10, 4, 98));
});

test('every covered distance belongs to exactly one concentric ring', () => {
  assert.equal(ringDistance(3, 4), 5);
  for (let distance = 0; distance < 52; distance += 0.125) {
    const owners = GRASS_RINGS.filter(
      (ring) => distance >= ring.inner && distance < ring.outer,
    );
    assert.equal(owners.length, 1, `distance ${distance}`);
    assert.strictEqual(ringForDistance(distance), owners[0]);
  }
  assert.equal(ringForDistance(52), null);
  assert.equal(ringForDistance(-1), null);
});

test('target lawn density falls continuously with camera distance', () => {
  let previous = Infinity;
  for (let distance = 0; distance < 52; distance += 0.05) {
    const ring = ringForDistance(distance);
    const density = targetDensityAt(ring, distance);
    assert.ok(
      density <= previous + 1e-9,
      `${density} exceeded ${previous} at ${distance}`,
    );
    previous = density;
  }
  assert.equal(GRASS_RINGS[0].densityFar, GRASS_RINGS[1].densityNear);
  assert.equal(GRASS_RINGS[1].densityFar, GRASS_RINGS[2].densityNear);
  assert.equal(targetDensityAt(GRASS_RINGS[2], GRASS_RINGS[2].outer), 0);
});

test('capability gate explains HTTPS and WebGPU failures separately', () => {
  assert.deepEqual(
    describeWebGPUSupport({ secureContext: false, gpu: undefined }),
    {
      supported: false,
      code: 'insecure-context',
      message:
        'WebGPU requires HTTPS. Open this page through an HTTPS URL (or localhost), then reload it.',
    },
  );
  assert.equal(
    describeWebGPUSupport({ secureContext: true, gpu: undefined }).code,
    'webgpu-unavailable',
  );
  assert.equal(
    describeWebGPUSupport({ secureContext: true, gpu: {} }).supported,
    true,
  );
});

test('a blade is counted as the triangles it actually submits', () => {
  // The tip segment closes to a point, so it is one triangle and not a quad:
  // `bladeVertexCount` drops the second, whose two upper vertices would
  // coincide. The two counts have to agree about that, because one builds the
  // indirect draw command and the other is what the HUD reports.
  for (const segments of [1, 2, 3, 8]) {
    assert.equal(bladeVertexCount(segments), bladeTriangleCount(segments) * 3);
  }
  assert.deepEqual(
    GRASS_RINGS.map((ring) => bladeTriangleCount(ring.segments)),
    [5, 3, 1],
  );
});

test('the reported triangle count is per tiller, not per crown', () => {
  // The regression. The HUD used to compute `visible * segments * 2`: it
  // counted the dropped tip quad and it counted one blade where a crown grows
  // `LAWN.tillers`. A near crown reported 6 triangles against the 15 it
  // submits, so every density experiment was judged on a lawn that looked
  // 2.5x cheaper than it is.
  const visible = [1, 1, 1];
  const wrong = GRASS_RINGS.reduce(
    (sum, ring) => sum + visible[ring.index] * ring.segments * 2,
    0,
  );
  assert.equal(wrong, 12);
  assert.equal(grassTriangleCount(visible, 1), 9);
  assert.equal(grassTriangleCount(visible, 3), 27);

  // One crown of each ring, at whatever tillering is shipped: 5 / 3 / 1
  // triangles a blade, times the blades a crown grows. Written against
  // `LAWN.tillers` rather than a literal because the tiller count is a dial
  // now -- pinning the literal here would make raising it look like a
  // regression in the one test that exists to describe it.
  assert.equal(grassTriangleCount([1, 0, 0], LAWN.tillers), 5 * LAWN.tillers);
  assert.equal(grassTriangleCount([0, 1, 0], LAWN.tillers), 3 * LAWN.tillers);
  assert.equal(grassTriangleCount([0, 0, 1], LAWN.tillers), 1 * LAWN.tillers);

  assert.equal(grassTriangleCount([0, 0, 0], LAWN.tillers), 0);
  assert.equal(grassTriangleCount(new Uint32Array(3), LAWN.tillers), 0);
});
