import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { createPlantPrototype } from '../src/lib/field/plant-prototype.js';
import { createLeafMaterialSet } from '../src/lib/leaf-material.js';
import { LeafWind } from '../src/lib/leaf-wind.js';

test('prototype bounds conservatively include configured wind displacement', () => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0.5, 0.5, 0);
  const wind = new LeafWind({ strength: new THREE.Vector3(2, 0, 0) });
  const materials = createLeafMaterialSet({ wind });
  const transform = new THREE.Matrix4().makeScale(3, 2, 1);
  const sourceBounds = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(3, 2, 0),
  );
  const plant = {
    name: 'Wind-bound fixture',
    lodLevels: [{ distance: 0 }],
    bake() {
      return {
        wood: null,
        organs: [
          {
            kind: 'leaves',
            geometry,
            material: materials.surface,
            count: 1,
            matrices: Float32Array.from(transform.elements),
            colors: null,
          },
        ],
        bounds: sourceBounds.clone(),
        dispose() {},
      };
    },
  };

  const prototype = createPlantPrototype(plant);
  try {
    assert.deepEqual(prototype.bounds.min.toArray(), [-6, -6, -6]);
    assert.deepEqual(prototype.bounds.max.toArray(), [9, 8, 6]);
  } finally {
    prototype.dispose();
    geometry.dispose();
    materials.surface.dispose();
    materials.depth.dispose();
    materials.distance.dispose();
  }
});
