import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';

import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';
import { TISEL_CALENDAR } from '../src/lib/plants/blackcurrant/phenology.js';

const MESH_NAMES = Object.freeze({
  wood: 'Blackcurrant_Wood',
  leaves: 'Blackcurrant_Leaves',
  petioles: 'Blackcurrant_Petioles_RedGreen',
  buds: 'Blackcurrant_DormantBuds',
  racemeAxes: 'Blackcurrant_RacemeAxes_RedGreen',
  pedicels: 'Blackcurrant_Pedicels_RedGreen',
  flowerBuds: 'Blackcurrant_InflorescenceBuds',
  flowers: 'Blackcurrant_Flowers_GreenMauve',
  berries: 'Blackcurrant_Berries',
  calyces: 'Blackcurrant_RetainedCalyxStars',
});

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

function captureGeometry(geometry) {
  return {
    position: hashView(geometry.getAttribute('position')?.array),
    normal: hashView(geometry.getAttribute('normal')?.array),
    uv: hashView(geometry.getAttribute('uv')?.array),
    index: hashView(geometry.index?.array),
    positionCount: geometry.getAttribute('position')?.count ?? 0,
    indexCount: geometry.index?.count ?? 0,
  };
}

function captureMesh(mesh) {
  const count = mesh.isInstancedMesh ? mesh.count : null;
  return {
    name: mesh.name,
    visible: mesh.visible,
    count,
    geometry: captureGeometry(mesh.geometry),
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

function captureInstances(mesh) {
  return {
    count: mesh.count,
    matrices: hashView(mesh.instanceMatrix.array, mesh.count * 16),
    colors: mesh.instanceColor
      ? hashView(mesh.instanceColor.array, mesh.count * 3)
      : null,
  };
}

function compileMaterial(material) {
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n#include <project_vertex>\n}',
    fragmentShader: 'void main() {\n#include <normal_fragment_begin>\n}',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('scene output is one woody batch plus compact instanced organ batches', () => {
  const plant = new Blackcurrant({
    seed: 'scene-contract',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const allMeshes = meshes(plant);
  const wood = meshNamed(plant, MESH_NAMES.wood);
  const instances = allMeshes.filter((mesh) => mesh.isInstancedMesh);
  const leaves = meshNamed(plant, MESH_NAMES.leaves);
  const stats = plant.stats();

  assert.equal(allMeshes.filter((mesh) => !mesh.isInstancedMesh).length, 1);
  assert.equal(instances.length, 9);
  assert.equal(wood.material.isMeshStandardMaterial, true);
  assert.equal(wood.castShadow, true);
  assert.equal(wood.receiveShadow, true);
  assert.equal(stats.woodyDrawCalls, 1);
  assert.equal(
    stats.drawCalls,
    allMeshes.filter(
      (mesh) => mesh.visible && (!mesh.isInstancedMesh || mesh.count > 0),
    ).length,
  );

  for (const mesh of instances) {
    assert.equal(mesh.castShadow, true, mesh.name);
    assert.equal(mesh.receiveShadow, true, mesh.name);
    assert.equal(mesh.frustumCulled, false, mesh.name);
  }

  assert.equal(leaves.geometry.getAttribute('position').count, 4);
  assert.equal(leaves.geometry.index.count, 6);
  assert.deepEqual(
    Array.from(leaves.geometry.getAttribute('uv').array),
    [0, 1, 0, 0, 1, 0, 1, 1],
  );
  assert.equal(leaves.material.isMeshPhongMaterial, true);
  assert.equal(leaves.material.side, THREE.DoubleSide);
  assert.equal(leaves.instanceColor, null);
  assert.equal(leaves.count, stats.visibleLeaves);
  assert.equal(
    meshNamed(plant, MESH_NAMES.petioles).count,
    stats.visibleLeaves,
  );
  assert.equal(
    meshNamed(plant, MESH_NAMES.flowerBuds).count,
    stats.visibleFlowerBuds,
  );
  assert.equal(
    meshNamed(plant, MESH_NAMES.flowers).count,
    stats.visibleFlowers,
  );
  assert.equal(
    meshNamed(plant, MESH_NAMES.berries).count,
    stats.visibleBerries,
  );
  assert.equal(
    meshNamed(plant, MESH_NAMES.calyces).count,
    stats.visibleBerries,
  );

  plant.dispose();
});

test('assets feed the shared EZ leaf and bark workflows without transferring texture ownership', () => {
  const leafMap = new THREE.Texture();
  const barkMaps = {
    color: new THREE.Texture(),
    normal: new THREE.Texture(),
    roughness: new THREE.Texture(),
  };
  const suppliedTextures = [leafMap, ...Object.values(barkMaps)];
  const disposals = new Map(suppliedTextures.map((texture) => [texture, 0]));
  for (const texture of suppliedTextures) {
    texture.addEventListener('dispose', () => {
      disposals.set(texture, disposals.get(texture) + 1);
    });
  }

  const plant = new Blackcurrant({
    seed: 'asset-contract',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
    assets: {
      leaf: {
        map: leafMap,
        tint: 0xe9ffe0,
        alphaTest: 0.35,
        roundedNormals: false,
      },
      bark: {
        tint: 0xceccbe,
        textured: true,
        textureScale: { x: 0.5, y: 5 },
        maps: barkMaps,
      },
    },
  });
  const leaves = meshNamed(plant, MESH_NAMES.leaves);
  const wood = meshNamed(plant, MESH_NAMES.wood);

  assert.strictEqual(leaves.material.map, leafMap);
  assert.strictEqual(leaves.customDepthMaterial.map, leafMap);
  assert.strictEqual(leaves.customDistanceMaterial.map, leafMap);
  assert.equal(leaves.material.alphaTest, 0.35);
  assert.equal(leaves.material.color.getHex(), 0xe9ffe0);
  assert.strictEqual(wood.material.map, barkMaps.color);
  assert.strictEqual(wood.material.normalMap, barkMaps.normal);
  assert.strictEqual(wood.material.roughnessMap, barkMaps.roughness);
  assert.strictEqual(wood.material.metalnessMap, barkMaps.roughness);
  assert.equal(wood.material.color.getHex(), 0xceccbe);
  for (const map of Object.values(barkMaps)) {
    assert.deepEqual(map.repeat.toArray(), [1, 0.2]);
    assert.equal(map.wrapS, THREE.RepeatWrapping);
    assert.equal(map.wrapT, THREE.RepeatWrapping);
  }

  plant.dispose();
  for (const texture of suppliedTextures) {
    assert.equal(disposals.get(texture), 0);
    texture.dispose();
  }
});

test('seasonal leaf tint changes one shared material and returns exactly A-B-A', () => {
  const plant = new Blackcurrant({
    seed: 'seasonal-material',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const leaves = meshNamed(plant, MESH_NAMES.leaves);
  const summer = leaves.material.color.clone();

  assert.equal(summer.getHex(), 0xffffff);
  plant.setTime({ dayOfYear: 85 });
  const spring = leaves.material.color.clone();
  assert.ok(spring.g > spring.r && spring.r > spring.b);

  plant.setTime({ dayOfYear: 288 });
  const autumn = leaves.material.color.clone();
  assert.ok(autumn.r > autumn.g && autumn.g > autumn.b);

  plant.setTime({ dayOfYear: 175 });
  assert.ok(leaves.material.color.equals(summer));
  assert.strictEqual(
    meshNamed(plant, MESH_NAMES.leaves).material,
    leaves.material,
  );
  plant.dispose();
});

test('leaf and berry instance transforms retain real-world metre dimensions', () => {
  const plant = new Blackcurrant({
    seed: 41,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const scaleRanges = (mesh) => {
    const values = [];
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      values.push(scale.x, scale.y, scale.z);
    }
    return [Math.min(...values), Math.max(...values)];
  };

  const [minimumLeaf, maximumLeaf] = scaleRanges(
    meshNamed(plant, MESH_NAMES.leaves),
  );
  const [minimumBerry, maximumBerry] = scaleRanges(
    meshNamed(plant, MESH_NAMES.berries),
  );
  // Newly unfolding leaves are intentionally smaller than their mature source
  // size, but at least part of a summer canopy must reach the source range.
  assert.ok(minimumLeaf > 0);
  assert.ok(maximumLeaf >= 0.045 - 1e-6);
  assert.ok(maximumLeaf <= 0.12 + 1e-6);
  assert.ok(minimumBerry >= 0.0085 - 1e-6);
  assert.ok(maximumBerry <= 0.0145 + 1e-6);
  plant.dispose();
});

test('rendered berry normals remain outward and unit length at UV poles', () => {
  const plant = new Blackcurrant({
    seed: 'berry-normals',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const geometry = meshNamed(plant, MESH_NAMES.berries).geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');

  for (let index = 0; index < normals.count; index++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
    const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
    assert.ok(Math.abs(normal.length() - 1) < 1e-6, `normal ${index}`);
    if (vertex.lengthSq() > 1e-12) {
      assert.ok(normal.dot(vertex) > 0, `outward normal ${index}`);
    }
  }
  plant.dispose();
});

test('same seed has identical rendering while plantId remains an application identity', () => {
  const options = {
    seed: 'identity-rendering',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  };
  const first = new Blackcurrant({ ...options, plantId: 'garden:a' });
  const second = new Blackcurrant({ ...options, plantId: 'garden:b' });
  const firstSerialized = first.serialize();
  const secondSerialized = second.serialize();

  assert.equal(firstSerialized.plantId, 'garden:a');
  assert.equal(secondSerialized.plantId, 'garden:b');
  assert.deepEqual(
    { ...firstSerialized, plantId: null },
    { ...secondSerialized, plantId: null },
  );
  assert.deepEqual(capturePlant(first), capturePlant(second));

  first.dispose();
  second.dispose();
});

test('renderer internals are absent from the ordinary plant surface', () => {
  const plant = new Blackcurrant({
    seed: 'private-surface',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });

  for (const field of [
    'instances',
    'materials',
    'woodMeshes',
    'sculptRuntime',
    'model',
    'events',
    'detail',
    'autoLOD',
  ]) {
    assert.equal(Object.hasOwn(plant, field), false, field);
    assert.equal(field in plant, false, field);
  }
  assert.equal(
    Object.keys(plant).some((field) =>
      /resource|instancePool|runtime|material|woodMesh|model|events/i.test(
        field,
      ),
    ),
    false,
  );
  assert.deepEqual(Object.keys(plant.userData).sort(), [
    'cultivar',
    'species',
    'units',
  ]);
  assert.doesNotMatch(JSON.stringify(plant), /sculptRuntime|instanceId/);
  plant.dispose();
});

test('string seeds are deterministic and distinct through scene output', () => {
  const create = (seed) =>
    new Blackcurrant({
      seed,
      maxYears: 8,
      ageYears: 5,
      dayOfYear: 175,
    });
  const first = create('seed-one');
  const repeat = create('seed-one');
  const second = create('seed-two');

  assert.deepEqual(capturePlant(first), capturePlant(repeat));
  assert.notDeepEqual(capturePlant(first), capturePlant(second));

  first.dispose();
  repeat.dispose();
  second.dispose();
});

test('time scrubbing A-B-A reproduces exact observable geometry and instances', () => {
  const plant = new Blackcurrant({
    seed: 'time-scrub',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const atA = capturePlant(plant);
  const statsA = plant.stats();

  plant.setTime({ ageYears: 7, dayOfYear: 288 });
  assert.notDeepEqual(capturePlant(plant), atA);
  plant.setTime({ ageYears: 5, dayOfYear: 175 });

  assert.deepEqual(capturePlant(plant), atA);
  assert.deepEqual(plant.stats(), statsA);
  plant.dispose();
});

test('a dormant day-only update reuses unchanged woody geometry', () => {
  const plant = new Blackcurrant({
    seed: 'day-only-wood',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 1,
  });
  const wood = meshNamed(plant, MESH_NAMES.wood);
  const geometry = wood.geometry;
  const before = captureGeometry(geometry);

  plant.setTime({ ageYears: 5, dayOfYear: 30 });
  assert.strictEqual(meshNamed(plant, MESH_NAMES.wood), wood);
  assert.strictEqual(wood.geometry, geometry);
  assert.deepEqual(captureGeometry(wood.geometry), before);
  plant.dispose();
});

test('simulation year validation is transactional', () => {
  const plant = new Blackcurrant({
    seed: 'transactional-time',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const before = plant.serialize();
  const rendered = capturePlant(plant);

  assert.throws(() => plant.setTime({ ageYears: 2.5 }), /integer/);
  assert.deepEqual(plant.serialize(), before);
  assert.deepEqual(capturePlant(plant), rendered);
  plant.dispose();
});

test('the renderer uses the shared instancing-safe EZ leaf wind for all render passes', () => {
  const plant = new Blackcurrant({
    seed: 'renderer-leaf-wind',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const leaves = meshNamed(plant, MESH_NAMES.leaves);
  const before = captureInstances(leaves);
  const surfaceShader = compileMaterial(leaves.material);
  const depthShader = compileMaterial(leaves.customDepthMaterial);
  const distanceShader = compileMaterial(leaves.customDistanceMaterial);

  assert.match(surfaceShader.vertexShader, /leafWindSimplex3/);
  assert.match(surfaceShader.vertexShader, /USE_INSTANCING/);
  assert.match(surfaceShader.vertexShader, /uv\.y \* leafWindLocalStrength/);
  assert.match(surfaceShader.fragmentShader, /uCustomNormals/);
  assert.strictEqual(surfaceShader.uniforms.uTime, depthShader.uniforms.uTime);
  assert.strictEqual(
    surfaceShader.uniforms.uTime,
    distanceShader.uniforms.uTime,
  );

  plant.update(0.016, 7.5);
  assert.equal(surfaceShader.uniforms.uTime.value, 7.5);
  assert.deepEqual(captureInstances(leaves), before);
  plant.dispose();
});

test('scenario, pruning and harvest actions mutate only the serialized twin state', () => {
  const plant = new Blackcurrant({
    seed: 45,
    maxYears: 16,
    ageYears: 10,
    dayOfYear: 175,
  });
  const maintainedCanes = plant.stats().visibleCanes;
  plant.setScenario('neglected');
  assert.ok(plant.stats().visibleCanes > maintainedCanes);

  plant.setScenario('maintained');
  plant.setTime({ ageYears: 10, dayOfYear: 30 });
  const beforePrune = plant.stats().visibleCanes;
  const prune = plant.pruneOldestCane();
  assert.equal(prune.type, 'prune');
  assert.equal(plant.stats().visibleCanes, beforePrune - 1);
  assert.deepEqual(plant.serialize().events, [prune]);

  plant.setTime({ ageYears: 10, dayOfYear: 175 });
  const beforeHarvest = plant.stats();
  const harvest = plant.harvest();
  assert.ok(harvest.event);
  assert.equal(harvest.amountKg, beforeHarvest.estimatedYieldKg);
  assert.equal(plant.stats().visibleRipeBerries, 0);
  assert.equal(plant.serialize().events.length, 2);

  plant.resetEvents();
  assert.deepEqual(plant.serialize().events, []);
  assert.ok(plant.stats().visibleRipeBerries > 0);
  plant.dispose();
});

test('renewal pruning honors phenology, plant age and the maintained cane floor', () => {
  const plant = new Blackcurrant({
    seed: 47,
    maxYears: 16,
    ageYears: 10,
    dayOfYear: 175,
  });

  assert.equal(
    plant.pruneOldestCane().reason,
    'outside-dormant-pruning-window',
  );
  assert.equal(plant.serialize().events.length, 0);

  plant.setTime({ ageYears: 3, dayOfYear: 30 });
  assert.equal(
    plant.pruneOldestCane().reason,
    'plant-too-young-for-renewal-pruning',
  );

  plant.setTime({ ageYears: 10, dayOfYear: 30 });
  while (plant.pruneOldestCane().type === 'prune') {
    // Exercise the public repeated-action path until the maintained floor wins.
  }
  assert.ok(plant.stats().visibleCanes >= 6);
  assert.equal(
    plant.pruneOldestCane().reason,
    'maintained-six-cane-minimum-reached',
  );
  plant.dispose();
});

test('harvest validation and repeat behavior leave invalid events unrecorded', () => {
  const plant = new Blackcurrant({
    seed: 50,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestStart,
  });
  const ripeBefore = plant.stats().visibleRipeBerries;

  assert.throws(() => plant.harvest({ amountKg: -2 }), /amountKg/);
  assert.throws(() => plant.harvest({ amountKg: Infinity }), /amountKg/);
  assert.equal(plant.serialize().events.length, 0);
  assert.equal(plant.stats().visibleRipeBerries, ripeBefore);

  assert.ok(plant.harvest().event);
  assert.equal(plant.harvest().event, null);
  assert.equal(plant.serialize().events.length, 1);
  plant.dispose();
});

test('scene organ counts match model statistics across phenology boundaries', () => {
  const plant = new Blackcurrant({
    seed: 'phase-boundaries',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.floweringStart - 10,
  });
  const days = [
    TISEL_CALENDAR.floweringStart - 10,
    TISEL_CALENDAR.floweringStart,
    TISEL_CALENDAR.floweringEnd + 3,
    TISEL_CALENDAR.fruitSetStart,
    TISEL_CALENDAR.harvestStart,
  ];

  for (const dayOfYear of days) {
    plant.setTime({ ageYears: 5, dayOfYear });
    const stats = plant.stats();
    assert.equal(
      meshNamed(plant, MESH_NAMES.flowerBuds).count,
      stats.visibleFlowerBuds,
    );
    assert.equal(
      meshNamed(plant, MESH_NAMES.flowers).count,
      stats.visibleFlowers,
    );
    assert.equal(
      meshNamed(plant, MESH_NAMES.berries).count,
      stats.visibleGreenBerries + stats.visibleRipeBerries,
    );
  }

  plant.setPhenologyProfile({ trialYear: 2024, offsetDays: 0 });
  assert.equal(plant.stats().phenology.trialYear, 2024);
  assert.throws(
    () => plant.setPhenologyProfile({ trialYear: 2025 }),
    /trialYear/,
  );
  assert.equal(plant.stats().phenology.trialYear, 2024);
  plant.dispose();
});

test('unsupported cultivars and inconsistent event identities fail at the boundary', () => {
  assert.throws(
    () => new Blackcurrant({ cultivar: 'Ben Hope', maxYears: 8 }),
    /only.*Tisel/i,
  );
  assert.throws(
    () =>
      new Blackcurrant({
        seed: 'duplicate-events',
        maxYears: 8,
        events: [
          { id: 'same', type: 'inspection', ageYears: 1, dayOfYear: 30 },
          { id: 'same', type: 'inspection', ageYears: 2, dayOfYear: 30 },
        ],
      }),
    /unique/i,
  );
  assert.throws(
    () => new Blackcurrant({ maxYears: 8, events: {} }),
    /events must be an array/i,
  );
  assert.throws(
    () => new Blackcurrant({ maxYears: 8, events: [[]] }),
    /care event object/i,
  );

  const plant = new Blackcurrant({
    seed: 'event-validation',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const event = plant.addEvent({ type: 'inspection' });
  assert.equal(event.ageYears, 5);
  assert.equal(event.dayOfYear, 175);
  assert.throws(() => plant.addEvent({ ...event }), /Duplicate/);
  assert.throws(
    () => plant.addEvent({ type: 'inspection', ageYears: NaN }),
    /ageYears/,
  );
  plant.dispose();
});

test('dispose releases every unique renderer allocation exactly once', () => {
  const plant = new Blackcurrant({
    seed: 'renderer-disposal',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const resources = new Set();
  for (const mesh of meshes(plant)) {
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      resources.add(material);
    }
    if (mesh.customDepthMaterial) resources.add(mesh.customDepthMaterial);
    if (mesh.customDistanceMaterial) resources.add(mesh.customDistanceMaterial);
  }
  const disposeCounts = new Map(
    [...resources].map((resource) => [resource, 0]),
  );
  for (const resource of resources) {
    resource.addEventListener('dispose', () => {
      disposeCounts.set(resource, disposeCounts.get(resource) + 1);
    });
  }

  plant.dispose();
  plant.dispose();
  assert.equal(plant.children.length, 0);
  for (const [resource, count] of disposeCounts) {
    assert.equal(count, 1, resource.name || resource.type);
  }
});
