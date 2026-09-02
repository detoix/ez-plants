import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import * as publicApi from '../src/lib/index.js';

const APP_SOURCE_URL = new URL('../src/app/plants.js', import.meta.url);
const APP_HTML_URL = new URL('../src/app/index.html', import.meta.url);
const HYDRANGEA_LEAF_URL = new URL(
  '../src/lib/plants/hydrangea/leaf.webp',
  import.meta.url,
);
const TYPES_SOURCE_URL = new URL('../types/plants.d.ts', import.meta.url);
const REACT_SOURCE_URL = new URL('../src/react/index.tsx', import.meta.url);

function capturePlant(kind) {
  return class CapturedPlant {
    constructor(options) {
      this.kind = kind;
      this.options = options;
    }
  };
}

/**
 * Evaluate the data-only plant registry with renderer and texture dependencies
 * replaced by inert captures. This exercises each real descriptor and create
 * function without asking Node for a DOM, canvas, image loader or WebGL.
 */
function loadPlantRegistry() {
  const source = readFileSync(APP_SOURCE_URL, 'utf8');
  const executable = source
    .replace(/import\s*\{[\s\S]*?\}\s*from '@detoix\/ez-plants';\s*/, '')
    .replace(/import\s*\{[^;]*\}\s*from '\.\/textures';\s*/, '')
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, '');

  assert.doesNotMatch(
    executable,
    /^import\s/m,
    'all app imports must be stubbed',
  );
  const buildRegistry = Function(
    'Blackcurrant',
    'Cherrylaurel',
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
    `${executable}\nreturn { PLANTS, DEFAULT_PLANT_ID, getPlantDescriptor, plantReviewViews, PLANT_IDS };`,
  );

  const bark = {
    type: 'Bark001',
    textureScale: { x: 1, y: 1 },
    maps: {},
  };
  const leafMaps = Object.freeze({
    blackcurrant: { id: 'blackcurrant-leaf-map' },
    forsythia: { id: 'forsythia-leaf-map' },
    hydrangea: { id: 'hydrangea-leaf-map' },
  });

  return buildRegistry(
    capturePlant('Blackcurrant'),
    capturePlant('Cherrylaurel'),
    capturePlant('Echinacea'),
    capturePlant('Forsythia'),
    publicApi.HIDCOTE_PROFILE,
    publicApi.HIDCOTE_SOURCES,
    capturePlant('Hydrangea'),
    publicApi.HAMELN_PROFILE,
    publicApi.HAMELN_SOURCES,
    capturePlant('Lavender'),
    publicApi.LIMELIGHT_PROFILE,
    publicApi.LIMELIGHT_SOURCES,
    publicApi.LYNWOOD_PROFILE,
    publicApi.LYNWOOD_SOURCES,
    publicApi.MALEPARTUS_PROFILE,
    publicApi.MALEPARTUS_SOURCES,
    publicApi.MAGNUS_PROFILE,
    publicApi.MAGNUS_SOURCES,
    capturePlant('Miscanthus'),
    capturePlant('Pennisetum'),
    publicApi.ROTUNDIFOLIA_PROFILE,
    publicApi.ROTUNDIFOLIA_SOURCES,
    publicApi.SMARAGD_PROFILE,
    publicApi.SMARAGD_SOURCES,
    publicApi.TISEL_PROFILE,
    publicApi.TISEL_SOURCES,
    capturePlant('Thuja'),
    {
      'Bush 1': { bark },
      'Bush 3': { bark },
    },
    () => ({ id: 'bark-maps' }),
    (type) => leafMaps[type],
    {
      BlackcurrantTisel: 'blackcurrant',
      ForsythiaLynwood: 'forsythia',
      HydrangeaLimelight: 'hydrangea',
    },
  );
}

