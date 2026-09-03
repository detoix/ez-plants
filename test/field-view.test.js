import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { FieldViewDriver } from '../src/app/field-view.js';

test('on-screen tests use the WebGPU near-plane convention, and hide nothing', () => {
  // The driver still decides which plants are on screen, but only to spend its
  // level-change budget on plants somebody can see. Hiding them is the
  // renderer's job, per instance, in a compute pass.
  let hidden = 0;
  const field = {
    placementSphere() {
      return new THREE.Sphere(new THREE.Vector3(0, 0, -0.05), 0.001);
    },
    setVisibility() {
      hidden += 1;
    },
    setVisibleAt() {
      hidden += 1;
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
  assert.equal(hidden, 0, 'the driver must not hide placements itself');
});
