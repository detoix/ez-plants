import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { terrainHeightAt } from '../src/app/field-terrain-height.js';
import { createWebGPUHeightTexture } from '../src/app/grass-webgpu/terrain.js';

test('the WebGPU height map is filterable core R16 float data', () => {
  const extent = 10;
  const resolution = 7;
  const amplitude = 1.15;
  const heightMap = createWebGPUHeightTexture({
    extent,
    resolution,
    amplitude,
  });
  const { texture } = heightMap;

  assert.equal(texture.format, THREE.RedFormat);
  assert.equal(texture.type, THREE.HalfFloatType);
  assert.equal(texture.minFilter, THREE.LinearFilter);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.image.data.length, resolution * resolution);

  const step = (extent * 2) / (resolution - 1);
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const expected = terrainHeightAt(
        -extent + column * step,
        -extent + row * step,
        { amplitude },
      );
      const actual = THREE.DataUtils.fromHalfFloat(
        texture.image.data[row * resolution + column],
      );
      assert.ok(
        Math.abs(actual - expected) < 0.001,
        `height error at ${column},${row}: ${actual} versus ${expected}`,
      );
    }
  }

  texture.dispose();
});
