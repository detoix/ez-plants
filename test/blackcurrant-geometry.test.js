import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBerryGeometry,
  createBudGeometry,
} from '../src/lib/plants/blackcurrant/geometry.js';

/**
 * The bud's frame is a contract, not a detail.
 *
 * `buds` and `flowerBuds` were instanced from `createBerryGeometry` -- a
 * 10x7 sphere at 120 triangles, borrowed for its shape and not even for its
 * colour, since both bud materials are flat. Their placements were written
 * against that sphere's frame and were never rewritten, so the spindle that
 * replaced it has to occupy the same box: origin-centred, one unit tall, half
 * a unit across. A bud authored anywhere else lands somewhere else, at a size
 * nobody asked for, and no other test in the suite would say so.
 */
function bounds(geometry) {
  const position = geometry.getAttribute('position');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = position.array[i * 3 + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function triangleCount(geometry) {
  return (geometry.index ?? geometry.getAttribute('position')).count / 3;
}

test('a bud occupies the frame its placements were written against', () => {
  const bud = createBudGeometry();
  const berry = createBerryGeometry();
  const budBox = bounds(bud);
  const berryBox = bounds(berry);

  // Same height and the same centring as the sphere it replaced. The berry
  // wobbles, so it is held to its nominal frame rather than to the bud's.
  assert.ok(Math.abs(budBox.min[1] - -0.5) < 1e-6, 'bud base sits at -0.5');
  assert.ok(Math.abs(budBox.max[1] - 0.5) < 1e-6, 'bud tip sits at +0.5');
  for (const axis of [0, 2]) {
    assert.ok(budBox.max[axis] <= 0.5 + 1e-6, 'bud stays inside the sphere');
    assert.ok(budBox.min[axis] >= -0.5 - 1e-6, 'bud stays inside the sphere');
    assert.ok(
      Math.abs(budBox.max[axis] + budBox.min[axis]) < 1e-6,
      'bud is centred on the axis it is placed by',
    );
    assert.ok(Math.abs(berryBox.max[axis]) < 0.53, 'berry frame is unchanged');
  }

  bud.dispose();
  berry.dispose();
});

test('a bud is a fraction of the sphere it replaced, and still a solid', () => {
  const bud = createBudGeometry();
  const berry = createBerryGeometry();

  assert.equal(triangleCount(bud), 24);
  assert.equal(triangleCount(berry), 120);

  // It narrows to a point rather than being a rugby ball: the widest ring sits
  // below the middle, which is the profile of a currant bud.
  const position = bud.getAttribute('position');
  let widestY = null;
  let widestRadius = -1;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.array[i * 3];
    const y = position.array[i * 3 + 1];
    const z = position.array[i * 3 + 2];
    const radius = Math.hypot(x, z);
    if (radius > widestRadius) {
      widestRadius = radius;
      widestY = y;
    }
  }
  assert.ok(widestY < 0, `widest ring is below the middle, got ${widestY}`);

  bud.dispose();
  berry.dispose();
});

test('bud geometry is finite, indexed, bounded and deterministic', () => {
  const first = createBudGeometry();
  const second = createBudGeometry();

  assert.ok(first.index, 'indexed');
  assert.ok(first.boundingSphere, 'bounded');
  for (const name of ['position', 'normal']) {
    const attribute = first.getAttribute(name);
    assert.ok(attribute, `has ${name}`);
    for (const value of attribute.array) {
      assert.ok(Number.isFinite(value), `${name} is finite`);
    }
  }
  assert.deepEqual(
    Array.from(second.getAttribute('position').array),
    Array.from(first.getAttribute('position').array),
    'byte deterministic',
  );

  first.dispose();
  second.dispose();
});

test('bud geometry rejects topology it cannot build', () => {
  assert.throws(() => createBudGeometry({ segments: 2 }), /segments/);
  assert.throws(() => createBudGeometry({ segments: 5.5 }), /segments/);
  assert.throws(() => createBudGeometry({ rings: 1 }), /rings/);
  assert.throws(() => createBudGeometry({ rings: 2.5 }), /rings/);
});
