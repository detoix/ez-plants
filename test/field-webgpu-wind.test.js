import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';
import { normalViewGeometry } from 'three/tsl';

import {
  keepAuthoredNormalsOnBackFaces,
  createLeafMaterialSet,
} from '../src/lib/leaf-material.js';
import { LeafWind } from '../src/lib/leaf-wind.js';
import { Echinacea } from '../src/lib/plants/echinacea/echinacea.js';
import {
  createPlantPrototype,
  prepareWebGPUPlantMaterial,
  PlantField,
} from '../src/lib/field/index.webgpu.js';

test('material contracts survive separately bundled library entries', async () => {
  const windProducer = await import('../src/lib/leaf-wind.js?wind-producer');
  const windConsumer = await import('../src/lib/leaf-wind.js?wind-consumer');
  const normalsProducer = await import(
    '../src/lib/leaf-material.js?normals-producer'
  );
  const normalsConsumer = await import(
    '../src/lib/leaf-material.js?normals-consumer'
  );
  const windMaterial = new THREE.MeshStandardMaterial({
    name: 'Cross-bundle wind',
  });
  const normalMaterial = new THREE.MeshStandardMaterial({
    name: 'Cross-bundle authored normals',
  });
  const wind = new windProducer.LeafWind();

  try {
    wind.apply(windMaterial, { variant: 'cross-bundle-test' });
    normalsProducer.keepAuthoredNormalsOnBackFaces(normalMaterial);

    assert.strictEqual(windConsumer.leafWindForMaterial(windMaterial), wind);
    assert.deepEqual(windConsumer.leafWindMetadataForMaterial(windMaterial), {
      wind,
      variant: 'cross-bundle-test',
      hasAfterCompile: false,
    });
    assert.equal(
      normalsConsumer.keepsAuthoredNormalsOnBackFaces(normalMaterial),
      true,
    );
    assert.equal(
      normalsConsumer.leafBackfaceNormalPolicyForMaterial(normalMaterial),
      'authored',
    );
  } finally {
    windMaterial.dispose();
    normalMaterial.dispose();
  }
});

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

test('WebGPU PlantField translates Magnus head morphs without another draw', () => {
  const plant = new Echinacea({
    seed: 'magnus-webgpu-field',
    ageYears: 5,
    dayOfYear: 215,
  });
  const prototype = createPlantPrototype(plant);
  const field = new PlantField({
    prototypes: [prototype],
    placements: [{ position: [0, 0, 0] }],
    perInstanceCulling: false,
  });

  try {
    const entry = field._organMeshes.get('heads');
    const slot = field._slots[0].get('heads');
    const mesh = slot.variant.mesh;
    const id = slot.ids[0];
    const source = prototype.bands[0].baked.organs.find(
      (organ) => organ.kind === 'heads',
    );
    const sourceRed = source.colors[0];
    const sourceBlue = source.colors[2];
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    mesh.getMatrixAt(id, matrix);
    mesh.getColorAt(id, color);

    assert.equal(entry.variants.length, 3, 'the geometry ladder was flattened');
    assert.ok(mesh.material.positionNode?.isNode);
    assert.ok(mesh.material.castShadowPositionNode?.isNode);
    assert.equal(matrix.elements[3], Math.floor(sourceRed * 0.5));
    assert.ok(
      Math.abs(matrix.elements[7] - Math.floor(sourceBlue * 0.5) / 255) < 1e-6,
    );
    assert.ok(Math.abs(color.r - (sourceRed % 2)) < 1e-6);
    assert.ok(Math.abs(color.b - (sourceBlue % 2)) < 1e-6);
    assert.equal(field.stats().organDrawCalls, 3);
  } finally {
    field.dispose();
    prototype.dispose();
    plant.dispose();
  }
});
