import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';
import { keyedRandom } from '../src/lib/keyed-random.js';
import { LeafWind } from '../src/lib/leaf-wind.js';
import { createBerryGeometry } from '../src/lib/plants/blackcurrant/geometry.js';
import { TISEL_CALENDAR } from '../src/lib/plants/blackcurrant/phenology.js';
import { TISEL_PROFILE } from '../src/lib/plants/blackcurrant/tisel.js';
import { BranchCap, sampleBranchSection } from '../src/lib/woody-geometry.js';
import {
  createTiselModel,
  evaluateTiselModel,
} from '../src/lib/plants/blackcurrant/model.js';

function captureInstances(mesh) {
  return {
    count: mesh.count,
    matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
    colors: mesh.instanceColor
      ? Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3))
      : null,
  };
}

function captureRenderState(plant) {
  return {
    stats: plant.stats(),
    axes: [...plant.userData.sculptRuntime.maps.axes.values()].map(
      ({ id, range }) => ({
        id,
        range: range ? { ...range } : null,
      }),
    ),
    wood: Object.fromEntries(
      Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
        ageBand,
        {
          visible: mesh.visible,
          vertexCount: mesh.geometry.getAttribute('position').count,
          indexCount: mesh.geometry.index.count,
          axisIds: mesh.userData.axisRanges.map((range) => range.axisId),
        },
      ]),
    ),
    instances: Object.fromEntries(
      Object.entries(plant.instances).map(([kind, mesh]) => [
        kind,
        captureInstances(mesh),
      ]),
    ),
  };
}

function captureWoodyBytes(plant) {
  return Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      {
        positions: Array.from(mesh.geometry.getAttribute('position').array),
        normals: Array.from(mesh.geometry.getAttribute('normal').array),
        uvs: Array.from(mesh.geometry.getAttribute('uv').array),
        indices: Array.from(mesh.geometry.index.array),
        ranges: mesh.userData.axisRanges.map((range) => ({ ...range })),
      },
    ]),
  );
}

function captureActiveLeafMatrices(plant) {
  const captured = new Map();
  const mesh = plant.instances.leaves;
  plant._activeLeafIds.forEach((id, index) => {
    captured.set(
      id,
      Array.from(mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16)),
    );
  });
  return captured;
}

test('renderer uses one shared EZ leaf card, material and caller-owned texture', () => {
  const map = new THREE.Texture();
  const plant = new Blackcurrant({
    seed: 39,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
    leaf: {
      map,
      tint: 0xe9ffe0,
      alphaTest: 0.35,
      roundedNormals: false,
    },
  });

  assert.deepEqual(
    Object.keys(plant.instances).filter((kind) => kind.startsWith('leav')),
    ['leaves'],
  );
  assert.equal(
    plant.instances.leaves.geometry.getAttribute('position').count,
    4,
  );
  assert.equal(plant.instances.leaves.geometry.index.count, 6);
  assert.deepEqual(
    Array.from(plant.instances.leaves.geometry.getAttribute('uv').array),
    [0, 1, 0, 0, 1, 0, 1, 1],
  );
  assert.strictEqual(plant.materials.leaf.map, map);
  assert.strictEqual(plant.materials.leafDepth.map, map);
  assert.strictEqual(plant.materials.leafDistance.map, map);
  assert.equal(plant.materials.leaf.alphaTest, 0.35);
  assert.equal(plant.materials.leaf.color.getHex(), 0xe9ffe0);
  assert.equal(plant.materials.leaf.vertexColors, false);
  assert.strictEqual(plant.instances.leaves.material, plant.materials.leaf);
  assert.equal(plant.instances.leaves.count, plant.stats().visibleLeaves);
  assert.equal(plant.instances.leaves.instanceColor, null);

  plant.dispose();
  map.dispose();
});

test('berry normals remain outward and unit length at duplicated UV poles', () => {
  const geometry = createBerryGeometry();
  const normals = geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index++) {
    const length = Math.hypot(
      normals.getX(index),
      normals.getY(index),
      normals.getZ(index),
    );
    assert.ok(Math.abs(length - 1) < 1e-6, `normal ${index}: ${length}`);
  }
  geometry.dispose();
});

test('leaf instances keep EZ-Tree cast and receive shadow behavior', () => {
  const plant = new Blackcurrant({
    seed: 40,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });

  assert.equal(plant.instances.leaves.castShadow, true);
  assert.equal(plant.instances.leaves.receiveShadow, true);
  assert.equal(plant.materials.leaf.alphaTest, 0.5);
  assert.equal(plant.leaf.roundedNormals, true);
  const normals = plant.instances.leaves.geometry.getAttribute('normal');
  assert.ok(
    Array.from({ length: normals.count }, (_, index) =>
      normals.getX(index),
    ).some((x) => Math.abs(x) > 0.1),
  );
  assert.equal(plant.instances.leaves.material.emissive.getHex(), 0x000000);
  assert.equal(plant.instances.leaves.instanceColor, null);
  plant.dispose();
});

test('one leaf material applies the seasonal tint globally', () => {
  const plant = new Blackcurrant({
    seed: 40,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });

  const summer = plant.materials.leaf.color.clone();
  assert.equal(summer.getHex(), 0xffffff);
  assert.equal(plant.instances.leaves.instanceColor, null);

  plant.setTime({ dayOfYear: 85 });
  const spring = plant.materials.leaf.color.clone();
  assert.ok(spring.g > spring.r && spring.r > spring.b);
  assert.equal(plant.instances.leaves.instanceColor, null);

  plant.setTime({ dayOfYear: 288 });
  const autumn = plant.materials.leaf.color.clone();
  assert.ok(autumn.r > autumn.g && autumn.g > autumn.b);
  assert.equal(plant.instances.leaves.instanceColor, null);

  plant._setLeafMaterialPhenology({ leafProgress: 1, autumnProgress: 1 });
  assert.equal(plant.materials.leaf.color.getHex(), 0xff9756);

  plant.setTime({ dayOfYear: 175 });
  assert.ok(plant.materials.leaf.color.equals(summer));
  plant.dispose();
});

test('renderer keeps source organ dimensions in real-world metre ranges', () => {
  const plant = new Blackcurrant({
    seed: 41,
    maxYears: 16,
    ageYears: 5,
    dayOfYear: 175,
  });
  const leaves = [...plant.userData.sculptRuntime.maps.leaves.values()];
  const berries = [...plant.userData.sculptRuntime.maps.berries.values()];

  assert.ok(leaves.length > 0);
  assert.ok(berries.length > 0);
  assert.ok(leaves.every((leaf) => leaf.size >= 0.045 && leaf.size <= 0.12));
  assert.ok(
    berries.every(
      (berry) => berry.diameter >= 0.0085 && berry.diameter <= 0.0145,
    ),
  );
  plant.dispose();
});

