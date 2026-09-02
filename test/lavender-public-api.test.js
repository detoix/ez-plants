import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as publicApi from '../src/lib/index.js';
import {
  createSpikeCardGeometry,
  SPIKE_PLATE_FILL,
} from '../src/lib/plants/lavender/geometry.js';

const APP_SOURCE_URL = new URL('../src/app/plants.js', import.meta.url);
const TYPES_SOURCE_URL = new URL('../types/plants.d.ts', import.meta.url);
const REACT_SOURCE_URL = new URL('../src/react/index.tsx', import.meta.url);

test('library index exports the complete Hidcote runtime surface', () => {
  assert.equal(publicApi.Lavender.name, 'Lavender');
  assert.ok(publicApi.Lavender.prototype instanceof publicApi.PlantRenderer);
  assert.equal(publicApi.HIDCOTE_PROFILE.cultivar, 'Hidcote');
  assert.equal(publicApi.HIDCOTE_PROFILE.species, 'Lavandula angustifolia');
  assert.match(publicApi.HIDCOTE_SOURCES.rhsCultivar.url, /rhs\.org\.uk/);
  assert.ok(publicApi.HIDCOTE_CALENDAR.floweringStart > 1);

  for (const helper of [
    'getHidcoteCalendar',
    'getHidcotePhenology',
    'getHidcoteCareHints',
    'createHidcoteModel',
    'evaluateHidcoteModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function', `${helper} must export`);
  }

  const model = publicApi.createHidcoteModel({
    seed: 'public-api-contract',
    maxYears: 6,
  });
  const snapshot = publicApi.evaluateHidcoteModel(model, {
    ageYears: 5,
    dayOfYear: publicApi.HIDCOTE_CALENDAR.floweringPeak,
    region: 'northeast',
  });
  assert.equal(model.kind, 'lavender-growth-model');
  assert.equal(snapshot.phenology.region, 'northeast');
  assert.equal(snapshot.species, 'Lavandula angustifolia');
  // The north-east calendar runs about a fortnight late, so the day that is
  // the central peak catches that plant only just opening -- which is the
  // whole point of the region selector.
  const central = publicApi.evaluateHidcoteModel(model, {
    ageYears: 5,
    dayOfYear: publicApi.HIDCOTE_CALENDAR.floweringPeak,
    region: 'central',
  });
  assert.equal(central.stats.greenSpikes, 0);
  assert.ok(snapshot.stats.greenSpikes > snapshot.stats.openSpikes);
  assert.ok(snapshot.stats.leaves > 0, 'and in leaf, being evergreen');
});

test('the plant is usable with no assets at all', () => {
  // Library rule 7: a plant renders correctly with nothing supplied.
  const plant = new publicApi.Lavender({ ageYears: 4, dayOfYear: 190 });
  try {
    assert.ok(plant.stats().visibleLeaves > 0);
    assert.ok(plant.stats().visibleSpikes > 0);
    assert.equal(plant.stats().drawCalls, 3);
  } finally {
    plant.dispose();
  }
});

test('the spike is an eight-triangle crossed card in a unit frame', () => {
  const spike = createSpikeCardGeometry();
  try {
    assert.equal(spike.index.count / 3, 8);
    spike.computeBoundingBox();
    const { min, max } = spike.boundingBox;
    // Rooted at y = 0, one unit tall, half a unit across, so the instance
    // matrix carries the spike's real length and width.
    assert.equal(min.y, 0);
    assert.ok(Math.abs(max.y - 1) < 1e-6);
    assert.ok(max.x <= 0.5 && min.x >= -0.5);
    assert.ok(max.z <= 0.5 && min.z >= -0.5);
    // uv.y is the shared wind's bend weight, so it has to run base to tip.
    const uv = spike.getAttribute('uv');
    assert.ok(uv, 'a spike card needs real UVs');
    let lowest = 1;
    let highest = 0;
    for (let index = 0; index < uv.count; index += 1) {
      lowest = Math.min(lowest, uv.getY(index));
      highest = Math.max(highest, uv.getY(index));
    }
    assert.equal(lowest, 0);
    assert.equal(highest, 1);
    // Neutral vertex colours: the season arrives as an instance tint.
    const colour = spike.getAttribute('color');
    for (let index = 0; index < colour.count; index += 1) {
      assert.equal(colour.getX(index), 1);
    }
  } finally {
    spike.dispose();
  }
  assert.throws(() => createSpikeCardGeometry({ segments: 0 }), RangeError);
  assert.throws(() => createSpikeCardGeometry({ taper: 1 }), RangeError);
});

test('the spike plate fill matches the tile its cards are cut from', () => {
  // The card is scaled by `widthM / SPIKE_PLATE_FILL`, so this constant and
  // `HALF_FILL` in the plate generator have to move together or every spike
  // on the plant comes out the wrong width.
  const script = readFileSync(
    new URL('../scripts/make-spike-texture.mjs', import.meta.url),
    'utf8',
  );
  const half = script.match(/const HALF_FILL = ([\d.]+);/);
  assert.ok(half, 'the plate generator must declare HALF_FILL');
  assert.ok(
    Math.abs(Number(half[1]) * 2 - SPIKE_PLATE_FILL) < 1e-9,
    `plate draws ${Number(half[1]) * 2} of the tile, geometry expects ${SPIKE_PLATE_FILL}`,
  );
});

