import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { createGPUDrivenGrass } from '../src/app/grass-webgpu/grass.js';
import { GRASS_RINGS } from '../src/app/grass-webgpu/grid.js';
import { createWebGPUHeightTexture } from '../src/app/grass-webgpu/terrain.js';

const { Fn, mix, vec3 } = THREE.TSL;

// The lawn only touches the renderer in update() and sampleVisibleCounts(), so
// building and disposing one needs no device -- just the attribute bookkeeping
// dispose() reaches into.
function buildLawn() {
  const released = [];
  const renderer = {
    _attributes: { delete: (attribute) => released.push(attribute) },
  };
  const surface = {
    macroAt: Fn(([worldXZ]) => worldXZ.x.mul(0).add(0.5)),
    tintFrom: Fn(([macro]) => vec3(macro, macro, macro)),
    densityFrom: Fn(([macro]) => mix(0.78, 1, macro)),
  };
  const grass = createGPUDrivenGrass({
    renderer,
    heightMap: createWebGPUHeightTexture({ amplitude: 0, resolution: 8 }),
    surface,
    shadows: false,
  });
  return { grass, released };
}

test('disposing the lawn frees every storage buffer it allocated', () => {
  const { grass, released } = buildLawn();

  assert.deepEqual(released, []);
  grass.dispose();

  assert.deepEqual(
    released.map((attribute) => attribute.name),
    [
      'Grass indirect draw commands',
      ...GRASS_RINGS.flatMap((ring) => [
        `Grass ${ring.id} records`,
        `Grass ${ring.id} visible IDs`,
      ]),
    ],
  );
  assert.equal(new Set(released).size, released.length);
});

test('no other owner would free those buffers', () => {
  const { grass, released } = buildLawn();
  const geometries = grass.group.children.map((mesh) => mesh.geometry);

  grass.dispose();

  // The regression this guards: `BufferAttribute.dispose()` only dispatches an
  // event, and in the WebGPU path the sole listener is the one `Geometries`
  // registers for a geometry's own attributes. None of these is one -- the
  // records and visible IDs are bound as storage nodes, and the draw commands
  // arrive through setIndirect(), which that listener also skips -- so leaving
  // them to `dispose()` leaks their GPU buffers.
  for (const geometry of geometries) {
    const owned = [...Object.values(geometry.attributes), geometry.index];
    for (const attribute of released) {
      assert.equal(owned.includes(attribute), false);
    }
    assert.equal(geometry.indirect, released[0]);
  }
});
