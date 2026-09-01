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
  bladeArchTilt,
  BLADE_BAKED_ARCH,
  createBladeGeometry,
  createPanicleGeometry,
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

test('the head is one instanced organ inside the unit contract', () => {
  const racemes = 15;
  const geometry = createPanicleGeometry({ racemes });
  try {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(box.min.y >= -0.06, 'the head must not dip below its own base');
    assert.ok(box.max.y <= 1.12, 'the head must fit the unit organ contract');
    assert.ok(box.max.x <= 0.62 && box.min.x >= -0.62, 'head is half a unit');
    assert.ok(geometry.attributes.uv, 'the head needs wind and plate UVs');
    assert.ok(geometry.attributes.color, 'the head needs vertex colours');
    assert.equal(geometry.userData.racemeCount, racemes);
    // Every rung stays crossed. A flat card is invisible edge-on, and a fan
    // thrown out in every azimuth always has some of itself edge-on to any
    // viewer, so single cards would leave holes wherever you stood.
    assert.equal(geometry.userData.crossed, true);
    assert.equal(
      geometry.index.count / 3,
      racemes * 2 * geometry.userData.segments * 2,
      'a raceme is two ribbons of `segments` quads and nothing else',
    );
  } finally {
    geometry.dispose();
  }
});

test('one blade is meshed, and posture arrives as a rotation', () => {
  // Library rule 9 gives a grass three draws at its near band and it needs
  // them for blades, head and culms — so the three arch variants cannot be
  // three meshes. Rule 9 names the fix: one kind with three transforms.
  const tilts = BLADE_ARCH_VARIANTS.map((arch) => bladeArchTilt(arch));
  assert.equal(
    bladeArchTilt(BLADE_BAKED_ARCH),
    0,
    'the baked arch is untilted',
  );
  for (let index = 1; index < tilts.length; index += 1) {
    assert.ok(tilts[index] > tilts[index - 1], 'more arch must tilt further');
  }
  assert.ok(
    Math.max(...tilts.map(Math.abs)) < 0.3,
    'baking at the middle variant keeps every correction under ~17 degrees',
  );

  // And the reach a model predicts stays the reach that is drawn: every
  // variant is the same blade, so every variant reaches the same distance and
  // differs only in direction.
  const reaches = BLADE_ARCH_VARIANTS.map((arch) => {
    const tip = bladeTipOffset(arch);
    return Math.hypot(tip.along, tip.across);
  });
  for (const reach of reaches) {
    assert.ok(Math.abs(reach - reaches[0]) < 1e-9);
    assert.ok(reach <= 1.0001, 'a tip cannot pass its own arc length');
  }
});

test('organ geometry generation is deterministic', () => {
  const build = () => ({
    blade: createBladeGeometry({ arch: 0.62, twist: 0.52 }),
    bladeCoarse: createBladeGeometry({ segments: 6, columns: 2 }),
    panicle: createPanicleGeometry(),
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
  assert.throws(() => createBladeGeometry({ columns: 4 }), RangeError);
  assert.throws(() => createPanicleGeometry({ racemes: 2 }), RangeError);
  assert.throws(() => createPanicleGeometry({ segments: 0 }), RangeError);
  assert.throws(() => createPanicleGeometry({ hairSpread: 0 }), RangeError);
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
    'Echinacea',
    'Forsythia',
    'HIDCOTE_PROFILE',
    'HIDCOTE_SOURCES',
    'Hydrangea',
    'HAMELN_PROFILE',
    'HAMELN_SOURCES',
    'Lavender',
    'LIMELIGHT_PROFILE',
    'LIMELIGHT_SOURCES',
    'LYNWOOD_PROFILE',
    'LYNWOOD_SOURCES',
    'MALEPARTUS_PROFILE',
    'MALEPARTUS_SOURCES',
    'MAGNUS_PROFILE',
    'MAGNUS_SOURCES',
    'Miscanthus',
    'Pennisetum',
    'TISEL_PROFILE',
    'TISEL_SOURCES',
    'TreePreset',
    'getBarkMaps',
    'getLeafMap',
    'LeafType',
    `${executable}\nreturn { PLANTS, PLANT_IDS };`,
  )(
    capture('Blackcurrant'),
    capture('Echinacea'),
    capture('Forsythia'),
    publicApi.HIDCOTE_PROFILE,
    publicApi.HIDCOTE_SOURCES,
    capture('Hydrangea'),
    publicApi.HAMELN_PROFILE,
    publicApi.HAMELN_SOURCES,
    capture('Lavender'),
    publicApi.LIMELIGHT_PROFILE,
    publicApi.LIMELIGHT_SOURCES,
    publicApi.LYNWOOD_PROFILE,
    publicApi.LYNWOOD_SOURCES,
    publicApi.MALEPARTUS_PROFILE,
    publicApi.MALEPARTUS_SOURCES,
    publicApi.MAGNUS_PROFILE,
    publicApi.MAGNUS_SOURCES,
    capture('Miscanthus'),
    capture('Pennisetum'),
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
  const plant = new publicApi.Miscanthus({ seed: 11, ageYears: 3 });
  try {
    const meshes = [];
    plant.traverse((object) => {
      if (object.isInstancedMesh) meshes.push(object);
    });
    const buffers = meshes.map((mesh) => mesh.instanceMatrix.array);

    plant.setState({ ageYears: 14, dayOfYear: 300, seasonProfile: 'early' });
    plant.update(0.016, 1.2);

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
