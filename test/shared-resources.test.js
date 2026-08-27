import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import {
  disposeSharedResources,
  isSharedResource,
  sharedResource,
  sharedResourceStats,
  stableKey,
} from '../src/lib/shared-resources.js';

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

function meshes(plant) {
  const found = [];
  plant.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

const woodMesh = (plant) =>
  meshes(plant).find(
    (mesh) => mesh.userData.kind === 'woody-architecture-batch',
  );

/* -------------------------------------------------------------------- *
 * Keys
 * -------------------------------------------------------------------- */

test('a key describes the options, not the order they were written in', () => {
  assert.equal(stableKey({ a: 1, b: 2 }), stableKey({ b: 2, a: 1 }));
  assert.notEqual(stableKey({ a: 1 }), stableKey({ a: 2 }));
  assert.notEqual(stableKey({ a: 1 }), stableKey({ a: '1' }));
  // An absent option and an explicitly undefined one are the same request.
  assert.equal(stableKey({ a: 1, b: undefined }), stableKey({ a: 1 }));
  assert.equal(stableKey([1, [2, 3]]), stableKey([1, [2, 3]]));
});

test('resources are keyed by identity, values by shape', () => {
  const one = new THREE.Texture();
  const two = new THREE.Texture();

  // Two textures configured identically are still two textures, so a material
  // built around one must never be handed out for the other.
  assert.notEqual(stableKey({ map: one }), stableKey({ map: two }));
  assert.equal(stableKey({ map: one }), stableKey({ map: one }));

  // Vectors and colours are values and compare by content.
  assert.equal(
    stableKey(new THREE.Vector2(1, 2)),
    stableKey(new THREE.Vector2(1, 2)),
  );
});

/* -------------------------------------------------------------------- *
 * The collision guard
 * -------------------------------------------------------------------- */

test('one id may not be claimed by two factories', () => {
  const first = () => new THREE.BufferGeometry();
  const second = () => new THREE.BufferGeometry();

  sharedResource('test-collision', 'a/thing', {}, first);
  assert.throws(
    () => sharedResource('test-collision', 'a/thing', {}, second),
    /claimed by two different factories/,
  );

  // Different options are a different resource, not a collision.
  assert.doesNotThrow(() =>
    sharedResource('test-collision', 'a/thing', { size: 2 }, first),
  );
  disposeSharedResources('test-collision');
});

test('an un-namespaced id is refused, because that is how ids collide', () => {
  assert.throws(
    () => sharedResource('test-ids', 'thing', {}, () => ({})),
    /must be namespaced/,
  );
});

/* -------------------------------------------------------------------- *
 * What plants actually share
 * -------------------------------------------------------------------- */

test('two plants of one species share every seed-independent resource', async () => {
  for (const name of PLANTS) {
    const first = await createPlant(name, { seed: 'a' });
    const second = await createPlant(name, { seed: 'b' });
    try {
      const geometriesOf = (plant) =>
        new Set(meshes(plant).map((mesh) => mesh.geometry));
      const firstGeometries = geometriesOf(first);
      const secondGeometries = geometriesOf(second);

      const shared = [...firstGeometries].filter((geometry) =>
        secondGeometries.has(geometry),
      );
      const unshared = [...firstGeometries].filter(
        (geometry) => !secondGeometries.has(geometry),
      );

      assert.ok(
        shared.length > 0,
        `${name} shares no geometry between two plants`,
      );
      for (const geometry of shared) assert.ok(isSharedResource(geometry));

      // Wood is the one thing that must not be shared: it is remeshed as the
      // skeleton grows, and it differs by seed, age and day.
      const wood = woodMesh(first);
      if (wood) {
        assert.ok(
          unshared.includes(wood.geometry),
          `${name} wood geometry must stay per-plant`,
        );
        assert.equal(isSharedResource(wood.geometry), false);
      }
    } finally {
      first.dispose();
      second.dispose();
    }
  }
});

test('bark is shared and foliage is not, because foliage is repainted', async () => {
  for (const name of PLANTS) {
    const first = await createPlant(name, { seed: 'a' });
    const second = await createPlant(name, { seed: 'b' });
    try {
      const wood = woodMesh(first);
      if (wood?.visible) {
        assert.strictEqual(
          wood.material,
          woodMesh(second).material,
          `${name} must reuse one bark material`,
        );
        assert.ok(isSharedResource(wood.material));
      }

      // The load-bearing half of this rule. A plant rewrites its leaf colour
      // every time the day changes, so two plants sharing one material would
      // drag each other through the seasons. Nothing here may be "optimised"
      // into the cache without making that mutation stop first.
      for (const mesh of meshes(first)) {
        for (const material of [mesh.material].flat()) {
          if (material === wood?.material) continue;
          assert.equal(
            isSharedResource(material),
            false,
            `${name}: ${material.name || material.type} is mutable per plant`,
          );
        }
      }
    } finally {
      first.dispose();
      second.dispose();
    }
  }
});

test('a plant repainted by the calendar leaves its neighbours alone', async () => {
  for (const name of PLANTS) {
    const spring = await createPlant(name, { seed: 'a', dayOfYear: 140 });
    const autumn = await createPlant(name, { seed: 'a', dayOfYear: 140 });
    try {
      const colours = (plant) =>
        meshes(plant)
          .flatMap((mesh) => [mesh.material].flat())
          .map((material) => material.color.getHex());

      const before = colours(spring);
      autumn.setTime({ dayOfYear: 290 });
      assert.deepEqual(
        colours(spring),
        before,
        `${name}: one plant's season changed another's colours`,
      );
    } finally {
      spring.dispose();
      autumn.dispose();
    }
  }
});

test('disposing one plant leaves its neighbour renderable', async () => {
  for (const name of PLANTS) {
    const doomed = await createPlant(name, { seed: 'a' });
    const survivor = await createPlant(name, { seed: 'b' });
    try {
      const watched = new Map();
      for (const mesh of meshes(survivor)) {
        for (const resource of [mesh.geometry, ...[mesh.material].flat()]) {
          if (!watched.has(resource)) {
            watched.set(resource, 0);
            resource.addEventListener('dispose', () => {
              watched.set(resource, watched.get(resource) + 1);
            });
          }
        }
      }

      doomed.dispose();

      for (const [resource, count] of watched) {
        assert.equal(
          count,
          0,
          `${name}: disposing one plant disposed ${resource.name || resource.type}`,
        );
      }
      // And it is still describable, which is what "renderable" means here.
      assert.ok(survivor.stats().drawCalls > 0);
    } finally {
      survivor.dispose();
    }
  }
});

/* -------------------------------------------------------------------- *
 * Teardown
 * -------------------------------------------------------------------- */

test('the cache reports what it holds and can be torn down wholesale', () => {
  let built = 0;
  const factory = () => {
    built += 1;
    return new THREE.BufferGeometry();
  };

  const one = sharedResource('test-teardown', 'x/thing', {}, factory);
  const two = sharedResource('test-teardown', 'x/thing', {}, factory);
  assert.strictEqual(one, two);
  assert.equal(built, 1, 'a repeat request must not rebuild');
  assert.equal(sharedResourceStats()['test-teardown'], 1);

  let disposed = 0;
  one.addEventListener('dispose', () => (disposed += 1));

  disposeSharedResources('test-teardown');
  assert.equal(disposed, 1);
  assert.equal(sharedResourceStats()['test-teardown'], undefined);

  // After teardown the namespace starts empty rather than handing back a
  // disposed resource.
  const rebuilt = sharedResource('test-teardown', 'x/thing', {}, factory);
  assert.notStrictEqual(rebuilt, one);
  assert.equal(built, 2);
  disposeSharedResources('test-teardown');
});
