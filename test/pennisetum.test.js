import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';

import * as publicApi from '../src/lib/index.js';
import {
  createBladeGeometry,
  createBottlebrushGeometry,
  createBottlebrushTexture,
} from '../src/lib/plants/pennisetum/geometry.js';

const CALENDAR = publicApi.HAMELN_CALENDAR;

function meshNamed(plant, name) {
  let result = null;
  plant.traverse((object) => {
    if (object.isMesh && object.name === name) result = object;
  });
  assert.ok(result, 'missing ' + name);
  return result;
}

function inclinationDegrees(from, to) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  return (Math.atan2(Math.hypot(x, z), y) * 180) / Math.PI;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

test('Hameln is a source-backed compact bottlebrush fountain grass', () => {
  const profile = publicApi.HAMELN_PROFILE;
  assert.equal(profile.species, 'Pennisetum alopecuroides');
  assert.equal(profile.cultivar, 'Hameln');
  assert.equal(profile.architecture.woody, false);
  assert.match(profile.panicle.form, /bottlebrush/i);
  assert.deepEqual(profile.architecture.rhsUltimateHeightRangeM, [0.5, 1]);
  assert.deepEqual(profile.architecture.rhsUltimateSpreadRangeM, [0.5, 1]);
  for (const source of Object.values(publicApi.HAMELN_SOURCES)) {
    if (source.url) assert.match(source.url, /^https:\/\//);
  }
});

test('the stable annual model is deterministic and fits the cited envelope', () => {
  const first = publicApi.createHamelnModel({ seed: 'hameln', maxYears: 20 });
  const second = publicApi.createHamelnModel({ seed: 'hameln', maxYears: 20 });
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'pennisetum-hameln-growth-model');
  assert.ok(first.tillers.length <= 140);

  const snapshot = publicApi.evaluateHamelnModel(first, {
    ageYears: 12,
    dayOfYear: 230,
  });
  assert.ok(snapshot.dimensions.heightM >= 0.5);
  assert.ok(snapshot.dimensions.heightM <= 1);
  assert.ok(snapshot.dimensions.spreadM >= 0.5);
  assert.ok(snapshot.dimensions.spreadM <= 1.02);
  assert.ok(snapshot.stats.visiblePanicles > 40);
});

test('mature culms curve into a broad nested fountain instead of rigid pickets', () => {
  const model = publicApi.createHamelnModel({ seed: 1964, maxYears: 20 });
  const snapshot = publicApi.evaluateHamelnModel(model, {
    ageYears: 5,
    dayOfYear: 230,
  });
  const tipAngles = [];
  const curvature = [];
  const headAngles = [];

  for (const tiller of snapshot.tillers) {
    for (const culm of tiller.culms) {
      if (culm.cohort !== 'current') continue;
      const points = culm.points;
      const base = inclinationDegrees(points[0], points[1]);
      const tip = inclinationDegrees(points.at(-2), points.at(-1));
      tipAngles.push(tip);
      curvature.push(tip - base);
      if (culm.panicle?.visible) {
        const direction = culm.panicle.direction;
        headAngles.push(
          (Math.atan2(
            Math.hypot(direction.x, direction.z),
            direction.y,
          ) *
            180) /
            Math.PI,
        );
      }
    }
  }

  assert.ok(median(tipAngles) > 28);
  assert.ok(median(curvature) > 24);
  assert.ok(headAngles.filter((angle) => angle >= 35).length > 50);
  assert.ok(snapshot.dimensions.spreadM > snapshot.dimensions.heightM * 1.08);
  assert.ok(snapshot.dimensions.spreadM < snapshot.dimensions.heightM * 1.25);

  const archVariants = new Set(
    model.tillers.flatMap((tiller) =>
      tiller.nodes.map((node) => node.blade?.archVariant),
    ),
  );
  assert.ok(archVariants.has(0));
  assert.ok(archVariants.has(1));
  assert.ok(archVariants.has(2));
});

