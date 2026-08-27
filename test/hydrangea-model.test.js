import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLimelightModel,
  evaluateLimelightModel,
} from '../src/lib/plants/hydrangea/model.js';
import { LIMELIGHT_CALENDAR } from '../src/lib/plants/hydrangea/phenology.js';
import { LIMELIGHT_PROFILE } from '../src/lib/plants/hydrangea/limelight.js';

const MODEL_SEED = 'limelight-model-test';
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const vectorLength = (value) => Math.hypot(value.x, value.y, value.z);
const angularDifference = (a, b) => {
  const tau = Math.PI * 2;
  const signed = ((((a - b + Math.PI) % tau) + tau) % tau) - Math.PI;
  return Math.abs(signed);
};

function allAxes(value) {
  return value.canes.flatMap((cane) => cane.axes);
}

function allLeaves(value) {
  return allAxes(value).flatMap((axis) =>
    axis.nodes.flatMap((node) => node.leaves),
  );
}

function assertFiniteVector(value, label) {
  assert.ok(Number.isFinite(value.x), `${label}.x must be finite`);
  assert.ok(Number.isFinite(value.y), `${label}.y must be finite`);
  assert.ok(Number.isFinite(value.z), `${label}.z must be finite`);
}

test('the persistent graph is deeply frozen, deterministic and bounded', () => {
  const first = createLimelightModel({ seed: MODEL_SEED, maxYears: 30 });
  const second = createLimelightModel({ seed: MODEL_SEED, maxYears: 30 });

  assert.deepEqual(first, second);
  assert.equal(first.kind, 'hydrangea-limelight-growth-model');
  assert.equal(first.maxYears, 30);
  assert.equal(first.canes.length, 12);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.canes), true);
  assert.equal(Object.isFrozen(first.canes[0].axes[0].nodes[0]), true);

  const axes = allAxes(first);
  const leaves = allLeaves(first);
  assert.ok(axes.length >= 70 && axes.length <= 110);
  assert.ok(leaves.length > 1500 && leaves.length < 2500);
  assert.equal(axes.length, new Set(axes.map((axis) => axis.id)).size);
  assert.equal(leaves.length, new Set(leaves.map((leaf) => leaf.id)).size);
  assert.equal(
    axes.length,
    new Set(axes.map((axis) => axis.terminalPanicle.id)).size,
  );
});

test('every child axis follows its parent and starts at the exact attachment node', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });

  for (const cane of model.canes) {
    const seenNodes = new Map();
    for (const axis of cane.axes) {
      if (axis.order > 0) {
        assert.ok(
          seenNodes.has(axis.parentId),
          `${axis.id} must appear after parent node ${axis.parentId}`,
        );
        assert.deepEqual(axis.points[0], seenNodes.get(axis.parentId).position);
      }
      for (const node of axis.nodes) seenNodes.set(node.id, node);
    }
  }

  const snapshot = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 230,
  });
  const evaluatedNodes = new Map(
    allAxes(snapshot).flatMap((axis) =>
      axis.nodes.map((node) => [node.id, node]),
    ),
  );
  for (const axis of allAxes(snapshot).filter(
    (candidate) => candidate.order > 0,
  )) {
    const parent = evaluatedNodes.get(axis.parentId);
    assert.ok(parent, `missing evaluated parent node ${axis.parentId}`);
    assert.ok(distance(axis.root, parent.position) < 1e-12);
  }
});

test('static and evaluated coordinates remain finite', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  for (const cane of model.canes) {
    assertFiniteVector(cane.position, cane.id);
    for (const axis of cane.axes) {
      axis.points.forEach((point, index) =>
        assertFiniteVector(point, `${axis.id}:point:${index}`),
      );
      for (const node of axis.nodes) {
        assertFiniteVector(node.position, node.id);
        assertFiniteVector(node.tangent, `${node.id}:tangent`);
        for (const leaf of node.leaves) {
          assertFiniteVector(leaf.position, leaf.id);
          assertFiniteVector(leaf.normal, `${leaf.id}:normal`);
        }
      }
      assertFiniteVector(
        axis.terminalPanicle.position,
        axis.terminalPanicle.id,
      );
      assertFiniteVector(
        axis.terminalPanicle.direction,
        `${axis.terminalPanicle.id}:direction`,
      );
    }
  }

  const snapshot = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 230,
  });
  for (const axis of allAxes(snapshot)) {
    assertFiniteVector(axis.root, `${axis.id}:root`);
    for (const node of axis.nodes) {
      assertFiniteVector(node.position, node.id);
      for (const leaf of node.leaves)
        assertFiniteVector(leaf.position, leaf.id);
    }
    assertFiniteVector(axis.terminalPanicle.position, axis.terminalPanicle.id);
  }
  assert.ok(Number.isFinite(snapshot.dimensions.heightM));
  assert.ok(Number.isFinite(snapshot.dimensions.spreadM));
});

