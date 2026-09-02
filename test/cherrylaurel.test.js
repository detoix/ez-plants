import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';

import * as publicApi from '../src/lib/index.js';
import { createPlantPrototype } from '../src/lib/field/plant-prototype.js';
import { PlantRenderer } from '../src/lib/plant-renderer.js';
import { Cherrylaurel } from '../src/lib/plants/cherrylaurel/cherrylaurel.js';
import {
  createRotundifoliaModel,
  evaluateRotundifoliaModel,
} from '../src/lib/plants/cherrylaurel/model.js';
import {
  getRotundifoliaCalendar,
  getRotundifoliaPhenology,
  ROTUNDIFOLIA_CALENDAR,
} from '../src/lib/plants/cherrylaurel/phenology.js';
import { ROTUNDIFOLIA_PROFILE } from '../src/lib/plants/cherrylaurel/rotundifolia.js';

const APP_SOURCE_URL = new URL('../src/app/plants.js', import.meta.url);
const REACT_SOURCE_URL = new URL('../src/react/index.tsx', import.meta.url);
const TYPES_SOURCE_URL = new URL('../types/plants.d.ts', import.meta.url);

const MESH_NAMES = Object.freeze({
  wood: 'Cherrylaurel_Wood',
  leaves: 'Cherrylaurel_Leaves_Alternate_BroadElliptic',
});

const KEY_AGES = Object.freeze([3, 4, 8, 10, 20, 33, 35, 50]);
const KEY_DAYS = Object.freeze([30, 96, 119, 155, 205, 250, 330]);
const BUDGETS = Object.freeze([
  Object.freeze({ triangles: 25_000, draws: 2 }),
  Object.freeze({ triangles: 10_000, draws: 2 }),
  Object.freeze({ triangles: 5_000, draws: 2 }),
]);

function meshes(plant) {
  const found = [];
  plant.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

function meshNamed(plant, name) {
  const found = meshes(plant).find((mesh) => mesh.name === name);
  assert.ok(found, `missing scene mesh ${name}`);
  return found;
}

function compile(material, template) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

function activeInstanceBytes(mesh) {
  const length = mesh.count * 16 * Float32Array.BYTES_PER_ELEMENT;
  return new Uint8Array(
    mesh.instanceMatrix.array.buffer,
    mesh.instanceMatrix.array.byteOffset,
    length,
  ).slice();
}

function triangleCount(geometry) {
  const attribute = geometry?.index ?? geometry?.attributes?.position;
  return attribute ? attribute.count / 3 : 0;
}

function measureBands(plant) {
  const prototype = createPlantPrototype(plant);
  try {
    return prototype.bands.map(({ baked }) => {
      const organTriangles = baked.organs.reduce(
        (sum, organ) => sum + triangleCount(organ.geometry) * organ.count,
        0,
      );
      return {
        triangles: Math.round(
          organTriangles +
            (baked.wood ? triangleCount(baked.wood.geometry) : 0),
        ),
        draws:
          baked.organs.filter(({ count }) => count > 0).length +
          (baked.wood ? 1 : 0),
      };
    });
  } finally {
    prototype.dispose();
  }
}

function capturedPlant(kind) {
  return class CapturedPlant {
    constructor(options) {
      this.kind = kind;
      this.options = options;
    }
  };
}

/** Evaluate the app's real, data-only registry with renderer imports stubbed. */
function loadPlantRegistry() {
  const source = readFileSync(APP_SOURCE_URL, 'utf8');
  const executable = source
    .replace(/import\s*\{[\s\S]*?\}\s*from '@detoix\/ez-plants';\s*/, '')
    .replace(/import\s*\{[^;]*\}\s*from '\.\/textures';\s*/, '')
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, '');
  assert.doesNotMatch(executable, /^import\s/m);

  const bark = { type: 'Bark001', textureScale: { x: 1, y: 1 }, maps: {} };
  const stubs = {
    Blackcurrant: capturedPlant('Blackcurrant'),
    Cherrylaurel: capturedPlant('Cherrylaurel'),
    Echinacea: capturedPlant('Echinacea'),
    Forsythia: capturedPlant('Forsythia'),
    Hydrangea: capturedPlant('Hydrangea'),
    HAMELN_PROFILE: publicApi.HAMELN_PROFILE,
    HAMELN_SOURCES: publicApi.HAMELN_SOURCES,
    HIDCOTE_PROFILE: publicApi.HIDCOTE_PROFILE,
    HIDCOTE_SOURCES: publicApi.HIDCOTE_SOURCES,
    Lavender: capturedPlant('Lavender'),
    LIMELIGHT_PROFILE: publicApi.LIMELIGHT_PROFILE,
    LIMELIGHT_SOURCES: publicApi.LIMELIGHT_SOURCES,
    LYNWOOD_PROFILE: publicApi.LYNWOOD_PROFILE,
    LYNWOOD_SOURCES: publicApi.LYNWOOD_SOURCES,
    MALEPARTUS_PROFILE: publicApi.MALEPARTUS_PROFILE,
    MALEPARTUS_SOURCES: publicApi.MALEPARTUS_SOURCES,
    MAGNUS_PROFILE: publicApi.MAGNUS_PROFILE,
    MAGNUS_SOURCES: publicApi.MAGNUS_SOURCES,
    Miscanthus: capturedPlant('Miscanthus'),
    Pennisetum: capturedPlant('Pennisetum'),
    ROTUNDIFOLIA_PROFILE: publicApi.ROTUNDIFOLIA_PROFILE,
    ROTUNDIFOLIA_SOURCES: publicApi.ROTUNDIFOLIA_SOURCES,
    SMARAGD_PROFILE: publicApi.SMARAGD_PROFILE,
    SMARAGD_SOURCES: publicApi.SMARAGD_SOURCES,
    TISEL_PROFILE: publicApi.TISEL_PROFILE,
    TISEL_SOURCES: publicApi.TISEL_SOURCES,
    Thuja: capturedPlant('Thuja'),
    TreePreset: { 'Bush 1': { bark }, 'Bush 3': { bark } },
    getBarkMaps: () => ({ id: 'bark-maps' }),
    getLeafMap: () => null,
    LeafType: {},
  };
  return Function(
    ...Object.keys(stubs),
    `${executable}\nreturn { PLANTS, PLANT_IDS };`,
  )(...Object.values(stubs));
}

