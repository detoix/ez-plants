import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';

import * as publicApi from '../src/lib/index.js';
import { Echinacea } from '../src/lib/plants/echinacea/echinacea.js';
import { createMagnusHeadGeometry } from '../src/lib/plants/echinacea/geometry.js';
import {
  MAGNUS_PROFILE,
  MAGNUS_SOURCES,
} from '../src/lib/plants/echinacea/magnus.js';
import {
  createMagnusModel,
  evaluateMagnusModel,
} from '../src/lib/plants/echinacea/model.js';
import {
  getMagnusCalendar,
  getMagnusPhenology,
  MAGNUS_CALENDAR,
} from '../src/lib/plants/echinacea/phenology.js';

const MESH_NAMES = Object.freeze({
  wood: 'Echinacea_Wood',
  stems: 'Echinacea_HerbaceousStems',
  leaves: 'Echinacea_RoughAlternateLeaves',
  heads: 'Echinacea_Magnus_Capitula',
});

const APP_SOURCE_URL = new URL('../src/app/plants.js', import.meta.url);
const REACT_SOURCE_URL = new URL('../src/react/index.tsx', import.meta.url);
const TYPES_SOURCE_URL = new URL('../types/plants.d.ts', import.meta.url);

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

function captureInstances(plant) {
  return meshes(plant)
    .filter((mesh) => mesh.isInstancedMesh)
    .map((mesh) => ({
      name: mesh.name,
      count: mesh.count,
      matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
      colours: mesh.instanceColor
        ? Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3))
        : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

function compileShaderLib(material, shaderLib) {
  const shader = {
    uniforms: {},
    vertexShader: shaderLib.vertexShader,
    fragmentShader: shaderLib.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

function triangleCount(geometry) {
  const attribute = geometry.index ?? geometry.getAttribute('position');
  return attribute ? attribute.count / 3 : 0;
}

function measureBands(plant) {
  return plant.lodLevels.map((_, level) => {
    plant.setLevel(level);
    let triangles = 0;
    let draws = 0;
    for (const mesh of meshes(plant)) {
      const count = mesh.isInstancedMesh ? mesh.count : 1;
      if (!mesh.visible || count === 0) continue;
      draws += 1;
      triangles += triangleCount(mesh.geometry) * count;
    }
    assert.equal(plant.stats().drawCalls, draws);
    return { draws, triangles: Math.round(triangles) };
  });
}

test('Magnus profile preserves the source-backed cultivar-defining traits', () => {
  assert.equal(MAGNUS_PROFILE.species, 'Echinacea purpurea');
  assert.equal(MAGNUS_PROFILE.cultivar, 'Magnus');
  assert.equal(MAGNUS_PROFILE.commonNamePl, 'Jeżówka purpurowa');
  assert.equal(MAGNUS_PROFILE.introductionYear, 1985);
  assert.equal(MAGNUS_PROFILE.architecture.woody, false);
  assert.equal(MAGNUS_PROFILE.growth.topGrowthAnnual, true);
  assert.equal(MAGNUS_PROFILE.leaf.persistentThroughWinter, false);
  assert.match(MAGNUS_PROFILE.leaf.arrangement, /alternate/i);
  assert.match(MAGNUS_PROFILE.leaf.shape, /rough|toothed/i);
  assert.deepEqual(MAGNUS_PROFILE.flowerHead.diameterM, [0.09, 0.11]);
  assert.deepEqual(MAGNUS_PROFILE.flowerHead.rayCount, [18, 22]);
  assert.match(MAGNUS_PROFILE.flowerHead.rayPosture, /horizontal/i);
  assert.equal(
    MAGNUS_PROFILE.architecture.maximumFloweringAxes,
    MAGNUS_PROFILE.architecture.maximumPrimaryShoots + 3,
  );

  for (const source of Object.values(MAGNUS_SOURCES)) {
    if (source.url) assert.match(source.url, /^https:\/\//);
    assert.ok(source.supports.length > 30);
  }
});

test('root, demo, React and declaration entry points expose the same Magnus contract', () => {
  assert.strictEqual(publicApi.Echinacea, Echinacea);
  assert.strictEqual(publicApi.MAGNUS_PROFILE, MAGNUS_PROFILE);
  assert.strictEqual(publicApi.MAGNUS_SOURCES, MAGNUS_SOURCES);
  for (const helper of [
    'getMagnusCalendar',
    'getMagnusPhenology',
    'getMagnusCareHints',
    'createMagnusModel',
    'evaluateMagnusModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function', `${helper} must export`);
  }

  const types = readFileSync(TYPES_SOURCE_URL, 'utf8');
  for (const declaration of [
    'export type MagnusSeasonProfile',
    'export interface MagnusPhenology',
    'export interface EchinaceaOptions',
    'export interface EchinaceaStats',
    'export declare class Echinacea extends PlantRenderer',
    'export declare function createMagnusModel',
    'export declare function evaluateMagnusModel',
  ]) {
    assert.ok(types.includes(declaration), `missing type: ${declaration}`);
  }
  const options = types.slice(
    types.indexOf('export interface EchinaceaOptions'),
    types.indexOf('export interface EchinaceaStats'),
  );
  assert.match(options, /ageYears\?: number/);
  assert.match(options, /dayOfYear\?: number/);
  assert.match(options, /leafWind\?: LeafWindOptions/);
  assert.match(options, /lodLevels\?: PlantLODLevel\[\]/);

  const react = readFileSync(REACT_SOURCE_URL, 'utf8');
  assert.match(react, /export interface EchinaceaProps/);
  assert.match(react, /export function EchinaceaPlant\s*\(/);
  assert.match(react, /new Echinacea\s*\(\{/);
  assert.match(react, /EchinaceaPlant as Echinacea/);
  assert.match(react, /\{ ageYears, dayOfYear, seasonProfile, offsetDays \}/);

  const app = readFileSync(APP_SOURCE_URL, 'utf8');
  assert.match(app, /echinacea: Object\.freeze\(\{/);
  assert.match(app, /cultivar: 'Magnus'/);
  assert.match(app, /leafWind: state\.leafWind/);
  assert.match(app, /ageYears: state\.age/);
  assert.match(app, /dayOfYear: state\.day/);
});

test('stable annual growth is deterministic and matures without reallocating its graph', () => {
  const options = { seed: 'magnus-stable-model', maxYears: 20 };
  const first = createMagnusModel(options);
  const repeat = createMagnusModel(options);
  const different = createMagnusModel({ ...options, seed: 'another-seed' });

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, different);
  assert.equal(first.kind, 'echinacea-magnus-growth-model');
  assert.equal(
    first.shoots.length,
    MAGNUS_PROFILE.architecture.maximumPrimaryShoots,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.shoots), true);

  const allIds = first.shoots.flatMap((shoot) => [
    shoot.id,
    ...shoot.axes.map((axis) => axis.id),
    ...shoot.leaves.map((leaf) => leaf.id),
    ...shoot.heads.map((head) => head.id),
  ]);
  assert.equal(new Set(allIds).size, allIds.length);

  const ages = [0, 1, 2, 3].map((ageYears) =>
    evaluateMagnusModel(first, { ageYears, dayOfYear: 215 }),
  );
  assert.deepEqual(
    ages.map((snapshot) => snapshot.stats.visibleShoots),
    MAGNUS_PROFILE.architecture.shootCountAnchors.map((anchor) => anchor[1]),
  );
  for (const snapshot of ages) {
    assert.equal(snapshot.stats.visibleShoots, snapshot.shoots.length);
    assert.equal(snapshot.stats.visibleAxes, snapshot.axes.length);
    assert.equal(snapshot.stats.visibleLeaves, snapshot.leaves.length);
    assert.equal(snapshot.stats.visibleHeads, snapshot.heads.length);
  }
  for (let index = 1; index < ages.length; index += 1) {
    assert.ok(
      ages[index].stats.visibleHeads >= ages[index - 1].stats.visibleHeads,
    );
    assert.ok(
      ages[index].dimensions.heightM >= ages[index - 1].dimensions.heightM,
    );
  }

  const mature = ages.at(-1);
  assert.equal(
    mature.stats.visibleHeads,
    MAGNUS_PROFILE.architecture.maximumFloweringAxes,
  );
  assert.ok(
    mature.dimensions.heightM >=
      MAGNUS_PROFILE.architecture.rhsUltimateHeightRangeM[0],
  );
  assert.ok(
    mature.dimensions.heightM <=
      MAGNUS_PROFILE.architecture.rhsUltimateHeightRangeM[1],
  );

  const seededSpreads = Array.from(
    { length: 24 },
    (_, seed) =>
      evaluateMagnusModel(createMagnusModel({ seed }), {
        ageYears: 5,
        dayOfYear: 215,
      }).dimensions.spreadM,
  );
  assert.ok(Math.min(...seededSpreads) >= 0.5);
  assert.ok(Math.max(...seededSpreads) <= 0.6);
  assert.equal(MAGNUS_PROFILE.architecture.matureRadiusM * 2, 0.56);
});

test('day-of-year phenology covers cutback, emergence, bloom and winter retention', () => {
  const early = getMagnusCalendar({ seasonProfile: 'early' });
  const late = getMagnusCalendar({ seasonProfile: 'late' });
  const shifted = getMagnusCalendar({ offsetDays: 4 });
  for (const key of Object.keys(MAGNUS_CALENDAR)) {
    assert.equal(early[key], MAGNUS_CALENDAR[key] - 10, key);
    assert.equal(late[key], MAGNUS_CALENDAR[key] + 10, key);
    assert.equal(shifted[key], MAGNUS_CALENDAR[key] + 4, key);
  }

  assert.equal(getMagnusPhenology(20).phase, 'standing-dry');
  assert.equal(
    getMagnusPhenology(MAGNUS_CALENDAR.cutbackStart + 1).phase,
    'cut-back',
  );
  assert.equal(
    getMagnusPhenology(MAGNUS_CALENDAR.cutbackEnd + 1).phase,
    'dormant',
  );
  assert.equal(
    getMagnusPhenology(MAGNUS_CALENDAR.emergenceStart + 1).phase,
    'emergence',
  );
  assert.equal(getMagnusPhenology(215).phase, 'peak-flowering');

  const model = createMagnusModel({ seed: 'magnus-calendar', maxYears: 20 });
  const winter = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: 20,
  });
  const dormant = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.cutbackEnd + 1,
  });
  const emergence = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.emergenceStart + 6,
  });
  const peak = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: 215,
  });
  const afterLeafFall = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.leafFallEnd + 1,
  });

  assert.ok(winter.stats.visibleStems > 0);
  assert.equal(winter.stats.visibleLeaves, 0);
  assert.ok(winter.stats.visibleSeedHeads > 0);
  assert.deepEqual(
    [
      dormant.stats.visibleAxes,
      dormant.stats.visibleLeaves,
      dormant.stats.visibleHeads,
    ],
    [0, 0, 0],
  );
  assert.equal(emergence.stats.visibleAxes, 0);
  assert.ok(emergence.stats.visibleLeaves > 0);
  assert.ok(peak.stats.visibleStems > 0);
  assert.ok(peak.stats.visibleLeaves > emergence.stats.visibleLeaves);
  assert.ok(peak.stats.visibleFlowers > 0);
  assert.equal(afterLeafFall.stats.visibleLeaves, 0);
  assert.ok(afterLeafFall.stats.visibleSeedHeads > 0);
});

