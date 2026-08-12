import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';

import {
  normalizePlantLODLevels,
  PlantLODController,
} from '../src/lib/plant-lod.js';
import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';

function levels() {
  return [
    { distance: 20, hysteresis: 0.2, detail: { leafStride: 4 } },
    { distance: 0, detail: {} },
    {
      distance: 10,
      hysteresis: 0.1,
      detail: { sectionStride: 2, leafStride: 2 },
    },
  ];
}

function hashView(view, elementCount = view?.length ?? 0) {
  if (!view || elementCount === 0) return null;
  return createHash('sha256')
    .update(
      Buffer.from(
        view.buffer,
        view.byteOffset,
        elementCount * view.BYTES_PER_ELEMENT,
      ),
    )
    .digest('hex');
}

function meshes(plant) {
  const result = [];
  plant.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

function meshNamed(plant, name) {
  const result = meshes(plant).find((mesh) => mesh.name === name);
  assert.ok(result, `missing scene mesh ${name}`);
  return result;
}

function captureMesh(mesh) {
  return {
    name: mesh.name,
    visible: mesh.visible,
    count: mesh.isInstancedMesh ? mesh.count : null,
    positions: hashView(mesh.geometry.getAttribute('position')?.array),
    normals: hashView(mesh.geometry.getAttribute('normal')?.array),
    uvs: hashView(mesh.geometry.getAttribute('uv')?.array),
    indices: hashView(mesh.geometry.index?.array),
    matrices: mesh.isInstancedMesh
      ? hashView(mesh.instanceMatrix.array, mesh.count * 16)
      : null,
    colors:
      mesh.isInstancedMesh && mesh.instanceColor
        ? hashView(mesh.instanceColor.array, mesh.count * 3)
        : null,
  };
}

function capturePlant(plant) {
  return meshes(plant)
    .map(captureMesh)
    .sort((a, b) => a.name.localeCompare(b.name));
}

test('Plant LOD levels normalize deterministically and reject ambiguous bands', () => {
  const ordered = normalizePlantLODLevels(levels(), {
    segmentFactor: 0.8,
    leafScale: 1.1,
  });

  assert.deepEqual(
    ordered.map((level) => level.distance),
    [0, 10, 20],
  );
  assert.equal(ordered[1].detail.segmentFactor, 0.8);
  assert.equal(ordered[2].detail.leafScale, 1.1);
  assert.ok(Object.isFrozen(ordered));
  assert.ok(Object.isFrozen(ordered[0].detail));

  assert.throws(
    () => normalizePlantLODLevels([{ distance: 1, detail: {} }]),
    /start at distance 0/,
  );
  assert.throws(
    () => normalizePlantLODLevels([{ distance: 0 }, { distance: 0 }]),
    /unique/,
  );
  assert.throws(
    () => normalizePlantLODLevels([{ distance: 0, hysteresis: 1.1 }]),
    /between 0 and 1/,
  );
});

test('PlantLODController uses Three.js distance, hysteresis and stable A-B-A detail', () => {
  const target = new THREE.Group();
  const applied = [];
  const controller = new PlantLODController({
    target,
    detail: {
      sectionStride: 1,
      segmentFactor: 1,
      leafStride: 1,
      leafScale: 1,
      billboard: null,
    },
    levels: levels(),
    applyDetail: (detail) => applied.push({ ...detail }),
  });

  assert.equal(controller.updateDistance(0), true);
  assert.equal(controller.currentLevel, 0);
  assert.equal(controller.updateDistance(9.99), false);
  assert.equal(controller.updateDistance(10), true);
  const detailB = { ...applied.at(-1) };
  assert.equal(controller.currentLevel, 1);
  assert.equal(controller.updateDistance(9.5), false);
  assert.equal(controller.updateDistance(8.99), true);
  assert.equal(controller.currentLevel, 0);
  assert.equal(controller.updateDistance(10), true);
  assert.deepEqual(applied.at(-1), detailB);

  assert.equal(controller.updateDistance(25), true);
  assert.equal(controller.currentLevel, 2);
  assert.equal(controller.updateDistance(17), false);
  assert.equal(controller.updateDistance(15.99), true);
  assert.equal(controller.currentLevel, 1);

  const camera = new THREE.PerspectiveCamera();
  camera.position.set(20, 0, 0);
  camera.zoom = 2;
  assert.equal(controller.update(camera), false);
  assert.equal(controller.currentDistance, 10);

  controller.dispose();
  assert.equal(controller.disposed, true);
  assert.deepEqual(applied.at(-1), controller.baseDetail);
  assert.equal(controller.updateDistance(25), false);
  controller.dispose();
});

test('constructor LOD changes only visual detail and returns exact A-B-A output', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-lod',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
    lod: true,
  });
  const camera = new THREE.PerspectiveCamera();
  const near = capturePlant(plant);
  const biology = {
    leaves: plant.stats().leaves,
    ripeBerries: plant.stats().ripeBerries,
    events: plant.serialize().events,
  };
  const nearWoodPositions = meshNamed(
    plant,
    'Blackcurrant_Wood',
  ).geometry.getAttribute('position').count;
  const nearLeafCount = meshNamed(plant, 'Blackcurrant_Leaves').count;
  const berries = captureMesh(meshNamed(plant, 'Blackcurrant_Berries'));

  camera.position.set(8, 0, 0);
  plant.update(0, 0, camera);
  const far = capturePlant(plant);
  assert.ok(
    meshNamed(plant, 'Blackcurrant_Wood').geometry.getAttribute('position')
      .count < nearWoodPositions,
  );
  assert.ok(meshNamed(plant, 'Blackcurrant_Leaves').count < nearLeafCount);
  assert.deepEqual(
    captureMesh(meshNamed(plant, 'Blackcurrant_Berries')),
    berries,
  );
  assert.deepEqual(
    {
      leaves: plant.stats().leaves,
      ripeBerries: plant.stats().ripeBerries,
      events: plant.serialize().events,
    },
    biology,
  );

  camera.position.set(0, 0, 0);
  plant.update(0, 0, camera);
  assert.deepEqual(capturePlant(plant), near);
  camera.position.set(8, 0, 0);
  plant.update(0, 0, camera);
  assert.deepEqual(capturePlant(plant), far);
  camera.position.set(0, 0, 0);
  plant.update(0, 0, camera);
  assert.deepEqual(capturePlant(plant), near);

  assert.equal('detail' in plant, false);
  assert.equal('autoLOD' in plant, false);
  plant.dispose();
});

test('camera-driven LOD disposes replaced and live wood geometry exactly once', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-lod-disposal',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
    lod: true,
  });
  const camera = new THREE.PerspectiveCamera();
  const initialGeometry = meshNamed(plant, 'Blackcurrant_Wood').geometry;
  let initialDisposals = 0;
  initialGeometry.addEventListener('dispose', () => initialDisposals++);

  camera.position.set(8, 0, 0);
  plant.update(0, 0, camera);
  assert.equal(initialDisposals, 1);

  const liveGeometry = meshNamed(plant, 'Blackcurrant_Wood').geometry;
  assert.notStrictEqual(liveGeometry, initialGeometry);
  let liveDisposals = 0;
  liveGeometry.addEventListener('dispose', () => liveDisposals++);

  plant.dispose();
  plant.dispose();
  assert.equal(initialDisposals, 1);
  assert.equal(liveDisposals, 1);
});
