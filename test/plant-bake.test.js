import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import { isSharedResource } from '../src/lib/shared-resources.js';

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const COARSE = Object.freeze({
  sectionStride: 4,
  segmentFactor: 0.5,
  leafStride: 4,
  leafScale: 1.5,
});

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ seed: 'bake', ageYears: 5, dayOfYear: 200, ...options });
}

function hash(view) {
  if (!view?.length) return null;
  return createHash('sha256')
    .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength))
    .digest('hex');
}

/** Everything about the live plant that a bake must not disturb. */
function capture(plant) {
  const meshes = [];
  plant.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push({
      name: object.name,
      visible: object.visible,
      count: object.isInstancedMesh ? object.count : null,
      castShadow: object.castShadow,
      index: hash(object.geometry.index?.array),
      position: hash(object.geometry.attributes.position?.array),
      matrices: object.isInstancedMesh
        ? hash(object.instanceMatrix.array.slice(0, object.count * 16))
        : null,
    });
  });
  return meshes.sort((a, b) => a.name.localeCompare(b.name));
}

function bakedTriangles(baked) {
  const wood = baked.wood
    ? (baked.wood.geometry.index?.count ??
        baked.wood.geometry.attributes.position.count) / 3
    : 0;
  const organs = baked.organs.reduce((total, organ) => {
    const vertices =
      organ.geometry.index?.count ?? organ.geometry.attributes.position.count;
    return total + (vertices / 3) * organ.count;
  }, 0);
  return wood + organs;
}

test('a bake is plain three, with nothing from an instancing library in it', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const baked = plant.bake();

      assert.equal(baked.plantId, plant._plantId);
      assert.equal(baked.ageYears, plant.ageYears);
      assert.equal(baked.dayOfYear, plant.dayOfYear);
      assert.ok(baked.bounds instanceof THREE.Box3);
      assert.ok(baked.organs.length > 0, `${name} baked no organs`);

      if (baked.wood) {
        assert.ok(baked.wood.geometry.isBufferGeometry);
        assert.ok(baked.wood.material.isMaterial);
      }

      for (const organ of baked.organs) {
        assert.ok(organ.geometry.isBufferGeometry, organ.name);
        assert.ok(organ.material.isMaterial, organ.name);
        for (const shadowMaterial of [
          organ.customDepthMaterial,
          organ.customDistanceMaterial,
        ]) {
          assert.ok(
            shadowMaterial == null || shadowMaterial.isMaterial,
            `${organ.name} has an invalid shadow material`,
          );
        }
        assert.ok(organ.matrices instanceof Float32Array, organ.name);
        assert.equal(organ.matrices.length, organ.count * 16, organ.name);
        assert.ok(organ.count > 0, organ.name);
        assert.ok(typeof organ.kind === 'string' && organ.kind.length > 0);
        if (organ.colors) {
          assert.ok(organ.colors instanceof Float32Array);
          assert.equal(organ.colors.length, organ.count * 3);
        }
        // The bake must not hand out a live instanced mesh.
        assert.equal(organ.geometry.isInstancedMesh, undefined);
      }

      baked.dispose();
    } finally {
      plant.dispose();
    }
  }
});

test('baking at another detail leaves the plant exactly as it was found', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const before = capture(plant);
      const baked = plant.bake(COARSE);
      assert.deepEqual(
        capture(plant),
        before,
        `${name}: bake(detail) disturbed the live plant`,
      );

      // And it really did bake something coarser, so the restore above is not
      // passing because nothing happened.
      const full = plant.bake();
      assert.ok(
        bakedTriangles(baked) < bakedTriangles(full),
        `${name}: coarse bake was not cheaper (${bakedTriangles(baked)} vs ${bakedTriangles(full)})`,
      );

      baked.dispose();
      full.dispose();
      assert.deepEqual(capture(plant), before);
    } finally {
      plant.dispose();
    }
  }
});