test('staggered capitula mix buds, open rays and fading heads in late July', () => {
  const model = createMagnusModel({ seed: 1985, maxYears: 20 });
  const stageCounts = (dayOfYear) =>
    evaluateMagnusModel(model, { ageYears: 5, dayOfYear }).heads.reduce(
      (counts, head) => ({
        ...counts,
        [head.stage]: (counts[head.stage] ?? 0) + 1,
      }),
      {},
    );

  assert.deepEqual(stageCounts(205), { bud: 3, open: 10, fading: 2 });
  assert.deepEqual(stageCounts(215), {
    bud: 1,
    opening: 2,
    open: 5,
    fading: 7,
  });
  assert.deepEqual(stageCounts(250), { 'seed-head': 12, fading: 3 });
});

test('annual rollover preserves the dry cohort and new stem leaves unfold locally', () => {
  const model = createMagnusModel({ seed: 'magnus-continuity', maxYears: 20 });
  const yearEnd = evaluateMagnusModel(model, {
    ageYears: 1,
    dayOfYear: 365,
  });
  const newYear = evaluateMagnusModel(model, {
    ageYears: 2,
    dayOfYear: 1,
  });
  const axisStructure = (snapshot) =>
    snapshot.axes.map(({ id, points, radii, radiusScale }) => ({
      id,
      points,
      radii,
      radiusScale,
    }));

  assert.deepEqual(axisStructure(newYear), axisStructure(yearEnd));
  assert.deepEqual(newYear.dimensions, yearEnd.dimensions);
  assert.equal(newYear.stats.visibleLeaves, 0);
  assert.ok(newYear.stats.visibleHeads <= yearEnd.stats.visibleHeads);
  const yearEndHeadIds = new Set(yearEnd.heads.map((head) => head.id));
  assert.ok(newYear.heads.every((head) => yearEndHeadIds.has(head.id)));
  assert.ok(newYear.heads.every((head) => head.rayVisibility === 0));

  const beforeDry = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.dryFull - 1,
  });
  const fullyDry = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.dryFull,
  });
  assert.deepEqual(
    fullyDry.heads.map((head) => head.id),
    beforeDry.heads.map((head) => head.id),
  );
  assert.ok(fullyDry.heads.every((head) => head.weathering === 1));
  assert.ok(fullyDry.heads.every((head) => head.rayVisibility === 0));

  const mature = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: 215,
  });
  const matureLeaves = new Map(mature.leaves.map((leaf) => [leaf.id, leaf]));
  let previous = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: MAGNUS_CALENDAR.stemElongationStart,
  });
  let newborn = [];
  for (
    let day = MAGNUS_CALENDAR.stemElongationStart + 1;
    day <= MAGNUS_CALENDAR.stemFullHeight && newborn.length === 0;
    day += 1
  ) {
    const current = evaluateMagnusModel(model, {
      ageYears: 5,
      dayOfYear: day,
    });
    const priorIds = new Set(previous.leaves.map((leaf) => leaf.id));
    newborn = current.leaves.filter(
      (leaf) => !leaf.basal && !priorIds.has(leaf.id),
    );
    previous = current;
  }
  assert.ok(newborn.length > 0, 'no cauline leaf emerged during elongation');
  for (const leaf of newborn) {
    const full = matureLeaves.get(leaf.id);
    assert.ok(leaf.lengthM < full.lengthM * 0.2);
    assert.ok(leaf.widthM < full.widthM * 0.4);
  }
});