test('Rotundifolia profile and calendar preserve the sourced evergreen life cycle', () => {
  assert.equal(ROTUNDIFOLIA_PROFILE.species, 'Prunus laurocerasus');
  assert.equal(ROTUNDIFOLIA_PROFILE.cultivar, 'Rotundifolia');
  assert.equal(
    ROTUNDIFOLIA_PROFILE.leaf.arrangement,
    'alternate, shallow spiral',
  );
  assert.deepEqual(ROTUNDIFOLIA_PROFILE.leaf.lengthM, [0.12, 0.17]);
  assert.deepEqual(ROTUNDIFOLIA_PROFILE.leaf.widthM, [0.05, 0.08]);
  assert.equal(ROTUNDIFOLIA_PROFILE.leaf.evergreen, true);
  assert.equal(ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears, 4);

  for (let dayOfYear = 1; dayOfYear <= 365; dayOfYear += 1) {
    const phenology = getRotundifoliaPhenology(dayOfYear);
    assert.equal(phenology.evergreen, true, `day ${dayOfYear}`);
    assert.equal(phenology.evergreenLeafRetention, 1, `day ${dayOfYear}`);
  }

  const early = getRotundifoliaCalendar({ seasonProfile: 'early' });
  const late = getRotundifoliaCalendar({ seasonProfile: 'late' });
  assert.equal(ROTUNDIFOLIA_CALENDAR.floweringPeak - early.floweringPeak, 10);
  assert.equal(late.floweringPeak - ROTUNDIFOLIA_CALENDAR.floweringPeak, 10);
  assert.ok(
    ROTUNDIFOLIA_CALENDAR.floweringEnd < ROTUNDIFOLIA_CALENDAR.redFruitStart,
  );
  assert.ok(
    ROTUNDIFOLIA_CALENDAR.redFruitStart < ROTUNDIFOLIA_CALENDAR.blackFruitStart,
  );

  const floweringBoundary = getRotundifoliaPhenology(
    ROTUNDIFOLIA_CALENDAR.floweringStart,
  );
  assert.equal(floweringBoundary.phase, 'flower-bud');
  assert.equal(floweringBoundary.featureStage, 'bud');
  assert.equal(floweringBoundary.flowerVisibility, 0);

  for (const emptyBoundary of [
    ROTUNDIFOLIA_CALENDAR.floweringEnd,
    ROTUNDIFOLIA_CALENDAR.fruitSetStart,
    ROTUNDIFOLIA_CALENDAR.fruitDropEnd,
  ]) {
    const state = getRotundifoliaPhenology(emptyBoundary);
    assert.equal(state.featureStage, 'absent', `day ${emptyBoundary}`);
    assert.equal(state.flowerVisibility, 0, `day ${emptyBoundary}`);
    assert.equal(state.fruitVisibility, 0, `day ${emptyBoundary}`);
  }

  const firstBlackening = getRotundifoliaPhenology(
    ROTUNDIFOLIA_CALENDAR.blackFruitStart,
  );
  assert.equal(firstBlackening.phase, 'fruit-ripening');
  assert.equal(firstBlackening.blackProgress, 0);
  assert.doesNotMatch(firstBlackening.label, /glossy black/i);

  const fullyBlack = getRotundifoliaPhenology(
    ROTUNDIFOLIA_CALENDAR.blackFruitFull,
  );
  assert.equal(fullyBlack.phase, 'ripe-fruit');
  assert.equal(fullyBlack.blackProgress, 1);
});