test('Limelight uses a compact transparent WebP leaf plate', () => {
  const texture = readFileSync(HYDRANGEA_LEAF_URL);

  assert.equal(texture.toString('ascii', 0, 4), 'RIFF');
  assert.equal(texture.toString('ascii', 8, 12), 'WEBP');
  assert.equal(texture.readUInt32LE(4) + 8, texture.length);

  const chunks = [];
  let chunkOffset = 12;
  while (chunkOffset < texture.length) {
    assert.ok(
      chunkOffset + 8 <= texture.length,
      'WebP ended inside a chunk header',
    );
    const type = texture.toString('ascii', chunkOffset, chunkOffset + 4);
    const dataLength = texture.readUInt32LE(chunkOffset + 4);
    const dataOffset = chunkOffset + 8;
    const nextOffset = dataOffset + dataLength + (dataLength & 1);
    assert.ok(nextOffset <= texture.length, 'WebP ended inside chunk data');
    chunks.push({ type, dataOffset, dataLength });
    chunkOffset = nextOffset;
  }
  assert.equal(chunkOffset, texture.length);

  const extended = chunks.find(({ type }) => type === 'VP8X');
  assert.ok(extended, 'transparent WebP needs an extended header');
  const dimension = (offset) =>
    texture[extended.dataOffset + offset] |
    (texture[extended.dataOffset + offset + 1] << 8) |
    (texture[extended.dataOffset + offset + 2] << 16);
  assert.equal(dimension(4) + 1, 1024);
  assert.equal(dimension(7) + 1, 1024);
  assert.ok(chunks.some(({ type }) => type === 'ALPH'));
  assert.ok(chunks.some(({ type }) => type === 'VP8 '));
  assert.ok(statSync(HYDRANGEA_LEAF_URL).size < 120_000);
});

test('library index exports the complete Limelight runtime surface', () => {
  assert.equal(publicApi.Hydrangea.name, 'Hydrangea');
  assert.ok(publicApi.Hydrangea.prototype instanceof publicApi.PlantRenderer);
  assert.equal(publicApi.LIMELIGHT_PROFILE.cultivar, 'Limelight');
  assert.match(publicApi.LIMELIGHT_SOURCES.rhsCultivar.url, /rhs\.org\.uk/);
  assert.ok(publicApi.LIMELIGHT_CALENDAR.floweringStart > 1);

  for (const helper of [
    'getLimelightCalendar',
    'getLimelightPhenology',
    'getLimelightCareHints',
    'createLimelightModel',
    'evaluateLimelightModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function', `${helper} must export`);
  }

  const model = publicApi.createLimelightModel({
    seed: 'public-api-contract',
    maxYears: 3,
  });
  const snapshot = publicApi.evaluateLimelightModel(model, {
    ageYears: 3,
    dayOfYear: publicApi.LIMELIGHT_CALENDAR.floweringPeak,
    seasonProfile: 'late',
  });
  assert.equal(model.kind, 'hydrangea-limelight-growth-model');
  assert.equal(snapshot.phenology.seasonProfile, 'late');
  assert.equal(snapshot.species, 'Hydrangea paniculata');
});

test('app registry exposes Hydrangea as the complete default descriptor', () => {
  const registry = loadPlantRegistry();
  const descriptor = registry.PLANTS.hydrangea;

  assert.equal(registry.DEFAULT_PLANT_ID, 'hydrangea');
  assert.strictEqual(registry.getPlantDescriptor(), descriptor);
  assert.strictEqual(registry.getPlantDescriptor('missing'), descriptor);
  assert.ok(registry.PLANT_IDS.includes('hydrangea'));
  assert.equal(descriptor.id, 'hydrangea');
  assert.equal(descriptor.cultivar, 'Limelight');
  assert.equal(descriptor.species, 'Hydrangea paniculata');
  assert.strictEqual(descriptor.profile, publicApi.LIMELIGHT_PROFILE);
  assert.strictEqual(descriptor.sources, publicApi.LIMELIGHT_SOURCES);
  assert.deepEqual(descriptor.defaults, { age: 6, day: 230 });
  assert.equal(descriptor.maxYears, 30);
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
    descriptor.seasons.map(({ label }) => label),
    ['Winter heads', 'Leaf-out', 'Green buds', 'Lime', 'Cream', 'Pink', 'Dry'],
  );
  assert.deepEqual(
    descriptor.stats.map(({ key }) => key),
    ['visibleCanes', 'visibleLeaves', 'visiblePanicles', 'visibleDryPanicles'],
  );
  assert.equal(typeof descriptor.yieldLine.format, 'function');
  assert.ok(Array.isArray(descriptor.actions));
  assert.match(descriptor.modelNote, /shoots grown this season/i);
});