test('leaves form opposite decussate pairs with the patented blade proportions', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  let checkedPairs = 0;
  let checkedTurns = 0;

  for (const axis of allAxes(model)) {
    for (const node of axis.nodes) {
      assert.ok(node.leaves.length === 2 || node.leaves.length === 3);
      for (const leaf of node.leaves) {
        assert.ok(leaf.lengthM >= 0.085 && leaf.lengthM <= 0.1);
        assert.ok(leaf.widthM >= 0.04 && leaf.widthM <= 0.055);
        assert.ok(leaf.widthM / leaf.lengthM >= 0.44);
        assert.ok(leaf.widthM / leaf.lengthM <= 0.56);
      }
      if (node.leaves.length === 2) {
        assert.ok(
          Math.abs(
            angularDifference(node.leaves[0].azimuth, node.leaves[1].azimuth) -
              Math.PI,
          ) < 0.22,
        );
        checkedPairs += 1;
      }
    }

    for (let index = 1; index < axis.nodes.length; index += 1) {
      const previous = axis.nodes[index - 1].leaves[0].azimuth;
      const current = axis.nodes[index].leaves[0].azimuth;
      const rankTurn = angularDifference(current, previous);
      assert.ok(Math.abs(rankTurn - Math.PI / 2) < 0.22);
      checkedTurns += 1;
    }
  }

  assert.ok(checkedPairs > 500);
  assert.ok(checkedTurns > 500);
  assert.equal(
    LIMELIGHT_PROFILE.leaf.arrangement,
    'opposite, commonly decussate',
  );
});

test('every panicle is terminal and its position means peduncle start', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });

  for (const axis of allAxes(model)) {
    const panicle = axis.terminalPanicle;
    assert.deepEqual(panicle.position, axis.points.at(-1));
    assert.ok(Math.abs(vectorLength(panicle.direction) - 1) < 1e-12);
    assert.ok(panicle.peduncleLengthM >= 0.12);
    assert.ok(panicle.peduncleLengthM <= 0.2);
    assert.ok(panicle.lengthM >= 0.12 && panicle.lengthM <= 0.26);
    assert.ok(panicle.widthM >= 0.098 && panicle.widthM <= 0.19);
    assert.ok(panicle.sterileFraction >= 0.8 && panicle.sterileFraction <= 1);
    assert.ok(
      panicle.firstFloweringYear >= Math.max(1, Math.ceil(axis.birthAgeYears)),
    );
  }
});

test('Limelight flowers sparsely from year one on the current season shoots', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const beforePanicles = evaluateLimelightModel(model, {
    ageYears: 1,
    dayOfYear: LIMELIGHT_CALENDAR.panicleInitiationStart - 1,
  });
  const greenBud = evaluateLimelightModel(model, {
    ageYears: 1,
    dayOfYear: LIMELIGHT_CALENDAR.visiblePanicleBudStart + 4,
  });
  const summer = evaluateLimelightModel(model, {
    ageYears: 1,
    dayOfYear: LIMELIGHT_CALENDAR.floweringPeak,
  });
  const mature = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.floweringPeak,
  });

  assert.equal(beforePanicles.stats.visiblePanicles, 0);
  assert.ok(greenBud.stats.panicleBuds > 0);
  assert.ok(summer.stats.freshPanicles > 0);
  assert.ok(summer.stats.freshPanicles < mature.stats.freshPanicles / 2);
  assert.equal(summer.stats.flowersOnCurrentSeasonWood, true);
  assert.equal(LIMELIGHT_PROFILE.flowering.wood, 'current-season growth');
});

test('age growth is monotonic, matures in the evidence window and then plateaus', () => {
  const model = createLimelightModel({ seed: MODEL_SEED, maxYears: 30 });
  const snapshots = [0, 1, 2, 4, 7, 10, 30].map((ageYears) =>
    evaluateLimelightModel(model, { ageYears, dayOfYear: 230 }),
  );

  for (let index = 1; index < snapshots.length; index += 1) {
    assert.ok(
      snapshots[index].dimensions.heightM >=
        snapshots[index - 1].dimensions.heightM,
    );
    assert.ok(
      snapshots[index].dimensions.spreadM >=
        snapshots[index - 1].dimensions.spreadM,
    );
    assert.ok(
      snapshots[index].stats.visiblePanicles >=
        snapshots[index - 1].stats.visiblePanicles,
    );
  }

  assert.deepEqual(snapshots.at(-1).dimensions, snapshots.at(-2).dimensions);
  assert.deepEqual(snapshots.at(-1).stats, snapshots.at(-2).stats);
});