test('renderer shows only axes and annual organs active in the evaluated snapshot', () => {
  const plant = new Blackcurrant({
    seed: 42,
    maxYears: 16,
    ageYears: 5,
    dayOfYear: 175,
  });
  const snapshot = plant._snapshot;
  const activeAxes = snapshot.canes.reduce(
    (sum, cane) => sum + cane.axes.length,
    0,
  );
  const expectedLeaves = snapshot.stats.leaves;
  const expectedBerries =
    snapshot.stats.greenBerries + snapshot.stats.ripeBerries;
  const stats = plant.stats();

  assert.strictEqual(plant.instances, plant._instancePool.meshes);
  assert.strictEqual(
    plant.userData.sculptRuntime,
    plant._runtime,
    'runtime inspection API remains available',
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(plant.userData, 'sculptRuntime').enumerable,
    false,
  );
  assert.doesNotMatch(JSON.stringify(plant.userData), /sculptRuntime/);
  assert.deepEqual(Object.keys(plant.userData.sculptRuntime), ['maps']);
  for (const map of Object.values(plant.userData.sculptRuntime.maps)) {
    for (const runtime of map.values()) {
      assert.equal(
        Object.keys(runtime).some((key) => /^active.*Index$/.test(key)),
        false,
      );
    }
  }

  assert.equal(stats.visibleAxes, activeAxes);
  assert.equal(Object.keys(plant.woodMeshes).length, 3);
  assert.ok(stats.woodyDrawCalls <= 3);
  assert.equal(
    stats.woodyDrawCalls,
    Object.values(plant.woodMeshes).filter((mesh) => mesh.visible).length,
  );
  assert.equal(stats.visibleLeaves, expectedLeaves);
  assert.equal(
    stats.visibleGreenBerries + stats.visibleRipeBerries,
    expectedBerries,
  );
  plant.dispose();
});

test('50-year instance pools submit only compact active prefixes', () => {
  const plant = new Blackcurrant({
    seed: 24051987,
    maxYears: 50,
    ageYears: 5,
    dayOfYear: 175,
  });
  const stats = plant.stats();

  assert.equal(plant.instances.leaves.count, stats.visibleLeaves);
  assert.equal(plant.instances.petioles.count, stats.visibleLeaves);
  assert.equal(plant.instances.flowers.count, stats.visibleFlowers);
  assert.equal(plant.instances.berries.count, stats.visibleBerries);
  assert.equal(plant.instances.calyces.count, stats.visibleBerries);

  let submittedTriangles = 0;
  let activeInstances = 0;
  let capacity = 0;
  let historicalInstances = 0;
  let matrixBytes = 0;
  for (const mesh of Object.values(plant.instances)) {
    assert.equal(mesh.count, mesh.userData.activeOrganCount);
    assert.ok(mesh.count <= mesh.userData.capacity);
    const geometryTriangles = mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : mesh.geometry.attributes.position.count / 3;
    submittedTriangles += mesh.count * geometryTriangles;
    activeInstances += mesh.count;
    capacity += mesh.userData.capacity;
    historicalInstances += mesh.userData.organCount;
    matrixBytes += mesh.instanceMatrix.array.byteLength;
    if (mesh.count > 0) {
      assert.deepEqual(mesh.instanceMatrix.updateRanges, [
        { start: 0, count: mesh.count * 16 },
      ]);
    }
  }

  assert.ok(activeInstances < capacity);
  assert.ok(capacity < historicalInstances / 20);
  assert.ok(matrixBytes < 1024 * 1024);
  assert.ok(submittedTriangles < 250_000);
  plant.dispose();
});

test('bounded pools cover ages 0-50, all seasons and both scenarios', () => {
  const seeds = [101, 'capacity-b', 24051987];
  const seasonalDays = [30, 112, 175, 288];

  for (const seed of seeds) {
    const plant = new Blackcurrant({
      seed,
      maxYears: 50,
      ageYears: 0,
      dayOfYear: seasonalDays[0],
    });
    for (const scenario of ['maintained', 'neglected']) {
      plant.setScenario(scenario);
      for (let ageYears = 0; ageYears <= 50; ageYears++) {
        for (const dayOfYear of seasonalDays) {
          plant.setTime({ ageYears, dayOfYear });
          for (const mesh of Object.values(plant.instances)) {
            assert.ok(
              mesh.count <= mesh.userData.capacity,
              `${seed}/${scenario}/${ageYears}/${dayOfYear}/${mesh.name}`,
            );
          }
        }
      }
    }
    plant.dispose();
  }
});

test('evaluated axes are packed by bark age with exact roots and tips', () => {
  const plant = new Blackcurrant({
    seed: 49,
    maxYears: 16,
    ageYears: 4,
    dayOfYear: 175,
  });
  const now = plant.ageYears + (plant.dayOfYear - 1) / 365;
  let youngAxes = 0;
  let oldAxes = 0;

  for (const cane of plant._snapshot.canes) {
    for (const axis of cane.axes) {
      const runtime = plant.userData.sculptRuntime.maps.axes.get(axis.id);
      const expectedRoot = axis.root ?? axis.points[0];
      const range = runtime.range;
      assert.ok(range);
      assert.ok(
        new THREE.Vector3()
          .fromArray(range.base)
          .distanceTo(new THREE.Vector3().copy(expectedRoot)) < 1e-9,
      );
      assert.ok(
        new THREE.Vector3()
          .fromArray(range.tip)
          .distanceTo(new THREE.Vector3().copy(axis.points.at(-1))) < 1e-8,
      );
      assert.equal(range.growthScale, axis.growthScale);

      const axisAge = now - axis.birthAgeYears;
      const expectedBand =
        axisAge < 1.2 ? 'young' : axisAge < 3.5 ? 'mature' : 'old';
      assert.equal(range.ageBand, expectedBand);
      assert.strictEqual(runtime.mesh, plant.woodMeshes[expectedBand]);
      assert.strictEqual(
        runtime.mesh.material,
        plant.materials[
          expectedBand === 'young'
            ? 'caneYoung'
            : expectedBand === 'mature'
              ? 'caneMature'
              : 'caneOld'
        ],
      );
      if (axisAge < 1.2) youngAxes++;
      if (axisAge >= 3.5) oldAxes++;
    }
  }

  assert.ok(youngAxes > 0);
  assert.ok(oldAxes > 0);
  for (const material of [
    plant.materials.caneYoung,
    plant.materials.caneMature,
    plant.materials.caneOld,
  ]) {
    assert.equal(material.isMeshStandardMaterial, true);
    assert.equal(material.map, null);
    assert.equal(material.normalMap, null);
    assert.equal(material.roughnessMap, null);
  }
  plant.dispose();
});