test('app create functions preserve deep-linked phenology profiles at construction', () => {
  const { PLANTS } = loadPlantRegistry();
  const baseState = {
    age: 9.25,
    day: 263,
  };

  const hydrangea = PLANTS.hydrangea.create({
    ...baseState,
    phenologyProfile: 'late',
  });
  assert.equal(hydrangea.kind, 'Hydrangea');
  assert.deepEqual(
    {
      ageYears: hydrangea.options.ageYears,
      dayOfYear: hydrangea.options.dayOfYear,
      seasonProfile: hydrangea.options.seasonProfile,
    },
    {
      ageYears: 9.25,
      dayOfYear: 263,
      seasonProfile: 'late',
    },
  );
  // The plant carries its own plate (library rule 7), so the demo app supplies
  // only the look-and-feel overrides and never the map itself.
  assert.equal(hydrangea.options.assets.leaf.map, undefined);

  const blackcurrant = PLANTS.blackcurrant.create({
    ...baseState,
    phenologyProfile: '2024',
  });
  assert.equal(blackcurrant.options.trialYear, '2024');

  const forsythia = PLANTS.forsythia.create({
    ...baseState,
    phenologyProfile: 'northeast',
  });
  assert.equal(forsythia.options.region, 'northeast');

  const leafWind = {
    enabled: true,
    strength: { x: 0.02, y: 0, z: 0.04 },
    frequency: 0.61,
  };
  const echinacea = PLANTS.echinacea.create({
    ...baseState,
    phenologyProfile: 'early',
    leafWind,
  });
  assert.equal(echinacea.kind, 'Echinacea');
  assert.deepEqual(
    {
      ageYears: echinacea.options.ageYears,
      dayOfYear: echinacea.options.dayOfYear,
      seasonProfile: echinacea.options.seasonProfile,
      leafWind: echinacea.options.leafWind,
    },
    {
      ageYears: 9.25,
      dayOfYear: 263,
      seasonProfile: 'early',
      leafWind,
    },
  );
});

test('declarations and React source expose Hydrangea options, stats and aliases', () => {
  const types = readFileSync(TYPES_SOURCE_URL, 'utf8');
  assert.match(types, /export interface HydrangeaOptions\s*\{/);
  assert.match(
    types,
    /export interface HydrangeaStats extends PlantRenderStats/,
  );
  assert.match(types, /export declare class Hydrangea extends PlantRenderer/);
  assert.match(types, /seasonProfile\?: LimelightSeasonProfile/);
  assert.match(types, /visiblePanicles: number/);
  assert.match(types, /visibleDryPanicles: number/);
  assert.match(types, /freshPanicles: number/);
  assert.match(types, /dryPanicles: number/);
  assert.match(types, /panicleBuds: number/);
  assert.match(types, /flowersOnCurrentSeasonWood: true/);

  const hydrangeaOptions = types.slice(
    types.indexOf('export interface HydrangeaOptions'),
    types.indexOf('export interface HydrangeaStats'),
  );
  assert.match(hydrangeaOptions, /events\?: readonly \[\]/);
  assert.doesNotMatch(hydrangeaOptions, /Partial<CareEvent>/);
  const evaluatorStart = types.indexOf(
    'export declare function evaluateLimelightModel',
  );
  const evaluatorOptions = types.slice(
    evaluatorStart,
    types.indexOf('): {', evaluatorStart),
  );
  assert.match(evaluatorOptions, /events\?: readonly \[\]/);
  assert.doesNotMatch(evaluatorOptions, /Partial<CareEvent>/);

  const react = readFileSync(REACT_SOURCE_URL, 'utf8');
  assert.match(react, /export interface HydrangeaProps/);
  assert.match(react, /export function HydrangeaPlant\s*\(/);
  assert.match(react, /new Hydrangea\s*\(\{/);
  assert.match(react, /HydrangeaPlant as Hydrangea/);
  assert.match(react, /type HydrangeaStats/);
});

test('the About panel links the Chicago trial it cites', () => {
  const html = readFileSync(APP_HTML_URL, 'utf8');
  assert.match(html, /measured RHS and Chicago\s+trial dimensions/i);
  assert.match(
    html,
    /https:\/\/www\.chicagobotanic\.org\/sites\/default\/files\/pdf\/plantevaluation\/no47_hydrangea\.pdf/,
  );
});