test('the JSON-safe model grows with age, gates racemes until age four and carries flower-to-fruit stages', () => {
  const model = createRotundifoliaModel({
    seed: 'rotundifolia-lifecycle',
    maxYears: 50,
  });
  const roundTrippedModel = JSON.parse(JSON.stringify(model));
  assert.equal(
    roundTrippedModel.kind,
    'cherrylaurel-rotundifolia-growth-model',
  );

  const sizes = [0, 1, 3, 4, 8, 10, 20, 35, 50].map((ageYears) =>
    evaluateRotundifoliaModel(roundTrippedModel, {
      ageYears,
      dayOfYear: 330,
    }),
  );
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(
      sizes[index].dimensions.heightM >= sizes[index - 1].dimensions.heightM,
    );
    assert.ok(
      sizes[index].dimensions.spreadM >= sizes[index - 1].dimensions.spreadM,
    );
  }
  for (const snapshot of sizes.slice(1)) {
    assert.ok(snapshot.stats.visibleLeaves > 0);
    assert.equal(snapshot.stats.evergreen, true);
  }
  for (const dayOfYear of [1, ...KEY_DAYS, 365]) {
    const evergreen = evaluateRotundifoliaModel(roundTrippedModel, {
      ageYears: 8,
      dayOfYear,
    });
    assert.ok(evergreen.stats.visibleLeaves > 0, `day ${dayOfYear}`);
  }

  for (const ageYears of [0, 1, 2, 3]) {
    for (const dayOfYear of [96, 119, 155, 205, 250]) {
      const juvenile = evaluateRotundifoliaModel(roundTrippedModel, {
        ageYears,
        dayOfYear,
      });
      assert.equal(juvenile.stats.visibleRacemes, 0);
      assert.equal(juvenile.stats.visibleFlowerRacemes, 0);
      assert.equal(juvenile.stats.visibleFruitRacemes, 0);
      assert.equal(juvenile.stats.visibleRipeFruitRacemes, 0);
      assert.equal(juvenile.phenology.featureStage, 'absent');
      assert.equal(juvenile.phenology.flowerBudVisibility, 0);
      assert.equal(juvenile.phenology.flowerVisibility, 0);
      assert.equal(juvenile.phenology.fruitVisibility, 0);
      assert.equal(juvenile.phenology.ripeFruitVisibility, 0);
    }
  }

  const flowering = evaluateRotundifoliaModel(roundTrippedModel, {
    ageYears: 4,
    dayOfYear: 119,
  });
  assert.equal(flowering.phenology.phase, 'flowering');
  assert.ok(flowering.stats.visibleFlowerRacemes > 0);

  const establishedFlowering = evaluateRotundifoliaModel(roundTrippedModel, {
    ageYears: 8,
    dayOfYear: 119,
  });
  assert.ok(
    establishedFlowering.stats.visibleFlowerRacemes >
      flowering.stats.visibleFlowerRacemes,
  );

  const mature = sizes.find(({ ageYears }) => ageYears === 10);
  const old = sizes.find(({ ageYears }) => ageYears === 50);
  assert.ok(old.stats.visibleAxes > mature.stats.visibleAxes);
  assert.notEqual(old.stats.visibleLeaves, mature.stats.visibleLeaves);

  const developing = evaluateRotundifoliaModel(roundTrippedModel, {
    ageYears: 8,
    dayOfYear: 205,
  });
  assert.equal(developing.phenology.phase, 'fruit-ripening');
  assert.ok(developing.stats.visibleFruitRacemes > 0);
  assert.equal(developing.stats.visibleRipeFruitRacemes, 0);

  const ripe = evaluateRotundifoliaModel(roundTrippedModel, {
    ageYears: 8,
    dayOfYear: 250,
  });
  assert.equal(ripe.phenology.phase, 'ripe-fruit');
  assert.ok(ripe.stats.visibleRipeFruitRacemes > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ripe)).stats, ripe.stats);
});