test('renderer uses one caller-supplied EZ-Tree bark material for every cane band', () => {
  const maps = {
    color: new THREE.Texture(),
    ao: null,
    normal: new THREE.Texture(),
    roughness: new THREE.Texture(),
  };
  let textureDisposals = 0;
  for (const texture of Object.values(maps).filter(Boolean)) {
    texture.addEventListener('dispose', () => textureDisposals++);
  }

  const plant = new Blackcurrant({
    seed: 'ez-tree-bark',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
    bark: {
      type: 'Bark001',
      tint: 0xceccbe,
      flatShading: false,
      textured: true,
      textureScale: { x: 0.5, y: 5 },
      maps,
    },
  });
  const material = plant.materials.caneYoung;

  assert.strictEqual(plant.materials.caneMature, material);
  assert.strictEqual(plant.materials.caneOld, material);
  assert.strictEqual(material.map, maps.color);
  assert.strictEqual(material.aoMap, null);
  assert.strictEqual(material.normalMap, maps.normal);
  assert.strictEqual(material.roughnessMap, maps.roughness);
  assert.strictEqual(material.metalnessMap, maps.roughness);
  assert.deepEqual(material.map.repeat.toArray(), [1, 0.2]);
  assert.deepEqual(material.normalMap.repeat.toArray(), [1, 0.2]);
  assert.deepEqual(material.roughnessMap.repeat.toArray(), [1, 0.2]);
  assert.equal(material.color.getHex(), 0xceccbe);

  plant.dispose();
  assert.equal(
    textureDisposals,
    0,
    'the EZ-Tree app texture cache, not the plant, owns shared maps',
  );
  for (const texture of Object.values(maps).filter(Boolean)) texture.dispose();
});

