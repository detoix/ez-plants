import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  normalizePlantLODLevels,
  PlantLODController,
} from '../src/lib/plant-lod.js';
import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';

function detailTarget() {
  const target = new THREE.Group();
  target.detail = Object.freeze({
    sectionStride: 1,
    segmentFactor: 1,
    leafStride: 1,
    leafScale: 1,
    billboard: null,
  });
  target.applied = [];
  target.setDetail = (detail) => {
    target.detail = Object.freeze({ ...detail });
    target.applied.push({ ...detail });
    return target;
  };
  return target;
}

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

function captureInstances(mesh) {
  return {
    count: mesh.count,
    matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
    colors: mesh.instanceColor
      ? Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3))
      : null,
  };
}

function captureGeometry(geometry) {
  return {
    positions: Array.from(geometry.getAttribute('position').array),
    normals: Array.from(geometry.getAttribute('normal').array),
    uvs: Array.from(geometry.getAttribute('uv').array),
    indices: Array.from(geometry.index.array),
  };
}

function capturePlant(plant) {
  return {
    detail: { ...plant.detail },
    leaves: {
      ids: structuredClone(plant._activeLeafIds),
      instances: captureInstances(plant.instances.leaves),
    },
    wood: Object.fromEntries(
      Object.entries(plant.woodMeshes).map(([band, mesh]) => [
        band,
        captureGeometry(mesh.geometry),
      ]),
    ),
    unaffectedOrgans: Object.fromEntries(
      [
        'buds',
        'racemeAxes',
        'pedicels',
        'flowerBuds',
        'flowers',
        'berries',
        'calyces',
      ].map((kind) => [kind, captureInstances(plant.instances[kind])]),
    ),
  };
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

test('PlantLODController uses Three.js thresholds, hysteresis and stable A-B-A', () => {
  const target = detailTarget();
  const controller = new PlantLODController(target, levels());

  assert.equal(controller.updateDistance(0), true);
  assert.equal(controller.currentLevel, 0);
  assert.equal(controller.updateDistance(9.99), false);
  assert.equal(controller.updateDistance(10), true);
  const detailB = { ...target.detail };
  assert.equal(controller.currentLevel, 1);
  assert.equal(controller.updateDistance(9.5), false);
  assert.equal(controller.currentLevel, 1);
  assert.equal(controller.updateDistance(8.99), true);
  assert.equal(controller.currentLevel, 0);
  assert.equal(controller.updateDistance(10), true);
  assert.deepEqual(target.detail, detailB);

  assert.equal(controller.updateDistance(25), true);
  assert.equal(controller.currentLevel, 2);
  assert.equal(controller.updateDistance(17), false);
  assert.equal(controller.currentLevel, 2);
  assert.equal(controller.updateDistance(15.99), true);
  assert.equal(controller.currentLevel, 1);

  const camera = new THREE.PerspectiveCamera();
  camera.position.set(20, 0, 0);
  camera.zoom = 2;
  target.position.set(0, 0, 0);
  assert.equal(controller.update(camera), false);
  assert.equal(controller.currentDistance, 10);
  assert.equal(controller.currentLevel, 1);

  controller.dispose();
  assert.equal(controller.disposed, true);
  assert.equal(controller.updateDistance(25), false);
  assert.deepEqual(target.detail, controller.baseDetail);
  controller.dispose();
});

test('Blackcurrant automatic LOD preserves biology, berries and exact A-B-A state', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-auto-lod',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const snapshot = plant._snapshot;
  const events = plant.events;
  const full = capturePlant(plant);

  plant.enableAutoLOD([
    { distance: 0, detail: {} },
    {
      distance: 2,
      hysteresis: 0.1,
      detail: {
        sectionStride: 2,
        segmentFactor: 0.75,
        leafStride: 2,
        leafScale: 1.18,
      },
    },
    {
      distance: 4,
      hysteresis: 0.1,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.55,
        leafStride: 3,
        leafScale: 1.32,
      },
    },
  ]);

  assert.equal(plant.autoLOD.updateDistance(5), true);
  const far = capturePlant(plant);
  assert.ok(far.wood.young.positions.length < full.wood.young.positions.length);
  assert.ok(far.leaves.instances.count < full.leaves.instances.count);
  assert.strictEqual(plant._snapshot, snapshot);
  assert.strictEqual(plant.events, events);
  assert.deepEqual(far.unaffectedOrgans, full.unaffectedOrgans);

  assert.equal(plant.autoLOD.updateDistance(0), true);
  assert.deepEqual(capturePlant(plant), full);
  assert.equal(plant.autoLOD.updateDistance(5), true);
  assert.deepEqual(capturePlant(plant), far);
  assert.equal(plant.autoLOD.updateDistance(0), true);
  assert.deepEqual(capturePlant(plant), full);

  plant.dispose();
  assert.equal(plant.autoLOD, null);
});

test('Blackcurrant automatic LOD disposes replaced and live wood exactly once', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-auto-lod-disposal',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const levelsForDisposal = [
    { distance: 0, detail: {} },
    {
      distance: 2,
      detail: { sectionStride: 3, segmentFactor: 0.55, leafStride: 3 },
    },
  ];
  plant.enableAutoLOD(levelsForDisposal);

  // Capture exact geometry references separately because each mesh is swapped.
  const initialGeometries = Object.values(plant.woodMeshes).map(
    (mesh) => mesh.geometry,
  );
  const initialCounts = new Map(
    initialGeometries.map((geometry) => [geometry, 0]),
  );
  for (const geometry of initialGeometries) {
    geometry.addEventListener('dispose', () => {
      initialCounts.set(geometry, initialCounts.get(geometry) + 1);
    });
  }

  plant.autoLOD.updateDistance(3);
  for (const geometry of initialGeometries) {
    assert.equal(initialCounts.get(geometry), 1);
  }

  const liveGeometries = Object.values(plant.woodMeshes).map(
    (mesh) => mesh.geometry,
  );
  const liveCounts = new Map(liveGeometries.map((geometry) => [geometry, 0]));
  for (const geometry of liveGeometries) {
    geometry.addEventListener('dispose', () => {
      liveCounts.set(geometry, liveCounts.get(geometry) + 1);
    });
  }

  plant.dispose();
  for (const geometry of liveGeometries) {
    assert.equal(liveCounts.get(geometry), 1);
  }
  plant.dispose();
  for (const geometry of liveGeometries) {
    assert.equal(liveCounts.get(geometry), 1);
  }
});