test('phenology orders spring cut, growth, early heads and autumn colour', () => {
  assert.ok(CALENDAR.cutbackEnd < CALENDAR.emergenceStart);
  assert.ok(CALENDAR.foliageFullExpansion < CALENDAR.panicleEmergenceStart);
  assert.ok(CALENDAR.panicleEmergenceStart < CALENDAR.headMaturingStart);
  assert.ok(CALENDAR.headMaturingStart < CALENDAR.autumnStart);

  const heading = publicApi.getHamelnPhenology(
    CALENDAR.panicleEmergenceStart + 3,
  );
  assert.ok(heading.paniclePush > 0);
  assert.match(heading.plumeColourStage, /cream/);

  const winter = publicApi.getHamelnPhenology(20);
  assert.equal(winter.phase, 'standing-dry');
  assert.ok(winter.previousWeatheringProgress > 0);
});

test('fine blades and crossed bottlebrushes honour the unit-organ contract', () => {
  const blade = createBladeGeometry();
  const head = createBottlebrushGeometry();
  try {
    blade.computeBoundingBox();
    head.computeBoundingBox();
    assert.ok(blade.boundingBox.min.y >= -1e-6);
    assert.ok(blade.boundingBox.max.y <= 1.01);
    assert.ok(head.boundingBox.min.y >= -1e-6);
    assert.ok(head.boundingBox.max.y <= 1.01);
    assert.ok(head.attributes.uv);
    assert.ok(head.attributes.color);
    assert.equal(head.userData.organ, 'bottlebrush-inflorescence');
    assert.ok(head.index.count / 3 <= 24);
  } finally {
    blade.dispose();
    head.dispose();
  }
});

test('the generated bottlebrush map carries a dense core and a soft alpha edge', () => {
  const texture = createBottlebrushTexture({ width: 32, height: 64 });
  try {
    assert.ok(texture instanceof THREE.DataTexture);
    const data = texture.image.data;
    const alpha = [];
    for (let index = 3; index < data.length; index += 4)
      alpha.push(data[index]);
    assert.ok(Math.max(...alpha) > 240);
    assert.ok(Math.min(...alpha) < 20);
    assert.ok(alpha.some((value) => value > 20 && value < 230));
  } finally {
    texture.dispose();
  }
});

test('renderer uses three stable pools, no wood, and the exact LOD draw budget', () => {
  const plant = new publicApi.Pennisetum({
    seed: 1964,
    ageYears: 5,
    dayOfYear: 230,
  });
  try {
    assert.ok(plant instanceof publicApi.PlantRenderer);
    assert.equal(plant.cultivar, 'Hameln');
    assert.equal(plant.userData.species, 'Pennisetum alopecuroides');
    assert.equal(meshNamed(plant, 'Pennisetum_Wood').visible, false);
    assert.ok(meshNamed(plant, 'Pennisetum_Blades').count > 400);
    assert.ok(meshNamed(plant, 'Pennisetum_Panicles').count > 40);
    assert.deepEqual(
      plant.lodLevels.map((_, level) => {
        plant.setLevel(level);
        return plant.stats().drawCalls;
      }),
      [3, 2, 2],
    );
  } finally {
    plant.dispose();
  }
});

test('public, React and declaration front doors all expose Pennisetum', () => {
  assert.equal(publicApi.Pennisetum.name, 'Pennisetum');
  for (const helper of [
    'getHamelnCalendar',
    'getHamelnPhenology',
    'getHamelnCareHints',
    'createHamelnModel',
    'evaluateHamelnModel',
  ]) {
    assert.equal(typeof publicApi[helper], 'function');
  }

  const react = readFileSync(
    new URL('../src/react/index.tsx', import.meta.url),
    'utf8',
  );
  const types = readFileSync(
    new URL('../types/plants.d.ts', import.meta.url),
    'utf8',
  );
  assert.match(react, /export function PennisetumPlant\(/);
  assert.match(react, /PennisetumPlant as Pennisetum/);
  assert.match(types, /export declare class Pennisetum extends PlantRenderer/);
  assert.match(types, /export interface PennisetumOptions/);
  assert.match(types, /export interface HamelnPhenology/);
});