test('evaluated organs retain upright heads, alternate rough foliage and annual stem counts', () => {
  const model = createMagnusModel({ seed: 'magnus-organs', maxYears: 20 });
  const snapshot = evaluateMagnusModel(model, {
    ageYears: 5,
    dayOfYear: 215,
  });
  const authoredHeads = new Map(
    model.shoots.flatMap((shoot) => shoot.heads.map((head) => [head.id, head])),
  );
  const mainAxes = snapshot.axes.filter((axis) => axis.kind === 'main');
  const lateralAxes = snapshot.axes.filter((axis) => axis.kind === 'lateral');
  const basalLeaves = snapshot.leaves.filter((leaf) => leaf.basal);

  assert.equal(
    mainAxes.length,
    MAGNUS_PROFILE.architecture.maximumPrimaryShoots,
  );
  assert.equal(
    snapshot.axes.length,
    MAGNUS_PROFILE.architecture.maximumFloweringAxes,
  );
  assert.equal(lateralAxes.length, 3);
  assert.equal(basalLeaves.length, mainAxes.length * 3);
  assert.equal(snapshot.heads.length, snapshot.axes.length);
  assert.ok(
    snapshot.leaves.length >=
      mainAxes.length * MAGNUS_PROFILE.leaf.leavesPerPrimaryStem,
  );

  for (const leaf of basalLeaves) {
    assert.ok(leaf.lengthM >= MAGNUS_PROFILE.leaf.lowerLengthM[0]);
    assert.ok(leaf.lengthM <= MAGNUS_PROFILE.leaf.lowerLengthM[1]);
    assert.ok(leaf.widthM >= MAGNUS_PROFILE.leaf.lowerWidthM[0]);
    assert.ok(leaf.widthM <= MAGNUS_PROFILE.leaf.lowerWidthM[1]);
  }
  for (const authored of authoredHeads.values()) {
    assert.ok(authored.diameterM >= MAGNUS_PROFILE.flowerHead.diameterM[0]);
    assert.ok(authored.diameterM <= MAGNUS_PROFILE.flowerHead.diameterM[1]);
  }
  for (const head of snapshot.heads) {
    const authored = authoredHeads.get(head.id);
    assert.ok(head.diameterM >= authored.diameterM * 0.24);
    assert.ok(head.diameterM <= authored.diameterM);
    assert.ok(head.direction.y > 0.97, `${head.id} is not upward-facing`);
  }
  for (const axis of snapshot.axes) {
    assert.equal(axis.cohort, 'current');
    assert.ok(axis.points.length >= 5);
    assert.equal(axis.radii.length, axis.points.length);
  }
});