test('woody ranges migrate at the exact bark-age boundaries', () => {
  const plant = new Blackcurrant({
    seed: 'wood-age-boundaries',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const sourceSnapshot = plant._snapshot;
  const sourceAxis = sourceSnapshot.canes[0].axes[0];
  const now = sourceSnapshot.ageYears + (sourceSnapshot.dayOfYear - 1) / 365;
  const withAxisAge = (axisAge) => ({
    ...sourceSnapshot,
    canes: sourceSnapshot.canes.map((cane) => ({
      ...cane,
      axes: cane.axes.map((axis) =>
        axis.id === sourceAxis.id
          ? { ...axis, birthAgeYears: now - axisAge }
          : axis,
      ),
    })),
  });

  for (const [axisAge, expectedBand] of [
    [1.2 - 1e-8, 'young'],
    [1.2, 'mature'],
    [3.5 - 1e-8, 'mature'],
    [3.5, 'old'],
  ]) {
    plant._rebuildWoodyGeometry(withAxisAge(axisAge));
    const runtime = plant.userData.sculptRuntime.maps.axes.get(sourceAxis.id);
    assert.equal(runtime.range.ageBand, expectedBand);
    assert.strictEqual(runtime.mesh, plant.woodMeshes[expectedBand]);
  }

  plant._rebuildWoodyGeometry(sourceSnapshot);
  plant.dispose();
});

test('combined woody batches retain EZ seams, caps and parent-radius limits', () => {
  const plant = new Blackcurrant({
    seed: 'shared-woody-kernel',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const axes = plant.userData.sculptRuntime.maps.axes;
  let lateralCount = 0;

  for (const runtime of axes.values()) {
    if (!runtime.range) continue;
    const range = runtime.range;
    const geometry = runtime.mesh.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const { radialSegments, sectionCount, caps } = range;
    const ringStride = radialSegments + 1;

    for (let ring = 0; ring < sectionCount; ring++) {
      const first = range.vertexOffset + ring * ringStride;
      const seam = first + radialSegments;
      assert.deepEqual(
        [position.getX(seam), position.getY(seam), position.getZ(seam)],
        [position.getX(first), position.getY(first), position.getZ(first)],
      );
      assert.deepEqual(
        [normal.getX(seam), normal.getY(seam), normal.getZ(seam)],
        [normal.getX(first), normal.getY(first), normal.getZ(first)],
      );
      assert.equal(uv.getX(first), 0);
      assert.equal(uv.getX(seam), 1);
    }

    assert.ok(geometry.userData.axisRanges.includes(range));
    if (range.zeroGrowth) {
      assert.equal(range.vertexCount, 0);
      assert.equal(range.indexCount, 0);
      continue;
    }

    const sideVertexCount = sectionCount * ringStride;
    const sideIndexCount = (sectionCount - 1) * radialSegments * 6;
    const capCount =
      caps === BranchCap.Both ? 2 : caps === BranchCap.None ? 0 : 1;
    const capVertexCount = capCount * (radialSegments + 2);
    const capIndexCount = capCount * radialSegments * 3;
    assert.equal(range.vertexCount, sideVertexCount + capVertexCount);
    assert.equal(range.indexCount, sideIndexCount + capIndexCount);

    const base = new THREE.Vector3().fromArray(range.base);
    const firstRingVertex = new THREE.Vector3().fromBufferAttribute(
      position,
      range.vertexOffset,
    );
    assert.ok(
      Math.abs(firstRingVertex.distanceTo(base) - range.baseRadius) < 1e-6,
    );

    if (runtime.isPrimary) {
      assert.equal(caps, BranchCap.Both);
      const startCapCenter = new THREE.Vector3().fromBufferAttribute(
        position,
        range.vertexOffset + sideVertexCount,
      );
      const endCapCenter = new THREE.Vector3().fromBufferAttribute(
        position,
        range.vertexOffset + sideVertexCount + radialSegments + 2,
      );
      assert.ok(startCapCenter.distanceTo(base) < 1e-7);
      assert.ok(
        endCapCenter.distanceTo(new THREE.Vector3().fromArray(range.tip)) <
          1e-7,
      );
      continue;
    }

    lateralCount++;
    assert.equal(caps, BranchCap.End);
    const parentRuntime = axes.get(runtime.parentAxisId);
    assert.ok(parentRuntime);
    assert.ok(parentRuntime.range);
    const matureParentSection = sampleBranchSection(
      parentRuntime.sections,
      runtime.attachmentPosition,
    );
    assert.ok(
      Math.abs(
        range.parentRadiusAtAttachment -
          matureParentSection.radius * parentRuntime.range.radiusScale,
      ) < 1e-12,
    );
    assert.ok(
      range.baseRadius <=
        range.parentRadiusAtAttachment *
          TISEL_PROFILE.cane.childParentRadiusRatio +
          1e-12,
    );
    assert.ok(range.baseRadius < range.parentRadiusAtAttachment);

    // With only the terminal cap, the first cap center is the distal end.
    // A plugged lateral base would add a second cap's vertices and indices.
    const capCenter = new THREE.Vector3().fromBufferAttribute(
      position,
      range.vertexOffset + sideVertexCount,
    );
    assert.ok(
      capCenter.distanceTo(new THREE.Vector3().fromArray(range.tip)) < 1e-7,
    );
  }

  assert.ok(lateralCount > 0);
  assert.ok(
    plant.woodyGroup.children.filter(
      (child) => child.isMesh && !child.isInstancedMesh,
    ).length <= 3,
  );
  for (const mesh of Object.values(plant.woodMeshes)) {
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const range of mesh.userData.axisRanges) {
      assert.equal(range.vertexOffset, vertexOffset);
      assert.equal(range.indexOffset, indexOffset);
      const indices = mesh.geometry.index.array.slice(
        range.indexOffset,
        range.indexOffset + range.indexCount,
      );
      assert.ok(
        Array.from(indices).every(
          (index) =>
            index >= range.vertexOffset &&
            index < range.vertexOffset + range.vertexCount,
        ),
      );
      vertexOffset += range.vertexCount;
      indexOffset += range.indexCount;
    }
    assert.equal(vertexOffset, mesh.geometry.getAttribute('position').count);
    assert.equal(indexOffset, mesh.geometry.index.count);
  }
  plant.dispose();
});

test('PlantDetail remeshing is pure and preserves every woody endpoint', () => {
  const plant = new Blackcurrant({
    seed: 'blackcurrant-plant-detail',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const liveGeometries = Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      mesh.geometry,
    ]),
  );
  const revision = plant._woodRevision;
  const meshPasses = plant._woodMeshPasses;
  const full = plant.createGeometry();
  const coarse = plant.createGeometry({
    sectionStride: 3,
    segmentFactor: 0.6,
  });
  const coarseAxes = new Map();

  let fullVertices = 0;
  let coarseVertices = 0;
  for (const ageBand of ['young', 'mature', 'old']) {
    fullVertices += full[ageBand].getAttribute('position').count;
    coarseVertices += coarse[ageBand].getAttribute('position').count;
    const coarseRanges = new Map(
      coarse[ageBand].userData.axisRanges.map((range) => [range.axisId, range]),
    );
    for (const fullRange of full[ageBand].userData.axisRanges) {
      const coarseRange = coarseRanges.get(fullRange.axisId);
      assert.ok(coarseRange);
      assert.deepEqual(coarseRange.base, fullRange.base);
      assert.deepEqual(coarseRange.tip, fullRange.tip);
      coarseAxes.set(fullRange.axisId, {
        range: coarseRange,
        geometry: coarse[ageBand],
      });
    }
    assert.strictEqual(
      plant.woodMeshes[ageBand].geometry,
      liveGeometries[ageBand],
    );
  }
  assert.ok(coarseVertices < fullVertices);
  assert.equal(plant._woodRevision, revision);
  assert.equal(plant._woodMeshPasses, meshPasses);

  for (const runtime of plant.userData.sculptRuntime.maps.axes.values()) {
    if (!runtime.range || runtime.isPrimary || runtime.range.zeroGrowth)
      continue;
    const child = coarseAxes.get(runtime.id);
    const parent = coarseAxes.get(runtime.parentAxisId);
    assert.ok(child);
    assert.ok(parent);
    const landmark = parent.range.landmarks.find(
      (candidate) => candidate.organId === runtime.source.parentId,
    );
    assert.ok(landmark);
    assert.ok(landmark.sectionIndex >= 0);
    const position = parent.geometry.getAttribute('position');
    const ringStart =
      parent.range.vertexOffset +
      landmark.sectionIndex * (parent.range.radialSegments + 1);
    const ringCenter = new THREE.Vector3();
    for (let index = 0; index < parent.range.radialSegments; index++) {
      ringCenter.add(
        new THREE.Vector3().fromBufferAttribute(position, ringStart + index),
      );
    }
    ringCenter.multiplyScalar(1 / parent.range.radialSegments);
    assert.ok(
      ringCenter.distanceTo(new THREE.Vector3().fromArray(child.range.base)) <
        1e-6,
    );
  }

  for (const ageBand of ['young', 'mature', 'old']) {
    full[ageBand].dispose();
    coarse[ageBand].dispose();
  }

  plant.setDetail({ sectionStride: 3, segmentFactor: 0.6 });
  assert.equal(plant._woodRevision, revision + 1);
  const detailedRevision = plant._woodRevision;
  plant.setDetail({ sectionStride: 3, segmentFactor: 0.6 });
  assert.equal(plant._woodRevision, detailedRevision);
  plant.dispose();
});

test('leaf detail uses stable IDs, scales only leaves and repacks A-B-A', () => {
  const plant = new Blackcurrant({
    seed: 'stable-leaf-detail',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 175,
  });
  const fullIds = [...plant._activeLeafIds];
  const fullMatrices = captureActiveLeafMatrices(plant);
  const berriesBefore = captureInstances(plant.instances.berries);
  const woodBefore = Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      mesh.geometry,
    ]),
  );
  const meshPasses = plant._woodMeshPasses;

  plant.setDetail({ leafStride: 3, leafScale: 1.4 });
  const expectedIds = fullIds.filter(
    (id) =>
      Math.floor(
        keyedRandom(plant.seed, id, 'blackcurrant-plant-detail-leaf-stride') *
          3,
      ) === 0,
  );
  assert.deepEqual(plant._activeLeafIds, expectedIds);
  assert.equal(plant.stats().visibleLeaves, plant.instances.leaves.count);
  assert.equal(plant._woodMeshPasses, meshPasses);
  for (const [ageBand, geometry] of Object.entries(woodBefore)) {
    assert.strictEqual(plant.woodMeshes[ageBand].geometry, geometry);
  }
  assert.deepEqual(captureInstances(plant.instances.berries), berriesBefore);

  const detailedMatrices = captureActiveLeafMatrices(plant);
  for (const [id, detailedArray] of detailedMatrices) {
    const fullMatrix = new THREE.Matrix4().fromArray(fullMatrices.get(id));
    const detailedMatrix = new THREE.Matrix4().fromArray(detailedArray);
    const fullScale = new THREE.Vector3();
    const detailedScale = new THREE.Vector3();
    fullMatrix.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      fullScale,
    );
    detailedMatrix.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      detailedScale,
    );
    assert.ok(Math.abs(detailedScale.x / fullScale.x - 1.4) < 1e-6);
  }

  const detailA = {
    ids: structuredClone(plant._activeLeafIds),
    matrices: captureActiveLeafMatrices(plant),
  };
  plant.setDetail({ leafStride: 1, leafScale: 1 });
  assert.deepEqual(plant._activeLeafIds, fullIds);
  plant.setDetail({ leafStride: 3, leafScale: 1.4 });
  assert.deepEqual(plant._activeLeafIds, detailA.ids);
  assert.deepEqual(captureActiveLeafMatrices(plant), detailA.matrices);
  assert.deepEqual(captureInstances(plant.instances.berries), berriesBefore);
  plant.dispose();
});

