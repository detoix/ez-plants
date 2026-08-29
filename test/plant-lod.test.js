import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';

import { normalizePlantDetail } from '../src/lib/plant-detail.js';
import {
  normalizePlantLODLevels,
  PlantLODController,
} from '../src/lib/plant-lod.js';
import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';
import { Forsythia } from '../src/lib/plants/forsythia/forsythia.js';

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

test('PlantLODController turns a distance into a level index, with hysteresis', () => {
  const controller = new PlantLODController({ levels: levels() });

  // A first choice has no history to be sticky about.
  assert.equal(controller.levelFor(0), 0);
  assert.equal(controller.levelFor(9.99), 0);
  assert.equal(controller.levelFor(10), 1);

  // Inside the sticky zone below the boundary it holds; past it, it lets go.
  assert.equal(controller.levelFor(9.5), 1);
  assert.equal(controller.levelFor(8.99), 0);
  assert.equal(controller.levelFor(10), 1);

  assert.equal(controller.levelFor(25), 2);
  assert.equal(controller.levelFor(17), 2);
  assert.equal(controller.levelFor(15.99), 1);
  assert.equal(controller.currentDistance, 15.99);

  controller.reset();
  assert.equal(controller.currentLevel, null);
  assert.equal(controller.levelFor(9.99), 0, 'reset clears the hysteresis');

  assert.throws(() => controller.levelFor(-1), /non-negative/);
});

test('the controller holds no plant and reads no camera', () => {
  const controller = new PlantLODController({ levels: levels() });

  // It is a calculator. Everything it can do is take a number and return an
  // index; there is nothing on it that could reach a scene or a camera.
  assert.equal(typeof controller.levelFor, 'function');
  assert.equal(controller.update, undefined);
  assert.equal(controller.target, undefined);
  assert.equal(controller.applyDetail, undefined);
});

test('constructor LOD changes only visual detail and returns exact A-B-A output', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-lod',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
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

  plant.setLevel(1);
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

  plant.setLevel(0);
  assert.deepEqual(capturePlant(plant), near);
  plant.setLevel(1);
  assert.deepEqual(capturePlant(plant), far);
  plant.setLevel(0);
  assert.deepEqual(capturePlant(plant), near);

  // Passing a camera cannot change anything: `update` no longer takes one.
  plant.update(0, 0, new THREE.PerspectiveCamera());
  assert.deepEqual(capturePlant(plant), near);
  assert.equal(plant.level, 0);

  assert.equal('detail' in plant, false);
  assert.equal('autoLOD' in plant, false);
  plant.dispose();
});

test('changing level disposes replaced and live wood geometry exactly once', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-lod-disposal',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const initialGeometry = meshNamed(plant, 'Blackcurrant_Wood').geometry;
  let initialDisposals = 0;
  initialGeometry.addEventListener('dispose', () => initialDisposals++);

  plant.setLevel(1);
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

/* -------------------------------------------------------------------- *
 * woodOrderLimit
 * -------------------------------------------------------------------- */

test('woodOrderLimit defaults to every order and normalizes to a whole one', () => {
  assert.equal(normalizePlantDetail().woodOrderLimit, Infinity);
  assert.equal(normalizePlantDetail({ woodOrderLimit: 1.8 }).woodOrderLimit, 1);
  assert.equal(normalizePlantDetail({ woodOrderLimit: -3 }).woodOrderLimit, 0);
  assert.equal(
    normalizePlantDetail({ woodOrderLimit: Infinity }).woodOrderLimit,
    Infinity,
  );
  assert.throws(
    () => normalizePlantDetail({ woodOrderLimit: 'most' }),
    TypeError,
  );
});

test('a band past woodOrderLimit stops meshing twigs and keeps what grows on them', () => {
  // Strides bottom out at two rings an axis, so a shrub whose wood cost is its
  // branch count has a triangle floor no stride reaches under. This is the
  // lever for that, and the contract is that it takes the twig and nothing
  // else: the leaves the twig carried stay, so a coarse band loses a sub-pixel
  // stick rather than a piece of its own silhouette.
  const detail = {
    landmarkStride: 12,
    sectionStride: 12,
    segmentFactor: 0.6,
  };
  const withTwigs = new Forsythia({
    seed: 'wood-order-limit',
    ageYears: 5,
    dayOfYear: 230,
    lodLevels: [{ distance: 0, detail }],
  });
  const withoutTwigs = new Forsythia({
    seed: 'wood-order-limit',
    ageYears: 5,
    dayOfYear: 230,
    lodLevels: [{ distance: 0, detail: { ...detail, woodOrderLimit: 1 } }],
  });

  try {
    const triangles = (plant) =>
      meshNamed(plant, 'Forsythia_Wood').geometry.index.count / 3;
    const leaves = (plant) =>
      meshNamed(plant, 'Forsythia_Leaves_Opposite').count;

    assert.ok(
      triangles(withoutTwigs) < triangles(withTwigs) * 0.6,
      `${triangles(withoutTwigs)} of ${triangles(withTwigs)} wood triangles remain`,
    );
    assert.equal(leaves(withoutTwigs), leaves(withTwigs));

    // Order 0 is never dropped, whatever the limit says: a shrub with no canes
    // is not a coarser shrub.
    const trunksOnly = new Forsythia({
      seed: 'wood-order-limit',
      ageYears: 5,
      dayOfYear: 230,
      lodLevels: [{ distance: 0, detail: { ...detail, woodOrderLimit: 0 } }],
    });
    try {
      assert.ok(triangles(trunksOnly) > 0);
      assert.ok(meshNamed(trunksOnly, 'Forsythia_Wood').visible);
    } finally {
      trunksOnly.dispose();
    }
  } finally {
    withTwigs.dispose();
    withoutTwigs.dispose();
  }
});