test('capitulum geometry encodes the unit-organ Magnus silhouette', () => {
  const head = createMagnusHeadGeometry();
  const coarseHead = createMagnusHeadGeometry({
    rays: 12,
    raySegments: 1,
    radialSegments: 8,
    coneRings: 2,
    coarsePeduncle: true,
  });
  try {
    head.computeBoundingBox();

    assert.equal(head.userData.organ, 'echinacea-capitulum');
    assert.equal(head.userData.unitDiameter, 1);
    assert.equal(head.userData.rays, 20);
    assert.ok(
      head.userData.rays >= MAGNUS_PROFILE.flowerHead.rayCount[0] &&
        head.userData.rays <= MAGNUS_PROFILE.flowerHead.rayCount[1],
    );
    const width = head.boundingBox.max.x - head.boundingBox.min.x;
    const depth = head.boundingBox.max.z - head.boundingBox.min.z;
    assert.ok(width > 0.9 && width <= 1.01);
    assert.ok(depth > 0.9 && depth <= 1.01);
    assert.ok(head.boundingBox.max.y > 0.2, 'cone must rise above the rays');
    assert.ok(
      head.boundingBox.min.y < 0,
      'rays and bracts need a slight droop',
    );
    assert.ok(head.getAttribute('color'));
    assert.equal(
      head.getAttribute('magnusRay').count,
      head.getAttribute('position').count,
    );
    assert.equal(
      head.getAttribute('magnusHead').count,
      head.getAttribute('position').count,
    );
    assert.ok(
      Array.from(head.getAttribute('magnusHead').array).every(
        (weight) => weight === 1,
      ),
    );
    assert.ok(triangleCount(head) <= 500);

    assert.equal(coarseHead.userData.coarsePeduncle, true);
    const positions = coarseHead.getAttribute('position');
    const normals = coarseHead.getAttribute('normal');
    const headWeights = coarseHead.getAttribute('magnusHead');
    for (let index = positions.count - 8; index < positions.count; index += 1) {
      const radialDot =
        positions.getX(index) * normals.getX(index) +
        positions.getZ(index) * normals.getZ(index);
      assert.ok(radialDot > 0, `coarse peduncle normal ${index} points inward`);
      assert.equal(headWeights.getX(index), 0);
    }
    assert.equal(headWeights.getX(0), 1);

    for (const geometry of [head]) {
      const normals = geometry.getAttribute('normal');
      assert.equal(normals.count, geometry.getAttribute('position').count);
      for (let index = 0; index < normals.count; index += 1) {
        const length = Math.hypot(
          normals.getX(index),
          normals.getY(index),
          normals.getZ(index),
        );
        assert.ok(Math.abs(length - 1) < 1e-5, `normal ${index}`);
      }
    }
  } finally {
    head.dispose();
    coarseHead.dispose();
  }
});

