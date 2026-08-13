import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PlantRenderer } from '../src/lib/plant-renderer.js';
import { Forsythia } from '../src/lib/plants/forsythia/forsythia.js';
import { LYNWOOD_PROFILE } from '../src/lib/plants/forsythia/lynwood.js';
import { Hydrangea } from '../src/lib/plants/hydrangea/hydrangea.js';
import { LIMELIGHT_PROFILE } from '../src/lib/plants/hydrangea/limelight.js';

function minimalProfile(overrides = {}) {
  return {
    species: 'Test species',
    cultivar: 'Test',
    unit: 'metre',
    cane: {
      axisRadiusFactors: { primary: 1, lateral: 0.3, higherOrder: 0.2 },
      childParentRadiusRatio: 0.5,
      axisTaperRatios: [1, 0.8, 0.5, 0.2],
    },
    ...overrides,
  };
}

test('the base renderer validates what every plant needs', () => {
  assert.throws(() => new PlantRenderer(), TypeError);
  assert.throws(
    () => new PlantRenderer({ profile: minimalProfile() }),
    /organ kind/,
  );
  assert.throws(
    () =>
      new PlantRenderer({
        profile: minimalProfile(),
        organKinds: ['leaves'],
        plantId: '   ',
      }),
    /plantId/,
  );
});

test('the base renderer lays out the shared group structure', () => {
  const plant = new PlantRenderer({
    profile: minimalProfile(),
    organKinds: ['leaves'],
    namePrefix: 'Test',
  });

  const names = [];
  plant.traverse((object) => names.push(object.name));
  assert.ok(names.includes('Test_Crown'));
  assert.ok(names.includes('Test_WoodyArchitecture'));
  assert.ok(names.includes('Test_Leaves'));
  assert.ok(names.includes('Test_Inflorescences'));
  assert.ok(names.includes('Test_Fruit'));
  assert.equal(plant.userData.species, 'Test species');
});

test('_evaluate and _applySnapshot are abstract', () => {
  const plant = new PlantRenderer({
    profile: minimalProfile(),
    organKinds: ['leaves'],
  });
  assert.throws(() => plant._evaluate(), /must implement/);
  assert.throws(() => plant._applySnapshot(), /must implement/);
});

test('age validation is shared and reports the plant maximum', () => {
  assert.throws(
    () => PlantRenderer.simulationYear(1.5, 0, 50),
    /between 0 and 50/,
  );
  assert.equal(PlantRenderer.simulationYear(99, 0, 20), 20);
  assert.equal(PlantRenderer.simulationYear(-4, 0, 20), 0);
  assert.equal(PlantRenderer.number(Number.NaN, 7), 7);
});

test('species renderers are built on the shared base, not private copies', () => {
  const plants = [
    new Forsythia({ seed: 3, maxYears: 10, ageYears: 4 }),
    new Hydrangea({ seed: 3, maxYears: 10, ageYears: 4 }),
  ];
  try {
    for (const plant of plants) {
      assert.ok(plant instanceof PlantRenderer);
      assert.ok(plant instanceof THREE.Group);
      // The shared state cycle, event handling and teardown are inherited.
      for (const method of [
        'setTime',
        'setState',
        'addEvent',
        'resetEvents',
        'update',
        'dispose',
      ]) {
        assert.equal(
          typeof plant[method],
          'function',
          `${method} must come from the shared base`,
        );
      }
      assert.equal(plant.maxYears, 10);
    }
  } finally {
    for (const plant of plants) plant.dispose();
  }
});

test('species profiles share the woody contract the base consumes', () => {
  // The base reads exactly these fields when building axis runtimes, so a new
  // plant added to the library must declare them.
  for (const [name, profile] of [
    ['Lynwood', LYNWOOD_PROFILE],
    ['Limelight', LIMELIGHT_PROFILE],
  ]) {
    for (const key of [
      'axisRadiusFactors',
      'childParentRadiusRatio',
      'axisTaperRatios',
    ]) {
      assert.ok(
        Object.hasOwn(profile.cane, key),
        `${name} profile is missing cane.${key}`,
      );
    }
    const factors = profile.cane.axisRadiusFactors;
    assert.ok(factors.primary >= factors.lateral);
    assert.ok(factors.lateral >= factors.higherOrder);
  }
});
