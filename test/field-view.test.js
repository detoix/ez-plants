import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { FieldViewDriver } from '../src/app/field-view.js';

test('whole-plant culling uses the WebGPU near-plane convention', () => {
  let visibility = null;
  const field = {
    placementSphere() {
      return new THREE.Sphere(new THREE.Vector3(0, 0, -0.05), 0.001);
    },
    setVisibility(flags) {
      visibility = Array.from(flags, Boolean);
    },
    setLevelAt() {},
  };
  const driver = new FieldViewDriver([
    {
      field,
      levels: [{ distance: 0, hysteresis: 0 }],
      chosen: [0],
    },
  ]);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.updateProjectionMatrix();

  const stats = driver.update(camera);

  assert.equal(stats.visible, 0);
  assert.deepEqual(visibility, [false]);
});
