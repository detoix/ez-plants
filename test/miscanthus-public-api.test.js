import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';

import * as publicApi from '../src/lib/index.js';
import {
  BLADE_ARCH_VARIANTS,
  BLADE_TWIST_VARIANTS,
  BLADE_WIDTH_RATIOS,
  bladeTipOffset,
  bladeVariantFor,
  createBladeGeometry,
  createPlumeGeometry,
  createRacemeFanGeometry,
  createSpikeletGeometry,
} from '../src/lib/plants/miscanthus/geometry.js';

const APP_SOURCE_URL = new URL('../src/app/plants.js', import.meta.url);
const TYPES_SOURCE_URL = new URL('../types/plants.d.ts', import.meta.url);
const REACT_SOURCE_URL = new URL('../src/react/index.tsx', import.meta.url);

test('library index exports the complete Malepartus runtime surface', () => {
  assert.equal(publicApi.Miscanthus.name, 'Miscanthus');
  assert.ok(publicApi.Miscanthus.prototype instanceof publicApi.PlantRenderer);
  assert.equal(publicApi.MALEPARTUS_PROFILE.cultivar, 'Malepartus');
  assert.equal(publicApi.MALEPARTUS_PROFILE.species, 'Miscanthus sinensis');
  assert.match(publicApi.MALEPARTUS_SOURCES.rhsCultivar.url, /rhs\.org\.uk/);
  assert.ok(publicApi.MALEPARTUS_CALENDAR.panicleEmergenceStart > 1);

  for (const helper of [
    'getMalepartusCalendar',
    'getMalepartusPhenology',
    'getMalepartusCareHints',
    'createMalepartusModel',
    'evaluateMalepartusModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function', `${helper} must export`);
  }

  const model = publicApi.createMalepartusModel({
    seed: 'public-api-contract',
    maxYears: 4,
  });
  const snapshot = publicApi.evaluateMalepartusModel(model, {
    ageYears: 4,
    dayOfYear: publicApi.MALEPARTUS_CALENDAR.plumeFullFluff,
    seasonProfile: 'late',
  });
  assert.equal(model.kind, 'miscanthus-malepartus-growth-model');
  assert.equal(snapshot.phenology.seasonProfile, 'late');
  assert.equal(snapshot.species, 'Miscanthus sinensis');
  assert.ok(snapshot.clump.radiusM > 0);
});

test('the plant is usable with no assets at all', () => {
  // Culms, blades and plumes are geometry with baked vertex colours, so this
  // is the first plant in the library that ships complete: no bark maps, no
  // leaf plate, nothing for a caller to resolve.
  const plant = new publicApi.Miscanthus({ seed: 7, ageYears: 4 });
  try {
    assert.ok(plant.stats().visibleCulms > 0);
    plant.traverse((object) => {
      if (object.isMesh && object.visible) {
        assert.equal(object.material.map ?? null, null);
      }
    });
  } finally {
    plant.dispose();
  }
});