test('Cherrylaurel keeps one stable wood mesh and one bounded leaf pool while sliders scrub A-B-A', () => {
  const plant = new Cherrylaurel({
    seed: 'rotundifolia-stable-pools',
    maxYears: 10,
    ageYears: 8,
    dayOfYear: 119,
  });
  try {
    assert.ok(plant instanceof PlantRenderer);
    assert.ok(plant instanceof THREE.Group);
    assert.equal(plant.name, 'Cherrylaurel_Rotundifolia');
    assert.equal(plant.userData.species, 'Prunus laurocerasus');
    assert.equal(plant.userData.units, 'metre');

    const before = Object.fromEntries(
      Object.entries(MESH_NAMES).map(([kind, name]) => [
        kind,
        meshNamed(plant, name),
      ]),
    );
    const capacities = { leaves: before.leaves.instanceMatrix.count };
    const floweringBytes = activeInstanceBytes(before.leaves);
    const floweringCount = before.leaves.count;
    assert.ok(before.leaves.count > 0);
    assert.ok(floweringCount > 0);
    assert.equal(plant.stats().drawCalls, 2);

    plant.setState({ ageYears: 3, dayOfYear: 250 });
    assert.equal(plant.stats().visibleRacemes, 0);
    plant.setState({ ageYears: 10, dayOfYear: 330 });
    assert.ok(plant.stats().visibleLeaves > 0);
    plant.setState({ ageYears: 8, dayOfYear: 119 });

    for (const [kind, name] of Object.entries(MESH_NAMES)) {
      assert.strictEqual(meshNamed(plant, name), before[kind]);
    }
    assert.deepEqual(
      { leaves: before.leaves.instanceMatrix.count },
      capacities,
    );
    assert.equal(before.leaves.count, floweringCount);
    assert.deepEqual(activeInstanceBytes(before.leaves), floweringBytes);

    plant.setPhenologyProfile({ seasonProfile: 'late', offsetDays: 3 });
    assert.equal(plant.stats().seasonProfile, 'late');
    assert.deepEqual(
      JSON.parse(JSON.stringify(plant.serialize())),
      plant.serialize(),
    );
    assert.deepEqual(
      {
        schemaVersion: plant.serialize().schemaVersion,
        type: plant.serialize().type,
        ageYears: plant.serialize().ageYears,
        dayOfYear: plant.serialize().dayOfYear,
        seasonProfile: plant.serialize().seasonProfile,
        offsetDays: plant.serialize().offsetDays,
      },
      {
        schemaVersion: 1,
        type: 'Cherrylaurel',
        ageYears: 8,
        dayOfYear: 119,
        seasonProfile: 'late',
        offsetDays: 3,
      },
    );
  } finally {
    plant.dispose();
  }
});

test('glossy broad leaves use shared instancing-safe wind in colour and shadow shaders', () => {
  const plant = new Cherrylaurel({
    seed: 'rotundifolia-wind',
    maxYears: 10,
    ageYears: 8,
    dayOfYear: 119,
  });
  try {
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    assert.equal(leaves.material.roughness, 0.58);
    assert.ok(leaves.geometry.attributes.uv);
    assert.ok(leaves.customDepthMaterial?.isMeshDepthMaterial);
    assert.ok(leaves.customDistanceMaterial?.isMeshDistanceMaterial);

    const surface = compile(leaves.material, THREE.ShaderLib.standard);
    const depth = compile(leaves.customDepthMaterial, THREE.ShaderLib.depth);
    const distance = compile(
      leaves.customDistanceMaterial,
      THREE.ShaderLib.distance,
    );
    for (const shader of [surface, depth, distance]) {
      assert.match(shader.vertexShader, /vec3 leafWindCounterRotate/);
      assert.match(shader.vertexShader, /uv\.y \* leafWindLocalStrength/);
    }
    assert.match(surface.fragmentShader, /uCustomNormals/);
    assert.strictEqual(surface.uniforms.uTime, depth.uniforms.uTime);
    assert.strictEqual(surface.uniforms.uTime, distance.uniforms.uTime);

    plant.update(0.016, 7.5);
    assert.equal(surface.uniforms.uTime.value, 7.5);
  } finally {
    plant.dispose();
  }
});