test('simulation years are integer calendar years and updates stay transactional', () => {
  assert.throws(
    () => new Blackcurrant({ maxYears: 8, ageYears: 4.2 }),
    /integer/,
  );

  const plant = new Blackcurrant({ maxYears: 8, ageYears: 4, dayOfYear: 175 });
  const before = plant.stats();
  assert.throws(() => plant.setTime({ ageYears: 4.2 }), /integer/);
  assert.equal(plant.ageYears, 4);
  assert.deepEqual(plant.stats(), before);
  assert.throws(
    () => plant.addEvent({ type: 'inspection', ageYears: 4.2 }),
    /integer/,
  );
  plant.dispose();
});

test('disposing a shrub releases every owned GPU allocation exactly once', () => {
  const plant = new Blackcurrant({ maxYears: 8, ageYears: 5 });
  const resources = [
    ...plant._resources.instancedMeshes,
    ...plant._resources.geometries,
    ...plant._resources.materials,
  ];
  const disposeCounts = new Map(resources.map((resource) => [resource, 0]));
  for (const resource of resources) {
    resource.addEventListener('dispose', () => {
      disposeCounts.set(resource, disposeCounts.get(resource) + 1);
    });
  }

  plant.dispose();
  plant.dispose();

  assert.ok(resources.length > Object.keys(plant.instances).length);
  assert.ok([...disposeCounts.values()].every((count) => count === 1));
  assert.equal(plant._resources.disposed, true);
  assert.equal(plant._resources.instancedMeshes.size, 0);
  assert.equal(plant._resources.geometries.size, 0);
  assert.equal(plant._resources.materials.size, 0);
  assert.equal(plant.children.length, 0);
});

test('replaced woody buffers are released once and removed from ownership', () => {
  const plant = new Blackcurrant({
    seed: 'wood-replacement-disposal',
    maxYears: 8,
    ageYears: 4,
    dayOfYear: 112,
  });
  const replaced = Object.values(plant.woodMeshes).map((mesh) => mesh.geometry);
  const replacedDisposals = new Map(replaced.map((geometry) => [geometry, 0]));
  for (const geometry of replaced) {
    geometry.addEventListener('dispose', () => {
      replacedDisposals.set(geometry, replacedDisposals.get(geometry) + 1);
    });
  }

  plant.setTime({ ageYears: 7, dayOfYear: 288 });
  assert.ok([...replacedDisposals.values()].every((count) => count === 1));
  assert.ok(
    replaced.every((geometry) => !plant._resources.geometries.has(geometry)),
  );

  const current = Object.values(plant.woodMeshes).map((mesh) => mesh.geometry);
  const currentDisposals = new Map(current.map((geometry) => [geometry, 0]));
  for (const geometry of current) {
    geometry.addEventListener('dispose', () => {
      currentDisposals.set(geometry, currentDisposals.get(geometry) + 1);
    });
  }
  plant.dispose();
  plant.dispose();

  assert.ok([...replacedDisposals.values()].every((count) => count === 1));
  assert.ok([...currentDisposals.values()].every((count) => count === 1));
});

test('a lateral is zero-length on its exact modeled birth day', () => {
  const model = createTiselModel({ seed: 'axis-birth-render', maxYears: 8 });
  const lateral = model.canes
    .flatMap((cane) => cane.axes)
    .find((axis) => axis.order === 1);
  const birthYear = Math.floor(lateral.birthAgeYears);
  const birthDay = Math.min(
    365,
    Math.ceil((lateral.birthAgeYears - birthYear) * 365) + 1,
  );
  const plant = new Blackcurrant({
    model,
    ageYears: birthYear,
    dayOfYear: birthDay,
  });
  const axis = plant._snapshot.canes
    .flatMap((cane) => cane.axes)
    .find((candidate) => candidate.id === lateral.id);
  const runtime = plant.userData.sculptRuntime.maps.axes.get(lateral.id);

  assert.equal(axis.growthScale, 0);
  assert.ok(runtime.range);
  assert.equal(runtime.range.zeroGrowth, true);
  assert.equal(runtime.range.vertexCount, 0);
  assert.equal(runtime.range.indexCount, 0);
  assert.deepEqual(runtime.range.base, runtime.range.tip);
  assert.ok(
    new THREE.Vector3()
      .fromArray(runtime.range.base)
      .distanceTo(new THREE.Vector3().copy(axis.points[0])) < 1e-9,
  );
  plant.dispose();
});

test('a supplied model controls the renderer horizon and default age', () => {
  const model = createTiselModel({ seed: 'short-horizon', maxYears: 1 });
  const plant = new Blackcurrant({ model });

  assert.equal(plant.maxYears, 1);
  assert.equal(plant.ageYears, 1);
  assert.doesNotThrow(() => plant.setTime({ ageYears: 9, dayOfYear: 175 }));
  assert.equal(plant.ageYears, 1);
  assert.equal(plant.stats().ageYears, 1);
  plant.dispose();
});

test('legacy graph-shaped model fallbacks are rejected at the public boundary', () => {
  assert.throws(
    () =>
      new Blackcurrant({
        model: {
          kind: 'blackcurrant-growth-model',
          cultivar: 'Tisel',
          seed: 'legacy-graph',
          maxYears: 8,
          graph: { canes: [] },
        },
      }),
    /Expected a model returned by createTiselModel/,
  );
});

test('string seeds stay deterministic without collapsing to one fallback seed', () => {
  const first = new Blackcurrant({
    seed: 'garden-a',
    maxYears: 4,
    ageYears: 3,
    dayOfYear: 175,
  });
  const repeated = new Blackcurrant({
    seed: 'garden-a',
    maxYears: 4,
    ageYears: 3,
    dayOfYear: 175,
  });
  const different = new Blackcurrant({
    seed: 'garden-b',
    maxYears: 4,
    ageYears: 3,
    dayOfYear: 175,
  });

  assert.equal(first.seed, 'garden-a');
  assert.deepEqual(captureRenderState(first), captureRenderState(repeated));
  assert.notDeepEqual(
    captureInstances(first.instances.leaves),
    captureInstances(different.instances.leaves),
  );

  first.dispose();
  repeated.dispose();
  different.dispose();
});