test('renderer setState rewrites fixed pools in place and reproduces A-B-A', () => {
  const options = {
    seed: 'magnus-renderer-state',
    maxYears: 20,
    ageYears: 5,
    dayOfYear: 215,
  };
  const plant = new Echinacea(options);
  try {
    const expected = evaluateMagnusModel(createMagnusModel(options), {
      ageYears: options.ageYears,
      dayOfYear: options.dayOfYear,
    });
    const wood = meshNamed(plant, MESH_NAMES.wood);
    const stems = meshNamed(plant, MESH_NAMES.stems);
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    const heads = meshNamed(plant, MESH_NAMES.heads);
    const instances = [stems, leaves, heads];

    assert.equal(meshes(plant).length, 4);
    assert.equal(wood.visible, false);
    assert.equal(triangleCount(wood.geometry), 0);
    assert.equal(leaves.count, expected.stats.visibleLeaves);
    assert.equal(triangleCount(leaves.geometry), 2);
    assert.ok(leaves.geometry.getAttribute('uv'));
    assert.equal(leaves.geometry.getAttribute('color'), undefined);
    assert.equal(heads.count, expected.stats.visibleHeads);
    assert.equal(stems.count, plant.stats().stemSegments);
    assert.equal(plant.stats().visibleStems, expected.stats.visibleStems);
    assert.equal(
      stems.count,
      expected.axes.reduce((total, axis) => total + axis.points.length - 1, 0),
    );

    const allocations = instances.map((mesh) => ({
      name: mesh.name,
      mesh,
      geometry: mesh.geometry,
      matrix: mesh.instanceMatrix,
      matrixArray: mesh.instanceMatrix.array,
      colourArray: mesh.instanceColor.array,
      capacity: mesh.instanceMatrix.count,
    }));
    const stateA = plant.serialize();
    const renderingA = captureInstances(plant);

    plant.setState({
      ageYears: 1,
      dayOfYear:
        getMagnusCalendar({ seasonProfile: 'late', offsetDays: 3 })
          .emergenceStart + 6,
      seasonProfile: 'late',
      offsetDays: 3,
    });
    assert.ok(plant.stats().visibleLeaves > 0);
    assert.equal(plant.stats().visibleHeads, 0);

    plant.setState({
      ageYears: stateA.ageYears,
      dayOfYear: stateA.dayOfYear,
      seasonProfile: stateA.seasonProfile,
      offsetDays: stateA.offsetDays,
    });
    assert.deepEqual(captureInstances(plant), renderingA);
    assert.deepEqual(plant.serialize(), stateA);

    for (const allocation of allocations) {
      const current = meshNamed(plant, allocation.name);
      assert.strictEqual(current, allocation.mesh);
      assert.strictEqual(current.geometry, allocation.geometry);
      assert.strictEqual(current.instanceMatrix, allocation.matrix);
      assert.strictEqual(current.instanceMatrix.array, allocation.matrixArray);
      assert.strictEqual(current.instanceColor.array, allocation.colourArray);
      assert.equal(current.instanceMatrix.count, allocation.capacity);
    }

    const beforeRejectedState = plant.serialize();
    const beforeRejectedRendering = captureInstances(plant);
    assert.throws(
      () => plant.setState({ ageYears: 2, seasonProfile: 'monsoon' }),
      /seasonProfile/,
    );
    assert.deepEqual(plant.serialize(), beforeRejectedState);
    assert.deepEqual(captureInstances(plant), beforeRejectedRendering);
  } finally {
    plant.dispose();
  }
});