test('the baked bounds contain every instance', async () => {
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const baked = plant.bake();
      // A tolerance for float round-trips through the matrix buffer, not for
      // sloppiness: an instance outside by more than this is a real miss.
      const generous = baked.bounds.clone().expandByScalar(1e-4);

      for (const organ of baked.organs) {
        if (!organ.geometry.boundingBox) organ.geometry.computeBoundingBox();
        const box = organ.geometry.boundingBox;
        for (let index = 0; index < organ.count; index += 1) {
          matrix.fromArray(organ.matrices, index * 16);
          for (const corner of [box.min, box.max]) {
            point.copy(corner).applyMatrix4(matrix);
            assert.ok(
              generous.containsPoint(point),
              `${name}: ${organ.name}[${index}] falls outside the baked bounds`,
            );
          }
        }
      }

      assert.ok(baked.bounds.max.y > baked.bounds.min.y, `${name} is flat`);
      baked.dispose();
    } finally {
      plant.dispose();
    }
  }
});

test('a bake owns its wood copy and nothing else', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name);
    try {
      const baked = plant.bake();
      const disposals = new Map();
      const watch = (resource) => {
        if (disposals.has(resource)) return;
        disposals.set(resource, 0);
        resource.addEventListener('dispose', () =>
          disposals.set(resource, disposals.get(resource) + 1),
        );
      };

      for (const organ of baked.organs) {
        watch(organ.geometry);
        watch(organ.material);
        if (organ.customDepthMaterial) watch(organ.customDepthMaterial);
        if (organ.customDistanceMaterial) watch(organ.customDistanceMaterial);
      }
      if (baked.wood) {
        watch(baked.wood.material);
        // The wood copy is the bake's own: it must not be the live geometry,
        // which the plant remeshes whenever the skeleton moves.
        assert.notStrictEqual(baked.wood.geometry, plant._woodMesh.geometry);
        assert.equal(isSharedResource(baked.wood.geometry), false);
      }

      baked.dispose();
      baked.dispose(); // idempotent

      for (const [resource, count] of disposals) {
        assert.equal(
          count,
          0,
          `${name}: bake disposed ${resource.name || resource.type}, which it does not own`,
        );
      }
      assert.ok(plant.stats().drawCalls > 0, `${name} still renders`);
    } finally {
      plant.dispose();
    }
  }
});

test('the same state bakes to the same buffers, which is what makes a prototype', async () => {
  for (const name of PLANTS) {
    const first = await createPlant(name, { seed: 'proto' });
    const second = await createPlant(name, { seed: 'proto' });
    try {
      const a = first.bake();
      const b = second.bake();

      assert.equal(a.organs.length, b.organs.length);
      for (const [index, organ] of a.organs.entries()) {
        const other = b.organs[index];
        assert.equal(organ.kind, other.kind);
        assert.equal(organ.count, other.count);
        assert.equal(hash(organ.matrices), hash(other.matrices), organ.name);
        assert.equal(hash(organ.colors), hash(other.colors), organ.name);
      }
      if (a.wood) {
        assert.equal(
          hash(a.wood.geometry.attributes.position.array),
          hash(b.wood.geometry.attributes.position.array),
        );
      }

      a.dispose();
      b.dispose();
    } finally {
      first.dispose();
      second.dispose();
    }
  }
});

test('a different seed bakes to different wood, which is why wood is per-plant', async () => {
  for (const name of PLANTS) {
    const first = await createPlant(name, { seed: 'one' });
    const second = await createPlant(name, { seed: 'two' });
    try {
      const a = first.bake();
      const b = second.bake();
      if (a.wood && b.wood) {
        assert.notEqual(
          hash(a.wood.geometry.attributes.position.array),
          hash(b.wood.geometry.attributes.position.array),
          `${name}: two seeds produced identical wood`,
        );
      }
      a.dispose();
      b.dispose();
    } finally {
      first.dispose();
      second.dispose();
    }
  }
});