test('time scrubbing A to B to A reproduces the same geometry state', () => {
  const plant = new Blackcurrant({
    seed: 43,
    maxYears: 16,
    ageYears: 4,
    dayOfYear: 112,
  });
  const before = captureRenderState(plant);
  const woodyBefore = captureWoodyBytes(plant);
  const originalGeometries = Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      mesh.geometry,
    ]),
  );
  const revision = plant._woodRevision;

  plant.setTime({ ageYears: 4, dayOfYear: 112 });
  assert.equal(plant._woodRevision, revision);
  for (const [ageBand, geometry] of Object.entries(originalGeometries)) {
    assert.strictEqual(plant.woodMeshes[ageBand].geometry, geometry);
  }

  plant.setTime({ ageYears: 11, dayOfYear: 288 });
  plant.setTime({ ageYears: 4, dayOfYear: 112 });
  const after = captureRenderState(plant);

  assert.deepEqual(after, before);
  assert.deepEqual(captureWoodyBytes(plant), woodyBefore);
  for (const [ageBand, geometry] of Object.entries(originalGeometries)) {
    assert.notStrictEqual(plant.woodMeshes[ageBand].geometry, geometry);
  }
  plant.dispose();
});

test('a day-only woody no-op skips the CPU mesh pass', () => {
  const plant = new Blackcurrant({
    seed: 'wood-day-noop',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 300,
  });
  const signature = plant._woodSnapshotKey;
  let matchingDay = null;
  for (let dayOfYear = 301; dayOfYear <= 365; dayOfYear++) {
    const snapshot = evaluateTiselModel(plant.model, {
      ageYears: plant.ageYears,
      dayOfYear,
      events: plant.events,
      scenario: plant.scenario,
      trialYear: plant.trialYear,
      offsetDays: plant.offsetDays,
    });
    if (plant._planWoodySnapshot(snapshot).signature === signature) {
      matchingDay = dayOfYear;
      break;
    }
  }
  assert.ok(matchingDay);

  const geometries = Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      mesh.geometry,
    ]),
  );
  const meshPasses = plant._woodMeshPasses;
  plant.setTime({ ageYears: plant.ageYears, dayOfYear: matchingDay });
  assert.equal(plant._woodMeshPasses, meshPasses);
  for (const [ageBand, geometry] of Object.entries(geometries)) {
    assert.strictEqual(plant.woodMeshes[ageBand].geometry, geometry);
  }
  plant.dispose();
});

test('failed three-band allocation leaves every live wood batch unchanged', () => {
  const plant = new Blackcurrant({
    seed: 'transactional-wood-batch',
    maxYears: 8,
    ageYears: 4,
    dayOfYear: 112,
  });
  const liveGeometries = Object.fromEntries(
    Object.entries(plant.woodMeshes).map(([ageBand, mesh]) => [
      ageBand,
      mesh.geometry,
    ]),
  );
  const runtimeRanges = new Map(
    [...plant.userData.sculptRuntime.maps.axes].map(([id, runtime]) => [
      id,
      runtime.range,
    ]),
  );
  const temporaryDisposals = [];
  const originalFactory = plant._createWoodBatchGeometry;
  plant._createWoodBatchGeometry = function (ageBand, batch, detail) {
    if (ageBand === 'mature')
      throw new Error('forced batch allocation failure');
    const geometry = originalFactory.call(this, ageBand, batch, detail);
    const record = { geometry, disposals: 0 };
    geometry.addEventListener('dispose', () => record.disposals++);
    temporaryDisposals.push(record);
    return geometry;
  };
  const nextSnapshot = evaluateTiselModel(plant.model, {
    ageYears: 7,
    dayOfYear: 288,
    events: plant.events,
    scenario: plant.scenario,
    trialYear: plant.trialYear,
    offsetDays: plant.offsetDays,
  });

  assert.throws(
    () => plant._rebuildWoodyGeometry(nextSnapshot),
    /forced batch allocation failure/,
  );
  plant._createWoodBatchGeometry = originalFactory;
  assert.ok(temporaryDisposals.length > 0);
  assert.ok(temporaryDisposals.every((record) => record.disposals === 1));
  for (const [ageBand, geometry] of Object.entries(liveGeometries)) {
    assert.strictEqual(plant.woodMeshes[ageBand].geometry, geometry);
    assert.ok(plant._resources.geometries.has(geometry));
  }
  for (const [id, range] of runtimeRanges) {
    assert.strictEqual(
      plant.userData.sculptRuntime.maps.axes.get(id).range,
      range,
    );
  }
  plant.dispose();
});