test('serialization round-trips state and custom leaf wind reaches every render pass', () => {
  const windStrength = new THREE.Vector3(0.021, 0, 0.034);
  const plant = new Echinacea({
    seed: 'magnus-round-trip',
    plantId: 'garden:echinacea:magnus:1',
    maxYears: 20,
    ageYears: 9,
    dayOfYear: 255,
    seasonProfile: 'early',
    offsetDays: -4,
    leafWind: {
      strength: windStrength,
      frequency: 0.73,
      scale: 0.81,
    },
  });
  try {
    const state = plant.serialize();
    assert.deepEqual(state, {
      schemaVersion: 1,
      type: 'Echinacea',
      plantId: 'garden:echinacea:magnus:1',
      species: 'Echinacea purpurea',
      cultivar: 'Magnus',
      seed: 'magnus-round-trip',
      maxYears: 20,
      ageYears: 9,
      dayOfYear: 255,
      seasonProfile: 'early',
      offsetDays: -4,
      events: [],
    });

    const restored = new Echinacea(state);
    try {
      assert.deepEqual(restored.serialize(), state);
      assert.deepEqual(captureInstances(restored), captureInstances(plant));
    } finally {
      restored.dispose();
    }

    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    const beforeWind = captureInstances(plant);
    const surfaceShader = compileMaterial(leaves.material);
    const depthShader = compileMaterial(leaves.customDepthMaterial);
    const distanceShader = compileMaterial(leaves.customDistanceMaterial);

    assert.match(surfaceShader.vertexShader, /leafWindSimplex3/);
    assert.match(surfaceShader.vertexShader, /USE_INSTANCING/);
    assert.match(surfaceShader.vertexShader, /uv\.y \* leafWindLocalStrength/);
    assert.strictEqual(
      surfaceShader.uniforms.uTime,
      depthShader.uniforms.uTime,
    );
    assert.strictEqual(
      surfaceShader.uniforms.uTime,
      distanceShader.uniforms.uTime,
    );
    assert.ok(surfaceShader.uniforms.uWindStrength.value.equals(windStrength));
    assert.equal(surfaceShader.uniforms.uWindFrequency.value, 0.73);
    assert.equal(surfaceShader.uniforms.uWindScale.value, 0.81);
    assert.equal(
      surfaceShader.uniforms.uCustomNormals.value,
      true,
      'thin rough leaves keep their authored face normal on both sides',
    );

    plant.update(0.016, 7.5);
    assert.equal(surfaceShader.uniforms.uTime.value, 7.5);
    assert.deepEqual(captureInstances(plant), beforeWind);
    assert.throws(
      () => new Echinacea({ cultivar: 'White Swan' }),
      /only the Magnus cultivar/i,
    );
  } finally {
    plant.dispose();
  }
});