test('the leaf plate fill matches the tile the stand-in cards are cut from', () => {
  const renderer = readFileSync(
    new URL('../src/lib/plants/lavender/lavender.js', import.meta.url),
    'utf8',
  );
  const script = readFileSync(
    new URL('../scripts/make-lavender-leaf-texture.mjs', import.meta.url),
    'utf8',
  );
  const declared = renderer.match(/const LEAF_PLATE_FILL = ([\d.]+);/);
  const half = script.match(/const HALF_WIDTH = ([\d.]+);/);
  assert.ok(declared && half);
  assert.ok(
    Math.abs(Number(half[1]) * 2 - Number(declared[1])) < 1e-9,
    `plate draws ${Number(half[1]) * 2} of the tile, renderer expects ${declared[1]}`,
  );
});

test('the app registry carries a complete Lavender descriptor', () => {
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
    'Cherrylaurel',
    'Echinacea',
    'Forsythia',
    'HAMELN_PROFILE',
    'HAMELN_SOURCES',
    'HIDCOTE_PROFILE',
    'HIDCOTE_SOURCES',
    'Hydrangea',
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
    'ROTUNDIFOLIA_PROFILE',
    'ROTUNDIFOLIA_SOURCES',
    'SMARAGD_PROFILE',
    'SMARAGD_SOURCES',
    'TISEL_PROFILE',
    'TISEL_SOURCES',
    'Thuja',
    'TreePreset',
    'getBarkMaps',
    'getLeafMap',
    'LeafType',
    `${executable}\nreturn { PLANTS, PLANT_IDS };`,
  )(
    capture('Blackcurrant'),
    capture('Cherrylaurel'),
    capture('Echinacea'),
    capture('Forsythia'),
    publicApi.HAMELN_PROFILE,
    publicApi.HAMELN_SOURCES,
    publicApi.HIDCOTE_PROFILE,
    publicApi.HIDCOTE_SOURCES,
    capture('Hydrangea'),
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
    publicApi.ROTUNDIFOLIA_PROFILE,
    publicApi.ROTUNDIFOLIA_SOURCES,
    publicApi.SMARAGD_PROFILE,
    publicApi.SMARAGD_SOURCES,
    publicApi.TISEL_PROFILE,
    publicApi.TISEL_SOURCES,
    capture('Thuja'),
    { 'Bush 1': { bark }, 'Bush 3': { bark } },
    () => ({ id: 'bark-maps' }),
    () => ({ id: 'leaf-map' }),
    {},
  );

  const descriptor = registry.PLANTS.lavender;
  assert.ok(registry.PLANT_IDS.includes('lavender'));
  assert.equal(descriptor.cultivar, 'Hidcote');
  assert.equal(descriptor.species, 'Lavandula angustifolia');
  assert.strictEqual(descriptor.profile, publicApi.HIDCOTE_PROFILE);
  assert.strictEqual(descriptor.sources, publicApi.HIDCOTE_SOURCES);
  assert.equal(descriptor.profileControl.key, 'region');
  // There is no renewal cut to offer, so the panel must offer none.
  assert.deepEqual(descriptor.actions, []);

  const built = descriptor.create({
    age: 4,
    day: 190,
    phenologyProfile: 'central',
  });
  assert.equal(built.kind, 'Lavender');
  assert.equal(built.options.region, 'central');

  // Every stat row the shared panel renders must be a key the plant reports.
  const plant = new publicApi.Lavender({
    seed: 7,
    ageYears: 4,
    dayOfYear: 190,
  });
  try {
    const stats = plant.stats();
    for (const { key } of descriptor.stats) {
      assert.ok(
        Number.isFinite(stats[key]),
        `descriptor stat ${key} is not reported by the plant`,
      );
    }
    assert.match(descriptor.yieldLine.format(stats.dimensions), /\d+\.\d+ m$/);
    // Every seasonal shortcut has to land on the stage it is labelled with.
    const stageFor = (day) =>
      publicApi.getHidcotePhenology(day, { region: 'central' }).phase;
    const labelled = Object.fromEntries(
      descriptor.seasons.map(({ label, day }) => [label, stageFor(day)]),
    );
    assert.equal(labelled.Peak, 'flowering');
    assert.equal(labelled['Green spikes'], 'spike-emergence');
    assert.equal(labelled.Sheared, 'regrowth');
    assert.equal(labelled['Winter mound'], 'winter');
  } finally {
    plant.dispose();
  }
});

test('types and the React entry point declare the plant', () => {
  const types = readFileSync(TYPES_SOURCE_URL, 'utf8');
  for (const declaration of [
    'export declare class Lavender extends PlantRenderer',
    'export interface LavenderOptions',
    'export interface LavenderStats',
    'export interface HidcotePhenology',
    'export type HidcoteRegion',
    'export declare const HIDCOTE_PROFILE',
  ]) {
    assert.ok(types.includes(declaration), `missing type: ${declaration}`);
  }

  const react = readFileSync(REACT_SOURCE_URL, 'utf8');
  assert.match(react, /export function LavenderPlant\(/);
  assert.match(react, /LavenderPlant as Lavender/);
  assert.match(react, /type LavenderStats/);
});
