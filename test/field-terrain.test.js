import assert from 'node:assert/strict';
import test from 'node:test';

import { terrainHeightAt } from '../src/app/field-terrain-height.js';
import { createWebGPUTerrainGeometry } from '../src/app/grass-webgpu/terrain.js';

test('the field height is deterministic and bounded by its amplitude', () => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let x = -70; x <= 70; x += 1.7) {
    for (let z = -70; z <= 70; z += 1.7) {
      const height = terrainHeightAt(x, z, { amplitude: 1.15 });
      assert.equal(height, terrainHeightAt(x, z, { amplitude: 1.15 }));
      lowest = Math.min(lowest, height);
      highest = Math.max(highest, height);
    }
  }
  assert.ok(highest <= 1.15 * 1.21, `highest ${highest}`);
  assert.ok(lowest >= -1.15 * 1.21, `lowest ${lowest}`);
  assert.ok(highest - lowest > 1, `range ${highest - lowest}`);
});

test('the ground is flat where the backdrop takes over', () => {
  for (const [x, z] of [
    [130, 0],
    [0, -121],
    [400, 400],
  ]) {
    assert.equal(terrainHeightAt(x, z), 0);
  }
});

test('zero amplitude restores the flat field exactly', () => {
  for (const [x, z] of [
    [0, 0],
    [9, -14],
    [-52, 3],
  ]) {
    assert.equal(terrainHeightAt(x, z, { amplitude: 0 }), 0);
  }
});

test('the WebGPU terrain mesh sits on the shared height function', () => {
  const geometry = createWebGPUTerrainGeometry({
    amplitude: 1.15,
    size: 60,
    segments: 24,
  });
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    assert.ok(
      Math.abs(
        position.getY(index) - terrainHeightAt(x, z, { amplitude: 1.15 }),
      ) < 1e-6,
      `vertex ${index} is off the ground`,
    );
    assert.ok(normal.getY(index) > 0.5, `normal ${index} tipped sideways`);
  }
  geometry.dispose();
});