test('one packed head pool morphs rays, cones and support-only stalks', () => {
  const plant = new Echinacea({
    seed: 'magnus-ray-morph',
    ageYears: 5,
    dayOfYear: 215,
  });
  const decodeRayVisibility = (blue) => Math.floor(blue * 0.5) / 255;
  const decodeHeadVisibility = (red) => Math.floor(red * 0.5);
  try {
    const heads = meshNamed(plant, MESH_NAMES.heads);
    const surface = compileShaderLib(heads.material, THREE.ShaderLib.standard);
    const depth = compileShaderLib(
      heads.customDepthMaterial,
      THREE.ShaderLib.depth,
    );
    const distance = compileShaderLib(
      heads.customDistanceMaterial,
      THREE.ShaderLib.distance,
    );
    for (const shader of [surface, depth, distance]) {
      assert.match(shader.vertexShader, /attribute float magnusRay/);
      assert.match(shader.vertexShader, /attribute float magnusHead/);
      assert.match(shader.vertexShader, /magnusRayVisibility/);
      assert.match(shader.vertexShader, /magnusHeadVisibility/);
      assert.match(shader.vertexShader, /USE_INSTANCING_COLOR_INDIRECT/);
      assert.match(shader.vertexShader, /getColorTexture/);
    }
    for (const shader of [depth, distance]) {
      assert.ok(
        shader.vertexShader.indexOf('#include <batching_pars_vertex>') <
          shader.vertexShader.indexOf('#include <color_pars_vertex>'),
        'indirect instanceIndex must be declared before its colour lookup',
      );
    }

    const summerRayVisibility = [];
    for (let index = 0; index < heads.count; index += 1) {
      summerRayVisibility.push(
        decodeRayVisibility(heads.instanceColor.getZ(index)),
      );
      assert.equal(decodeHeadVisibility(heads.instanceColor.getX(index)), 1);
    }
    assert.ok(summerRayVisibility.some((visibility) => visibility > 0.9));
    assert.ok(summerRayVisibility.some((visibility) => visibility < 0.5));

    plant.setState({ ageYears: 5, dayOfYear: 20 });
    assert.ok(heads.count > 0);
    for (let index = 0; index < heads.count; index += 1) {
      assert.equal(
        decodeRayVisibility(heads.instanceColor.getZ(index)),
        0,
        `winter head ${index} retained pink rays`,
      );
      assert.equal(decodeHeadVisibility(heads.instanceColor.getX(index)), 1);
    }

    plant.setState({ ageYears: 5, dayOfYear: 158 });
    plant.setLevel(2);
    let visibleCapitula = 0;
    let supportOnlyStalks = 0;
    for (let index = 0; index < heads.count; index += 1) {
      if (decodeHeadVisibility(heads.instanceColor.getX(index))) {
        visibleCapitula += 1;
      } else {
        supportOnlyStalks += 1;
      }
    }
    assert.ok(visibleCapitula > 0);
    assert.ok(supportOnlyStalks > 0);
    assert.equal(heads.count, plant.stats().visibleAxes);
  } finally {
    plant.dispose();
  }
});