test('every key age, season and LOD stays inside the exact geometry contract', () => {
  const plant = new Cherrylaurel({
    seed: 'budget',
    maxYears: 50,
    ageYears: 8,
    dayOfYear: 119,
  });
  try {
    for (const ageYears of KEY_AGES) {
      for (const dayOfYear of KEY_DAYS) {
        plant.setState({ ageYears, dayOfYear });
        const bands = measureBands(plant);
        assert.equal(bands.length, BUDGETS.length);
        bands.forEach((band, level) => {
          const budget = BUDGETS[level];
          const label = `age ${ageYears}, day ${dayOfYear}, LOD ${level}`;
          assert.ok(
            band.triangles <= budget.triangles,
            `${label}: ${band.triangles} triangles > ${budget.triangles}`,
          );
          assert.ok(
            band.draws <= budget.draws,
            `${label}: ${band.draws} draws > ${budget.draws}`,
          );
        });
      }
    }
  } finally {
    plant.dispose();
  }
});

test('root, app and React front doors expose Rotundifolia with age/day/profile controls', () => {
  assert.strictEqual(publicApi.Cherrylaurel, Cherrylaurel);
  assert.ok(
    publicApi.Cherrylaurel.prototype instanceof publicApi.PlantRenderer,
  );
  assert.strictEqual(publicApi.ROTUNDIFOLIA_PROFILE, ROTUNDIFOLIA_PROFILE);
  for (const helper of [
    'getRotundifoliaCalendar',
    'getRotundifoliaPhenology',
    'getRotundifoliaCareHints',
    'createRotundifoliaModel',
    'evaluateRotundifoliaModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function', `${helper} must export`);
  }
  for (const constant of [
    'ROTUNDIFOLIA_SOURCES',
    'ROTUNDIFOLIA_CALENDAR',
    'ROTUNDIFOLIA_CALENDAR_PROVENANCE',
    'ROTUNDIFOLIA_PHASE_ASSUMPTIONS',
    'ROTUNDIFOLIA_SEASON_PROFILES',
  ]) {
    assert.ok(publicApi[constant], `${constant} must export`);
  }

  const { PLANTS, PLANT_IDS } = loadPlantRegistry();
  const descriptor = PLANTS.cherrylaurel;
  assert.ok(PLANT_IDS.includes('cherrylaurel'));
  assert.equal(descriptor.label, 'Cherry laurel');
  assert.equal(descriptor.labelPl, 'Laurowiśnia wschodnia');
  assert.equal(descriptor.cultivar, 'Rotundifolia');
  assert.equal(descriptor.species, 'Prunus laurocerasus');
  assert.deepEqual(descriptor.defaults, { age: 8, day: 119 });
  assert.equal(descriptor.maxYears, 50);
  assert.deepEqual(descriptor.profileControl, {
    key: 'seasonProfile',
    label: 'Season timing',
    options: [
      ['typical', 'Typical'],
      ['early', 'Early'],
      ['late', 'Late'],
    ],
  });
  assert.deepEqual(
    descriptor.seasons.map(({ day }) => day),
    KEY_DAYS,
  );
  const captured = descriptor.create({
    age: 8,
    day: 119,
    phenologyProfile: 'late',
  });
  assert.equal(captured.kind, 'Cherrylaurel');
  assert.equal(captured.options.ageYears, 8);
  assert.equal(captured.options.dayOfYear, 119);
  assert.equal(captured.options.seasonProfile, 'late');
  assert.equal(captured.options.assets.leaf.map, undefined);

  const imperativeDefaults = new Cherrylaurel({ seed: 'public-defaults' });
  try {
    assert.equal(imperativeDefaults.ageYears, descriptor.defaults.age);
    assert.equal(imperativeDefaults.dayOfYear, descriptor.defaults.day);
  } finally {
    imperativeDefaults.dispose();
  }

  const react = readFileSync(REACT_SOURCE_URL, 'utf8');
  assert.match(react, /export interface CherrylaurelProps/);
  assert.match(react, /export function CherrylaurelPlant\s*\(/);
  assert.match(react, /ageYears = 8/);
  assert.match(react, /dayOfYear = 119/);
  assert.match(react, /CherrylaurelPlant as Cherrylaurel/);

  const types = readFileSync(TYPES_SOURCE_URL, 'utf8');
  assert.match(types, /export interface CherrylaurelOptions\s*\{/);
  assert.match(
    types,
    /export interface CherrylaurelStats extends PlantRenderStats/,
  );
  assert.match(
    types,
    /export declare class Cherrylaurel extends PlantRenderer/,
  );
  assert.match(types, /visibleFlowerRacemes: number/);
  assert.match(types, /visibleRipeFruitRacemes: number/);
  const options = types.slice(
    types.indexOf('export interface CherrylaurelOptions'),
    types.indexOf('export interface CherrylaurelStats'),
  );
  assert.match(options, /events\?: readonly \[\]/);
  assert.match(options, /leafWind\?: LeafWindOptions/);
});