test('the mature display matches the trial size and photographed head load', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const mature = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.floweringPeak,
  });

  assert.ok(mature.dimensions.heightM >= 1.55);
  assert.ok(mature.dimensions.heightM <= 1.9);
  assert.ok(mature.dimensions.spreadM >= 2);
  assert.ok(mature.dimensions.spreadM <= 2.45);
  assert.ok(mature.stats.visiblePanicles >= 60);
  assert.ok(mature.stats.visiblePanicles <= 100);
  assert.ok(mature.stats.visibleLeaves < 2500);
});

test('winter heads persist, medium spring pruning clears them, and new summer heads replace them', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const winter = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 20,
  });
  const afterPruning = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.previousPaniclePruneEnd,
  });
  const summer = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.floweringPeak,
  });

  assert.equal(winter.stats.visibleLeaves, 0);
  assert.ok(winter.stats.dryPanicles >= 60);
  assert.equal(winter.stats.freshPanicles, 0);
  assert.equal(afterPruning.stats.visiblePanicles, 0);
  assert.ok(summer.stats.freshPanicles >= 60);
  assert.equal(summer.stats.dryPanicles, 0);
});

test('new framework cohorts emerge only through spring and never grow in dormancy', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const beforeGrowth = evaluateLimelightModel(model, {
    ageYears: 0,
    dayOfYear: LIMELIGHT_CALENDAR.shootEmergenceStart - 1,
  });
  const midGrowth = evaluateLimelightModel(model, {
    ageYears: 0,
    dayOfYear: 155,
  });
  const extensionEnd = evaluateLimelightModel(model, {
    ageYears: 0,
    dayOfYear: LIMELIGHT_PROFILE.growth.shootExtensionEndDay,
  });
  const dormantEnd = evaluateLimelightModel(model, {
    ageYears: 0,
    dayOfYear: 365,
  });

  assert.ok(allAxes(beforeGrowth).every((axis) => axis.growthScale === 0));
  assert.ok(
    allAxes(midGrowth).some(
      (axis) => axis.growthScale > 0 && axis.growthScale < 1,
    ),
  );
  const emergingLeaves = allLeaves(midGrowth).filter(
    (leaf) => leaf.visible && leaf.scale < 0.5,
  );
  assert.ok(
    emergingLeaves.length > 0,
    'new cohort leaves should unfold locally instead of appearing full-sized',
  );
  assert.deepEqual(
    allAxes(dormantEnd).map((axis) => axis.id),
    allAxes(extensionEnd).map((axis) => axis.id),
  );
  assert.deepEqual(
    allAxes(dormantEnd).map((axis) => ({
      id: axis.id,
      growthScale: axis.growthScale,
      nodes: axis.nodes.map((node) => node.position),
    })),
    allAxes(extensionEnd).map((axis) => ({
      id: axis.id,
      growthScale: axis.growthScale,
      nodes: axis.nodes.map((node) => node.position),
    })),
  );
  assert.deepEqual(dormantEnd.dimensions, extensionEnd.dimensions);
});

test('established wood stays fixed while a distinct current-season shoot extends', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const before = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.shootEmergenceStart - 1,
  });
  const middle = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 155,
  });
  const full = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_PROFILE.growth.shootExtensionEndDay,
  });
  const firstAxis = (snapshot) => allAxes(snapshot)[0];

  assert.deepEqual(
    firstAxis(before).nodes.map((node) => node.position),
    firstAxis(middle).nodes.map((node) => node.position),
  );
  assert.deepEqual(
    firstAxis(before).nodes.map((node) => node.position),
    firstAxis(full).nodes.map((node) => node.position),
  );
  const shoots = [before, middle, full].map(
    (snapshot) => firstAxis(snapshot).terminalPanicle.currentShoot,
  );
  assert.equal(shoots[0].lengthM, 0);
  assert.ok(shoots[1].lengthM > 0);
  assert.ok(shoots[1].lengthM < shoots[2].lengthM);
  assert.ok(distance(shoots[2].root, shoots[2].tip) > 0.05);
});