test('blackcurrant uses the shared instancing-safe EZ-Tree leaf wind', () => {
  const canonical = new LeafWind();
  assert.deepEqual(
    canonical.uniforms.uWindStrength.value.toArray(),
    [0.5, 0, 0.5],
  );
  assert.equal(canonical.uniforms.uWindFrequency.value, 0.5);
  assert.equal(canonical.uniforms.uWindScale.value, 70);

  const plant = new Blackcurrant({
    seed: 44,
    maxYears: 16,
    ageYears: 5,
    dayOfYear: 175,
  });

  const before = captureInstances(plant.instances.leaves);
  const version = plant.instances.leaves.instanceMatrix.version;
  plant.update(0.016, 7.5);
  assert.equal(plant._leafWind.time, 7.5);

  const compile = (material, template) => {
    const shader = {
      uniforms: THREE.UniformsUtils.clone(template.uniforms),
      vertexShader: template.vertexShader,
      fragmentShader: template.fragmentShader,
    };
    material.onBeforeCompile(shader, null);
    return shader;
  };
  const surface = compile(plant.materials.leaf, THREE.ShaderLib.standard);
  const depth = compile(plant.materials.leafDepth, THREE.ShaderLib.depth);
  const distance = compile(
    plant.materials.leafDistance,
    THREE.ShaderLib.distanceRGBA,
  );

  for (const shader of [surface, depth, distance]) {
    assert.match(shader.vertexShader, /leafWindSimplex3/);
    assert.match(shader.vertexShader, /0\.5 \* sin/);
    assert.match(shader.vertexShader, /0\.3 \* sin/);
    assert.match(shader.vertexShader, /0\.2 \* sin/);
    assert.match(shader.vertexShader, /2\.0 \* 3\.14 \* leafWindSimplex3/);
    assert.match(shader.vertexShader, /uv\.y \* leafWindLocalStrength/);
    assert.match(shader.vertexShader, /uv\.y \* uWindStrength/);
    assert.match(shader.vertexShader, /#ifdef USE_INSTANCING/);
    assert.match(
      shader.vertexShader,
      /leafWindPhasePosition = instanceMatrix \* leafWindPhasePosition/,
    );
    assert.equal(
      shader.vertexShader.match(/#include <project_vertex>/g)?.length,
      1,
    );
    assert.ok(
      shader.vertexShader.indexOf('transformed +=') <
        shader.vertexShader.indexOf('#include <project_vertex>'),
    );
    assert.strictEqual(shader.uniforms.uTime, plant._leafWind.uniforms.uTime);
    assert.strictEqual(
      shader.uniforms.uWindStrength,
      plant._leafWind.uniforms.uWindStrength,
    );
    assert.equal(shader.uniforms.uTime.value, 7.5);
  }

  const mesh = plant.instances.leaves;
  assert.strictEqual(mesh.customDepthMaterial, plant.materials.leafDepth);
  assert.strictEqual(mesh.customDistanceMaterial, plant.materials.leafDistance);
  const uv = mesh.geometry.getAttribute('uv');
  assert.equal(
    Math.min(...Array.from({ length: uv.count }, (_, index) => uv.getY(index))),
    0,
  );

  const leaves = [...plant.userData.sculptRuntime.maps.leaves.values()];
  assert.ok(leaves.length > 0);
  assert.ok(leaves.every((leaf) => !('windPhase' in leaf)));

  plant.update(0.016, 7.5);
  assert.equal(plant._leafWind.time, 7.5);
  assert.deepEqual(captureInstances(plant.instances.leaves), before);
  assert.equal(plant.instances.leaves.instanceMatrix.version, version);

  plant.update(0.25);
  assert.equal(plant._leafWind.time, 7.75);

  let depthDisposals = 0;
  let distanceDisposals = 0;
  plant.materials.leafDepth.addEventListener('dispose', () => depthDisposals++);
  plant.materials.leafDistance.addEventListener(
    'dispose',
    () => distanceDisposals++,
  );
  plant.dispose();
  assert.equal(depthDisposals, 1);
  assert.equal(distanceDisposals, 1);
});

test('management scenario and care events visibly affect the persistent plant', () => {
  const plant = new Blackcurrant({
    seed: 45,
    maxYears: 16,
    ageYears: 10,
    dayOfYear: 175,
  });
  const maintainedCanes = plant.stats().visibleCanes;
  plant.setScenario('neglected');
  const neglectedCanes = plant.stats().visibleCanes;
  assert.ok(neglectedCanes > maintainedCanes);

  plant.setScenario('maintained');
  plant.setTime({ ageYears: 10, dayOfYear: 30 });
  const beforePrune = plant.stats().visibleCanes;
  const event = plant.pruneOldestCane();
  assert.equal(event.type, 'prune');
  assert.equal(plant.stats().visibleCanes, beforePrune - 1);
  const removedCane = plant.model.canes.find(
    (cane) => cane.id === event.caneId,
  );
  const renderedAfterPrune = new Set(
    Object.values(plant.woodMeshes).flatMap((mesh) =>
      mesh.userData.axisRanges.map((range) => range.axisId),
    ),
  );
  assert.ok(removedCane.axes.every((axis) => !renderedAfterPrune.has(axis.id)));
  assert.ok(
    removedCane.axes.every((axis) => {
      const runtime = plant.userData.sculptRuntime.maps.axes.get(axis.id);
      return runtime.mesh == null && runtime.range == null;
    }),
  );
  plant.setTime({ ageYears: 9, dayOfYear: 30 });
  assert.ok(plant.stats().visibleCanes >= beforePrune);
  assert.ok(
    plant.userData.sculptRuntime.maps.axes.get(removedCane.axes[0].id).range,
  );
  plant.dispose();
});

test('renewal pruning is dormant, age-gated and capped at one third per year', () => {
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
  assert.equal(plant.events.length, 0);

  plant.setTime({ ageYears: 3, dayOfYear: 30 });
  assert.equal(
    plant.pruneOldestCane().reason,
    'plant-too-young-for-renewal-pruning',
  );
  assert.equal(plant.events.length, 0);

  plant.setTime({ ageYears: 10, dayOfYear: 30 });
  const before = plant.stats().visibleCanes;
  const maximum = Math.max(1, Math.floor(before / 3));
  for (let index = 0; index < maximum; index++) {
    assert.equal(plant.pruneOldestCane().type, 'prune');
  }
  assert.equal(plant.stats().visibleCanes, before - maximum);
  assert.equal(
    plant.pruneOldestCane().reason,
    'maintained-six-cane-minimum-reached',
  );
  assert.equal(plant.events.length, maximum);
  plant.dispose();
});

test('recommended pruning never drops a maintained stool below six canes', () => {
  const plant = new Blackcurrant({
    seed: 1,
    maxYears: 16,
    ageYears: 12,
    dayOfYear: 30,
  });

  while (plant.pruneOldestCane().type === 'prune') {
    // Exercise the public repeated-action path until the guard rejects it.
  }
  assert.ok(plant.stats().visibleCanes >= 6);
  assert.equal(
    plant.pruneOldestCane().reason,
    'maintained-six-cane-minimum-reached',
  );
  plant.dispose();
});

test('back-dated pruning selects a cane that exists at the event time', () => {
  const plant = new Blackcurrant({
    seed: 48,
    maxYears: 16,
    ageYears: 12,
    dayOfYear: 30,
  });
  const targetBefore = evaluateTiselModel(plant.model, {
    ageYears: 5,
    dayOfYear: 30,
    events: [],
    scenario: 'maintained',
  });

  const event = plant.pruneOldestCane({ ageYears: 5, dayOfYear: 30 });
  const sourceCane = plant.model.canes.find((cane) => cane.id === event.caneId);
  const targetAfter = evaluateTiselModel(plant.model, {
    ageYears: 5,
    dayOfYear: 30,
    events: plant.events,
    scenario: 'maintained',
  });

  assert.equal(event.type, 'prune');
  assert.ok(sourceCane);
  assert.ok(sourceCane.birthAgeYears <= 5);
  assert.equal(targetAfter.canes.length, targetBefore.canes.length - 1);
  plant.dispose();
});

test('same-year pruning respects the live cane floor independent of scheduling order', () => {
  const createPlant = () =>
    new Blackcurrant({
      seed: 'out-of-order-prune',
      maxYears: 16,
      ageYears: 12,
      dayOfYear: 30,
    });
  const assertYearEndFloor = (plant) => {
    const yearEnd = evaluateTiselModel(plant.model, {
      ageYears: 12,
      dayOfYear: 365,
      events: plant.events,
      scenario: 'maintained',
    });
    assert.ok(yearEnd.canes.length >= 6);
    assert.equal(plant.events.length, 1);
  };

  const futureFirst = createPlant();
  assert.equal(
    futureFirst.pruneOldestCane({ ageYears: 12, dayOfYear: 330 }).type,
    'prune',
  );
  assert.equal(
    futureFirst.pruneOldestCane({ ageYears: 12, dayOfYear: 30 }).reason,
    'maintained-six-cane-minimum-reached',
  );
  assertYearEndFloor(futureFirst);
  futureFirst.dispose();

  const pastFirst = createPlant();
  assert.equal(
    pastFirst.pruneOldestCane({ ageYears: 12, dayOfYear: 30 }).reason,
    'maintained-six-cane-minimum-reached',
  );
  assert.equal(
    pastFirst.pruneOldestCane({ ageYears: 12, dayOfYear: 330 }).type,
    'prune',
  );
  assertYearEndFloor(pastFirst);
  pastFirst.dispose();
});

test('harvest is only recorded when ripe fruit remains', () => {
  const plant = new Blackcurrant({
    seed: 46,
    maxYears: 16,
    ageYears: 5,
    dayOfYear: 145,
  });
  const early = plant.harvest();
  assert.equal(early.event, null);
  assert.equal(plant.events.length, 0);

  plant.setTime({ ageYears: 5, dayOfYear: 175 });
  const ripeEstimate = plant.stats().estimatedYieldKg;
  const picked = plant.harvest();
  assert.ok(picked.event);
  assert.equal(picked.amountKg, ripeEstimate);
  assert.equal(plant.events.length, 1);
  assert.equal(plant.stats().visibleRipeBerries, 0);

  const repeated = plant.harvest();
  assert.equal(repeated.event, null);
  assert.equal(plant.events.length, 1);
  plant.dispose();
});

test('invalid harvest weights and inconsistent care events are rejected', () => {
  const plant = new Blackcurrant({
    seed: 50,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestStart,
  });
  const ripeBefore = plant.stats().visibleRipeBerries;

  assert.throws(() => plant.harvest({ amountKg: -2 }), /amountKg/);
  assert.throws(() => plant.harvest({ amountKg: Infinity }), /amountKg/);
  assert.throws(
    () => plant.addEvent({ type: 'harvest', amountKg: -2 }),
    /amountKg/,
  );
  assert.throws(
    () =>
      new Blackcurrant({
        seed: 51,
        maxYears: 8,
        events: [{ type: 'harvest', amountKg: -2 }],
      }),
    /amountKg/,
  );
  assert.equal(plant.events.length, 0);
  assert.equal(plant.stats().visibleRipeBerries, ripeBefore);

  const care = plant.addEvent({
    type: 'inspection',
    ageYears: undefined,
    dayOfYear: undefined,
  });
  assert.equal(care.ageYears, plant.ageYears);
  assert.equal(care.dayOfYear, plant.dayOfYear);
  assert.throws(() => plant.addEvent({ ...care }), /Duplicate/);
  assert.throws(
    () => plant.addEvent({ type: 'inspection', ageYears: NaN }),
    /ageYears/,
  );
  plant.dispose();
});

test('renderer and harvest agree at the first model-ripe day', () => {
  const plant = new Blackcurrant({
    seed: 48,
    maxYears: 8,
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestStart,
  });

  assert.ok(plant._snapshot.stats.ripeBerries > 0);
  assert.equal(
    plant.stats().visibleRipeBerries,
    plant._snapshot.stats.ripeBerries,
  );
  assert.ok(plant.harvest().event);
  plant.dispose();
});

test('renderer organ counts match model visibility at phase boundaries', () => {
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
    assert.equal(stats.visibleFlowerBuds, plant._snapshot.stats.flowerBuds);
    assert.equal(stats.visibleFlowers, plant._snapshot.stats.flowers);
    if (dayOfYear < TISEL_CALENDAR.floweringStart) {
      assert.equal(plant.instances.flowers.count, 0);
      assert.ok(plant.instances.flowerBuds.count > 0);
    }
    assert.equal(
      stats.visibleGreenBerries + stats.visibleRipeBerries,
      plant._snapshot.stats.greenBerries + plant._snapshot.stats.ripeBerries,
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

test('renderer refuses unsupported cultivar labels and matches modeled cane girth', () => {
  assert.throws(
    () => new Blackcurrant({ cultivar: 'Ben Hope', maxYears: 8 }),
    /only.*Tisel/i,
  );
  const plant = new Blackcurrant({
    seed: 'girth-contract',
    maxYears: 8,
    ageYears: 0,
    dayOfYear: 1,
  });
  for (const cane of plant._snapshot.canes) {
    const sourceCane = plant.model.canes.find(
      (candidate) => candidate.id === cane.id,
    );
    const primary = cane.axes[0];
    const runtime = plant.userData.sculptRuntime.maps.axes.get(primary.id);
    assert.ok(sourceCane);
    assert.ok(runtime);
    assert.ok(runtime.range);
    assert.ok(Math.abs(cane.baseRadiusM - runtime.range.baseRadius) < 1e-9);
  }
  plant.dispose();
});

test('dormant pruning follows the selected phenology profile transactionally', () => {
  for (const { offsetDays, dayOfYear } of [
    { offsetDays: 45, dayOfYear: 80 },
    { offsetDays: -45, dayOfYear: 280 },
  ]) {
    const plant = new Blackcurrant({
      seed: `profile-prune:${offsetDays}`,
      maxYears: 8,
      ageYears: 5,
      dayOfYear,
      offsetDays,
    });
    assert.equal(plant.stats().phenology.phase, 'dormant');
    assert.ok(
      plant.stats().careHints.some((hint) => hint.id === 'prune-old-canes'),
    );
    assert.equal(plant.pruneOldestCane().type, 'prune');
    plant.dispose();
  }
});

test('an overripe harvest preserves already dropped fruit as crop loss', () => {
  const plant = new Blackcurrant({
    seed: 'overripe-harvest',
    maxYears: 8,
    ageYears: 5,
    dayOfYear: 195,
  });
  const before = plant.stats();
  assert.ok(before.visibleRipeBerries > 0);
  assert.ok(before.droppedBerries > 0);
  const harvest = plant.harvest();
  const after = plant.stats();
  assert.equal(harvest.amountKg, before.estimatedYieldKg);
  assert.equal(after.harvestedBerries, before.visibleRipeBerries);
  assert.equal(after.droppedBerries, before.droppedBerries);
  assert.equal(after.visibleRipeBerries, 0);

  plant.setTime({ ageYears: 5, dayOfYear: TISEL_CALENDAR.fruitDropEnd });
  const later = plant.stats();
  assert.equal(later.harvestedBerries, after.harvestedBerries);
  assert.equal(later.droppedBerries, after.droppedBerries);
  plant.dispose();
});