test('a retained lateral winter cone keeps a ground-connected coarse support', () => {
  const snapshot = evaluateMagnusModel(
    createMagnusModel({ seed: 'audit', maxYears: 20 }),
    { ageYears: 5, dayOfYear: 12 },
  );
  assert.ok(
    snapshot.heads.some((head) => head.axisId.includes(':axis:lateral')),
    'fixture no longer retains a lateral winter cone',
  );
  assert.ok(
    snapshot.heads.every((head) => Math.abs(head.stemBasePosition.y) < 1e-9),
  );

  const plant = new Echinacea({
    seed: 'audit',
    ageYears: 5,
    dayOfYear: 12,
  });
  const instance = new THREE.Matrix4();
  try {
    plant.setLevel(2);
    const heads = meshNamed(plant, MESH_NAMES.heads);
    assert.equal(
      heads.count,
      snapshot.heads.length + snapshot.headSupports.length,
    );
    assert.equal(heads.count, snapshot.axes.length);
    assert.equal(heads.geometry.userData.coarsePeduncle, true);
    for (let index = 0; index < heads.count; index += 1) {
      heads.getMatrixAt(index, instance);
      assert.ok(
        Math.abs(instance.elements[13]) < 1e-6,
        `coarse winter support ${index} floats above the crown`,
      );
    }
  } finally {
    plant.dispose();
  }
});

test('coarse seasons integrate one support for every visible flowering axis', () => {
  const plant = new Echinacea({
    seed: 's2',
    ageYears: 5,
    dayOfYear: 73,
  });
  const model = createMagnusModel({ seed: 's2' });
  const instance = new THREE.Matrix4();
  try {
    for (const level of [1, 2]) {
      plant.setLevel(level);
      for (const dayOfYear of [73, 140, 158]) {
        plant.setState({ dayOfYear });
        const snapshot = evaluateMagnusModel(model, {
          ageYears: 5,
          dayOfYear,
        });
        const stats = plant.stats();
        const heads = meshNamed(plant, MESH_NAMES.heads);
        assert.ok(stats.visibleAxes > 0);
        assert.equal(stats.stemSegments, 0);
        assert.equal(meshNamed(plant, MESH_NAMES.stems).count, 0);
        assert.equal(
          heads.count,
          snapshot.heads.length + snapshot.headSupports.length,
        );
        assert.equal(heads.count, stats.visibleAxes);
        assert.ok(stats.drawCalls <= 2);
        for (let index = 0; index < heads.count; index += 1) {
          heads.getMatrixAt(index, instance);
          assert.ok(Math.abs(instance.elements[13]) < 1e-6);
        }
        if (dayOfYear === 158) {
          assert.ok(stats.visibleHeads > 0);
          assert.ok(stats.visibleHeads < stats.visibleAxes);
        }
      }
    }
  } finally {
    plant.dispose();
  }
});

test('all three LODs stay within the new-plant triangle and draw budgets', () => {
  const plant = new Echinacea({
    seed: 'magnus-budget',
    ageYears: 5,
    dayOfYear: 230,
  });
  const triangleLimits = [25_000, 10_000, 5_000];
  const drawLimits = [3, 2, 2];
  const worstTriangles = [0, 0, 0];
  const worstDraws = [0, 0, 0];
  try {
    const peakBands = measureBands(plant);
    assert.deepEqual(
      peakBands.map((band) => band.draws),
      drawLimits,
    );
    assert.ok(peakBands[1].triangles < peakBands[0].triangles);
    assert.ok(peakBands[2].triangles < peakBands[1].triangles);

    const matureHeadCount = evaluateMagnusModel(
      createMagnusModel({ seed: 'magnus-budget' }),
      { ageYears: 5, dayOfYear: 230 },
    ).stats.visibleHeads;
    for (let level = 0; level < plant.lodLevels.length; level += 1) {
      plant.setLevel(level);
      assert.equal(meshNamed(plant, MESH_NAMES.heads).count, matureHeadCount);
      assert.equal(
        meshNamed(plant, MESH_NAMES.heads).geometry.userData.coarsePeduncle,
        level > 0,
      );
      if (level > 0) {
        assert.equal(meshNamed(plant, MESH_NAMES.stems).count, 0);
      }
    }

    for (const dayOfYear of [20, 165, 205, 230, 280, 320]) {
      plant.setState({ ageYears: 5, dayOfYear });
      measureBands(plant).forEach((band, level) => {
        worstTriangles[level] = Math.max(worstTriangles[level], band.triangles);
        worstDraws[level] = Math.max(worstDraws[level], band.draws);
      });
    }

    for (let level = 0; level < triangleLimits.length; level += 1) {
      assert.ok(
        worstTriangles[level] <= triangleLimits[level],
        `LOD${level} uses ${worstTriangles[level]} triangles`,
      );
      assert.ok(
        worstDraws[level] <= drawLimits[level],
        `LOD${level} uses ${worstDraws[level]} draws`,
      );
    }
  } finally {
    plant.dispose();
  }
});