test('every blade variant is a unit-length arc with a real width', () => {
  assert.equal(BLADE_ARCH_VARIANTS.length, BLADE_TWIST_VARIANTS.length);
  assert.equal(BLADE_ARCH_VARIANTS.length, BLADE_WIDTH_RATIOS.length);
  let previousReach = -1;
  for (const [index, arch] of BLADE_ARCH_VARIANTS.entries()) {
    const widthRatio = BLADE_WIDTH_RATIOS[index];
    const geometry = createBladeGeometry({
      arch,
      twist: BLADE_TWIST_VARIANTS[index],
      widthRatio,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(Math.abs(box.min.y) < 1e-6, 'a blade is rooted at y = 0');
    // The centreline is integrated at unit speed, so no point can sit further
    // than one unit from the sheath however hard the blade arches.
    assert.ok(Math.hypot(box.max.x, box.max.y) <= 1.02);
    // Width is baked in, so one uniform instance scale gives a real strap.
    assert.ok(box.max.z <= widthRatio / 2 + 1e-6);
    assert.ok(box.max.z > widthRatio / 4);
    assert.ok(geometry.attributes.uv, 'blades need wind UVs');
    assert.ok(geometry.attributes.color, 'blades carry their own midrib');

    const offset = bladeTipOffset(arch);
    assert.ok(
      offset.across > previousReach,
      'more arch must mean more outward reach',
    );
    previousReach = offset.across;
    geometry.dispose();
  }
  assert.throws(() => createBladeGeometry({ widthRatio: 0.9 }), RangeError);
  assert.equal(bladeVariantFor(0), 0);
  assert.equal(bladeVariantFor(2), BLADE_ARCH_VARIANTS.length - 1);
});

test('the three panicle geometries share one raceme layout', () => {
  const racemes = 15;
  const parts = {
    fan: createRacemeFanGeometry({ racemes }),
    spikelets: createSpikeletGeometry({ racemes }),
    plumes: createPlumeGeometry({ racemes }),
  };
  try {
    for (const [name, geometry] of Object.entries(parts)) {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      assert.ok(box.min.y >= -1e-6, `${name} must not dip below its own base`);
      assert.ok(box.max.y <= 1.12, `${name} must fit the unit organ contract`);
      assert.ok(geometry.attributes.uv, `${name} needs wind UVs`);
      assert.ok(geometry.attributes.color, `${name} needs vertex colours`);
      assert.equal(geometry.userData.racemeCount, racemes);
    }

    // Only the rachis reaches the base of the head; spikelets and their hairs
    // start where the racemes leave the central axis, which is why a
    // just-emerged panicle shows a bare stalk under a coppery tuft.
    assert.ok(Math.abs(parts.fan.boundingBox.min.y) < 1e-6);
    assert.ok(parts.spikelets.boundingBox.min.y > 0.05);
    assert.ok(parts.plumes.boundingBox.min.y > 0.05);

    // All three are instanced with one shared matrix, so the flowers and
    // hairs must sit inside the fan's envelope or they would float off their
    // racemes. Hairs are allowed to project slightly past the raceme tips.
    for (const name of ['spikelets', 'plumes']) {
      const box = parts[name].boundingBox;
      const fan = parts.fan.boundingBox;
      assert.ok(box.max.x <= fan.max.x + 0.08, `${name} overhangs the fan`);
      assert.ok(box.min.x >= fan.min.x - 0.08, `${name} overhangs the fan`);
      assert.ok(box.max.y <= fan.max.y + 0.08, `${name} overhangs the fan`);
    }
  } finally {
    for (const geometry of Object.values(parts)) geometry.dispose();
  }
});

test('organ geometry generation is deterministic', () => {
  const build = () => ({
    blade: createBladeGeometry({ arch: 0.62, twist: 0.52 }),
    fan: createRacemeFanGeometry(),
    plumes: createPlumeGeometry(),
    spikelets: createSpikeletGeometry(),
  });
  const first = build();
  const second = build();
  for (const key of Object.keys(first)) {
    assert.deepEqual(
      Array.from(first[key].attributes.position.array),
      Array.from(second[key].attributes.position.array),
      `${key} is not deterministic`,
    );
    first[key].dispose();
    second[key].dispose();
  }
});

test('geometry options reject topology they cannot build', () => {
  assert.throws(() => createBladeGeometry({ segments: 2 }), RangeError);
  assert.throws(() => createBladeGeometry({ arch: 3 }), RangeError);
  assert.throws(() => createBladeGeometry({ twist: 9 }), RangeError);
  assert.throws(() => createRacemeFanGeometry({ racemes: 2 }), RangeError);
  assert.throws(() => createRacemeFanGeometry({ sides: 1.5 }), RangeError);
  assert.throws(() => createPlumeGeometry({ hairsPerTuft: 0 }), RangeError);
});

test('types and the React entry point declare the plant', () => {
  const types = readFileSync(TYPES_SOURCE_URL, 'utf8');
  for (const declaration of [
    'export declare class Miscanthus extends PlantRenderer',
    'export interface MiscanthusOptions',
    'export interface MiscanthusStats',
    'export interface MalepartusPhenology',
    'export type MalepartusSeasonProfile',
    'export declare const MALEPARTUS_PROFILE',
    'export declare function createMalepartusModel',
  ]) {
    assert.ok(types.includes(declaration), `missing type: ${declaration}`);
  }

  const react = readFileSync(REACT_SOURCE_URL, 'utf8');
  assert.match(react, /export function MiscanthusPlant\(/);
  assert.match(react, /MiscanthusPlant as Miscanthus/);
  assert.match(react, /type MiscanthusStats/);
});

test('the app registry carries a complete Miscanthus descriptor', () => {
  const source = readFileSync(APP_SOURCE_URL, 'utf8');
  const executable = source
    .replace(/import\s*\{[\s\S]*?\}\s*from '@detoix\/ez-plants';\s*/, '')
    .replace(/import\s*\{[^;]*\}\s*from '\.\/textures';\s*/, '')
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, '');
  assert.doesNotMatch(executable, /^import\s/m);

  const capture = (kind) =>
    class {
      constructor(options) {
        this.kind = kind;
        this.options = options;
      }
    };
  const bark = { type: 'Bark001', textureScale: { x: 1, y: 1 }, maps: {} };
  const registry = Function(
    'Blackcurrant',
    'Forsythia',
    'Hydrangea',
    'LIMELIGHT_PROFILE',
    'LIMELIGHT_SOURCES',
    'LYNWOOD_PROFILE',
    'LYNWOOD_SOURCES',
    'MALEPARTUS_PROFILE',
    'MALEPARTUS_SOURCES',
    'Miscanthus',
    'TISEL_PROFILE',
    'TISEL_SOURCES',
    'TreePreset',
    'getBarkMaps',
    'getLeafMap',
    'LeafType',
    `${executable}\nreturn { PLANTS, PLANT_IDS };`,
  )(
    capture('Blackcurrant'),
    capture('Forsythia'),
    capture('Hydrangea'),
    publicApi.LIMELIGHT_PROFILE,
    publicApi.LIMELIGHT_SOURCES,
    publicApi.LYNWOOD_PROFILE,
    publicApi.LYNWOOD_SOURCES,
    publicApi.MALEPARTUS_PROFILE,
    publicApi.MALEPARTUS_SOURCES,
    capture('Miscanthus'),
    publicApi.TISEL_PROFILE,
    publicApi.TISEL_SOURCES,
    { 'Bush 1': { bark }, 'Bush 3': { bark } },
    () => ({ id: 'bark-maps' }),
    () => ({ id: 'leaf-map' }),
    {},
  );

  const descriptor = registry.PLANTS.miscanthus;
  assert.ok(registry.PLANT_IDS.includes('miscanthus'));
  assert.equal(descriptor.id, 'miscanthus');
  assert.equal(descriptor.cultivar, 'Malepartus');
  assert.equal(descriptor.species, 'Miscanthus sinensis');
  assert.strictEqual(descriptor.profile, publicApi.MALEPARTUS_PROFILE);
  assert.strictEqual(descriptor.sources, publicApi.MALEPARTUS_SOURCES);
  assert.equal(descriptor.profileControl.key, 'seasonProfile');
  assert.equal(typeof descriptor.yieldLine.format, 'function');

  // Every stat row the shared panel renders must be a key the plant reports.
  const plant = new publicApi.Miscanthus({ seed: 3, ageYears: 6 });
  try {
    const stats = plant.stats();
    for (const { key } of descriptor.stats) {
      assert.ok(
        Number.isFinite(stats[key]),
        `descriptor stat ${key} is not reported by the plant`,
      );
    }
    assert.ok(Number.isFinite(stats.dimensions?.heightM));
    assert.match(descriptor.yieldLine.format(stats.dimensions), /\d+\.\d+ m$/);
    // Every season shortcut must land on a day the plant can actually render.
    for (const { day } of descriptor.seasons) {
      plant.setTime({ dayOfYear: day });
      assert.ok(plant.stats().phenology.stage.length > 0);
    }
  } finally {
    plant.dispose();
  }

  const built = descriptor.create({
    age: 9,
    day: 263,
    phenologyProfile: 'late',
  });
  assert.equal(built.kind, 'Miscanthus');
  assert.deepEqual(
    {
      ageYears: built.options.ageYears,
      dayOfYear: built.options.dayOfYear,
      seasonProfile: built.options.seasonProfile,
    },
    {
      ageYears: 9,
      dayOfYear: 263,
      seasonProfile: 'late',
    },
  );
});

test('an R3F-style rebuild-free update path applies both sliders in place', () => {
  const plant = new publicApi.Miscanthus({ seed: 11, ageYears: 3, lod: true });
  try {
    const meshes = [];
    plant.traverse((object) => {
      if (object.isInstancedMesh) meshes.push(object);
    });
    const buffers = meshes.map((mesh) => mesh.instanceMatrix.array);

    plant.setState({ ageYears: 14, dayOfYear: 300, seasonProfile: 'early' });
    plant.update(0.016, 1.2, new THREE.PerspectiveCamera());

    meshes.forEach((mesh, index) => {
      assert.strictEqual(
        mesh.instanceMatrix.array,
        buffers[index],
        `${mesh.name} was rebuilt instead of repacked`,
      );
    });
    assert.equal(plant.seasonProfile, 'early');
    assert.equal(plant.ageYears, 14);
  } finally {
    plant.dispose();
  }
});