test('autumn leaf abscission is gradual, keyed per leaf and A-B-A exact', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  const start = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.autumnStart,
  });
  const middle = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 296,
  });
  const late = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.leafFallEnd - 1,
  });
  const fallen = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: LIMELIGHT_CALENDAR.leafFallEnd,
  });
  const middleAgain = evaluateLimelightModel(model, {
    ageYears: 10,
    dayOfYear: 296,
  });
  const visibleIds = (snapshot) =>
    allLeaves(snapshot)
      .filter((leaf) => leaf.visible)
      .map((leaf) => leaf.id);

  assert.ok(start.stats.visibleLeaves > middle.stats.visibleLeaves);
  assert.ok(middle.stats.visibleLeaves > late.stats.visibleLeaves);
  assert.ok(late.stats.visibleLeaves > fallen.stats.visibleLeaves);
  assert.equal(fallen.stats.visibleLeaves, 0);
  assert.deepEqual(visibleIds(middleAgain), visibleIds(middle));
});

test('juvenile stages and care never claim heads that the age cannot carry', () => {
  const model = createLimelightModel({ seed: MODEL_SEED });
  for (const dayOfYear of [30, 230]) {
    const juvenile = evaluateLimelightModel(model, {
      ageYears: 0,
      dayOfYear,
    });
    assert.equal(juvenile.stats.visiblePanicles, 0);
    assert.doesNotMatch(
      juvenile.phenology.stage,
      /full display|retained dry panicles/i,
    );
    assert.equal(juvenile.careHints.length, 0);
  }
});

test('A-B-A evaluation is reproducible and ages 20-21 never reset', () => {
  const model = createLimelightModel({ seed: MODEL_SEED, maxYears: 30 });
  const ageA = evaluateLimelightModel(model, {
    ageYears: 7,
    dayOfYear: 230,
    seasonProfile: 'late',
  });
  evaluateLimelightModel(model, {
    ageYears: 21,
    dayOfYear: 300,
  });
  const ageAAgain = evaluateLimelightModel(model, {
    ageYears: 7,
    dayOfYear: 230,
    seasonProfile: 'late',
  });
  assert.deepEqual(ageAAgain, ageA);

  const year20 = evaluateLimelightModel(model, {
    ageYears: 20,
    dayOfYear: 230,
  });
  const year21 = evaluateLimelightModel(model, {
    ageYears: 21,
    dayOfYear: 230,
  });
  assert.equal(year20.ageYears, 20);
  assert.equal(year21.ageYears, 21);
  assert.ok(year20.stats.visiblePanicles >= 60);
  assert.deepEqual(year21.dimensions, year20.dimensions);
  assert.deepEqual(year21.stats, year20.stats);
  assert.deepEqual(
    allAxes(year21).map((axis) => axis.id),
    allAxes(year20).map((axis) => axis.id),
  );
});

test('every day, profile and age in a bounded model evaluates safely', () => {
  const model = createLimelightModel({
    seed: 'limelight-full-sweep',
    maxYears: 2,
  });

  for (let ageYears = 0; ageYears <= model.maxYears; ageYears += 1) {
    for (let dayOfYear = 1; dayOfYear <= 365; dayOfYear += 1) {
      for (const seasonProfile of ['typical', 'early', 'late']) {
        const snapshot = evaluateLimelightModel(model, {
          ageYears,
          dayOfYear,
          seasonProfile,
        });
        assert.equal(snapshot.ageYears, ageYears);
        assert.equal(snapshot.dayOfYear, dayOfYear);
        assert.equal(snapshot.phenology.seasonProfile, seasonProfile);
        assert.ok(Number.isFinite(snapshot.dimensions.heightM));
        assert.ok(Number.isFinite(snapshot.dimensions.spreadM));
      }
    }
  }
});

test('model, evaluator and unsupported event inputs are rejected', () => {
  assert.throws(() => createLimelightModel({ maxYears: 0 }), RangeError);
  assert.throws(() => createLimelightModel({ maxYears: 51 }), RangeError);
  assert.throws(() => createLimelightModel({ seed: {} }), TypeError);

  const model = createLimelightModel({ seed: MODEL_SEED, maxYears: 10 });
  assert.throws(() => evaluateLimelightModel({ kind: 'wrong' }), TypeError);
  assert.throws(
    () => evaluateLimelightModel(model, { ageYears: -1 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { ageYears: 1.5 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { ageYears: 11 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { dayOfYear: 0 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { seasonProfile: 'mars' }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { offsetDays: 31 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLimelightModel(model, { events: null }),
    TypeError,
  );
  assert.throws(
    () =>
      evaluateLimelightModel(model, {
        events: [{ id: 'wrong-prune', type: 'prune' }],
      }),
    /does not expose destructive care events/,
  );
});
