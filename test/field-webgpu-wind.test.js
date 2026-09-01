import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';
import { normalViewGeometry } from 'three/tsl';

import {
  keepAuthoredNormalsOnBackFaces,
  createLeafMaterialSet,
} from '../src/lib/leaf-material.js';
import { LeafWind } from '../src/lib/leaf-wind.js';
import {
  prepareWebGPUPlantMaterial,
  PlantField,
} from '../src/lib/field/index.webgpu.js';

test('the WebGPU material boundary ports wind and authored card normals to TSL', () => {
  const wind = new LeafWind({ time: 2.5 });
  const materials = createLeafMaterialSet({ wind, roundedNormals: true });
  const prepared = prepareWebGPUPlantMaterial(materials.surface);

  try {
    assert.notStrictEqual(prepared, materials.surface);
    assert.notEqual(
      materials.surface.onBeforeCompile,
      THREE.Material.prototype.onBeforeCompile,
    );
    assert.equal(
      prepared.onBeforeCompile,
      THREE.Material.prototype.onBeforeCompile,
    );
    assert.strictEqual(prepared.normalNode, normalViewGeometry);
  } finally {
    prepared.dispose();
    materials.surface.dispose();
    materials.depth.dispose();
    materials.distance.dispose();
  }
});

test('the WebGPU material boundary keeps ordinary blade back-face shading', () => {
  const wind = new LeafWind();
  const materials = createLeafMaterialSet({ wind, roundedNormals: false });
  const prepared = prepareWebGPUPlantMaterial(materials.surface);

  try {
    assert.equal(prepared.normalNode, undefined);
  } finally {
    prepared.dispose();
    materials.surface.dispose();
    materials.depth.dispose();
    materials.distance.dispose();
  }
});

test('the WebGPU material boundary keeps rounded normals when wind is off', () => {
  const wind = new LeafWind({ enabled: false });
  const materials = createLeafMaterialSet({ wind, roundedNormals: true });
  const prepared = prepareWebGPUPlantMaterial(materials.surface);

  try {
    assert.equal(prepared.positionNode, undefined);
    assert.strictEqual(prepared.normalNode, normalViewGeometry);
  } finally {
    prepared.dispose();
    materials.surface.dispose();
    materials.depth.dispose();
    materials.distance.dispose();
  }
});

test('the WebGPU material boundary ports the standalone authored-normal hook', () => {
  const source = keepAuthoredNormalsOnBackFaces(
    new THREE.MeshStandardMaterial({ name: 'Floret cards' }),
  );
  const prepared = prepareWebGPUPlantMaterial(source);
  try {
    assert.strictEqual(prepared.normalNode, normalViewGeometry);
    assert.equal(
      prepared.onBeforeCompile,
      THREE.Material.prototype.onBeforeCompile,
    );
  } finally {
    prepared.dispose();
    source.dispose();
  }
});

test('unknown GLSL hooks are still rejected instead of silently disappearing', () => {
  const source = new THREE.MeshStandardMaterial({ name: 'Unknown hook' });
  source.onBeforeCompile = () => {};
  try {
    assert.throws(
      () => prepareWebGPUPlantMaterial(source),
      /unsupported GLSL onBeforeCompile customization/,
    );
  } finally {
    source.dispose();
  }
});

test('WebGPU PlantField adapts source wind without mutating plant materials', () => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const wind = new LeafWind();
  const materials = createLeafMaterialSet({ wind });
  const identity = new THREE.Matrix4();
  const prototype = {
    plant: { update: (delta, elapsed) => wind.advance(delta, elapsed) },
    bands: [
      {
        distance: 0,
        hysteresis: 0,
        baked: {
          wood: null,
          organs: [
            {
              kind: 'leaves',
              name: 'Fixture leaves',
              geometry,
              material: materials.surface,
              count: 1,
              matrices: Float32Array.from(identity.elements),
              colors: null,
              castShadow: true,
              receiveShadow: true,
            },
          ],
        },
      },
    ],
    organKinds: ['leaves'],
    bounds: new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(0.5, 0.5, 0),
    ),
    organCount: () => 1,
  };
  const field = new PlantField({
    prototypes: [prototype],
    placements: [{ position: [0, 0, 0] }],
    perInstanceCulling: false,
  });

  try {
    const mesh = field._organMeshes.get('leaves').mesh;
    assert.ok(mesh.material.positionNode?.isNode);
    assert.strictEqual(mesh.material.normalNode, normalViewGeometry);
    assert.notEqual(
      materials.surface.onBeforeCompile,
      THREE.Material.prototype.onBeforeCompile,
    );
    field.update(0.25, 4);
    assert.equal(wind.time, 4);
  } finally {
    field.dispose();
    geometry.dispose();
    materials.surface.dispose();
    materials.depth.dispose();
    materials.distance.dispose();
  }
});
