import assert from 'node:assert/strict';
import test from 'node:test';

import { keyedRandom } from '../src/lib/keyed-random.js';
import {
  createHarvestEvent,
  createPruneEvent,
  createTiselModel,
  evaluateTiselModel,
} from '../src/lib/plants/blackcurrant/model.js';
import {
  TISEL_CALENDAR,
  TISEL_PHASE_ASSUMPTIONS,
  TISEL_TRIAL_OBSERVATIONS,
  dayOfYear,
  getTiselCareHints,
  getTiselPhenology,
} from '../src/lib/plants/blackcurrant/phenology.js';
import {
  METRES_PER_UNIT,
  TISEL_PROFILE,
  TISEL_SOURCES,
} from '../src/lib/plants/blackcurrant/tisel.js';

test('Tisel profile uses metres and a trunkless maintained shrub architecture', () => {
  assert.equal(METRES_PER_UNIT, 1);
  assert.equal(TISEL_PROFILE.architecture.hasTrunk, false);
  assert.equal(TISEL_PROFILE.architecture.initialCaneCount, 9);
  assert.deepEqual(TISEL_PROFILE.architecture.maintainedCaneRange, [6, 10]);
  assert.equal(TISEL_PROFILE.architecture.replacementCycleYears, 15);
  assert.match(TISEL_PROFILE.management.pruningMethod, /whole|complete/i);
  assert.equal(TISEL_PROFILE.yield.youngSecondYearKg, 1.55);
  assert.equal(TISEL_PROFILE.yield.matureTrialKg, 2.81);
  assert.match(TISEL_SOURCES.matureYield2015.url, /hortsci/i);
});

test('keyed random values are deterministic and isolated by organ key', () => {
  const baseline = keyedRandom('garden-42', 'cane:3', 'height');
  assert.equal(baseline, keyedRandom('garden-42', 'cane:3', 'height'));
  assert.notEqual(baseline, keyedRandom('garden-42', 'cane:4', 'height'));
  assert.ok(baseline >= 0 && baseline < 1);

  const firstCane = createTiselModel({ seed: 'same-garden' }).canes[0];
  assert.equal(firstCane.azimuth, 0.12283205221407115);
  assert.equal(firstCane.targetHeightM, 1.3537807111348958);
  assert.equal(firstCane.baseRadiusM, 0.01154111850936897);
});

test('the 50-year graph and A to B to A snapshots are reproducible', () => {
  const first = createTiselModel({ seed: 'same-garden' });
  const second = createTiselModel({ seed: 'same-garden' });
  assert.deepEqual(first, second);
  assert.equal(first.maxYears, 50);

  const ageA = evaluateTiselModel(first, { ageYears: 8, dayOfYear: 172 });
  evaluateTiselModel(first, { ageYears: 34, dayOfYear: 280 });
  const ageAAgain = evaluateTiselModel(first, {
    ageYears: 8,
    dayOfYear: 172,
  });
  assert.deepEqual(ageAAgain, ageA);
});

test('mutating a returned snapshot cannot corrupt the persistent model', () => {
  const model = createTiselModel({ seed: 'snapshot-isolation', maxYears: 8 });
  const baseline = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
  });
  const exposed = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
  });
  exposed.canes[0].position.x = 99;
  exposed.canes[0].axes[0].nodes[0].tangent.y = -99;
  const leaf = exposed.canes
    .flatMap((cane) => cane.axes)
    .flatMap((axis) => axis.nodes)
    .flatMap((node) => node.leaves)[0];
  if (leaf) leaf.normal.z = 99;

  assert.deepEqual(
    evaluateTiselModel(model, { ageYears: 5, dayOfYear: 175 }),
    baseline,
  );
});

test('stable cane, axis, node, leaf, raceme and berry IDs are unique', () => {
  const model = createTiselModel({ seed: 'id-check' });
  const ids = new Set();
  const addUnique = (id) => {
    assert.ok(!ids.has(id), `duplicate organ id: ${id}`);
    ids.add(id);
  };

  for (const cane of model.canes) {
    addUnique(cane.id);
    for (const axis of cane.axes) {
      addUnique(axis.id);
      for (const node of axis.nodes) {
        addUnique(node.id);
        for (const leaf of node.leaves) addUnique(leaf.id);
        for (const raceme of node.racemes) {
          addUnique(raceme.id);
          for (const berry of raceme.berries) addUnique(berry.id);
        }
      }
    }
  }
  assert.ok(ids.size > 1000);
});

test('bounded lateral cohorts emerge continuously across productive years', () => {
  const model = createTiselModel({ seed: 'axis-continuity', maxYears: 8 });
  const sourceCane = model.canes.find(
    (cane) => cane.birthAgeYears === 0 && cane.axes.length >= 4,
  );
  const cohortYears = new Set(
    sourceCane.axes
      .filter((axis) => axis.order === 1)
      .map((axis) => Math.floor(axis.birthAgeYears - sourceCane.birthAgeYears)),
  );
  assert.ok(cohortYears.size >= 3);

  const dormantSecondYear = evaluateTiselModel(model, {
    ageYears: 1,
    dayOfYear: 59,
  });
  const dormantNewYear = evaluateTiselModel(model, {
    ageYears: 1,
    dayOfYear: 1,
  });
  assert.ok(
    dormantSecondYear.canes.every((cane) =>
      cane.axes.every((axis) => axis.order === 0),
    ),
  );
  assert.deepEqual(
    dormantSecondYear.canes.map((cane) => cane.axes.map((axis) => axis.points)),
    dormantNewYear.canes.map((cane) => cane.axes.map((axis) => axis.points)),
  );

  const lateral = sourceCane.axes.find((axis) => axis.order === 1);
  const firstLateralRacemeYear = Math.min(
    ...lateral.nodes.flatMap((node) =>
      node.racemes.map((raceme) => raceme.fruitingYear),
    ),
  );
  assert.equal(firstLateralRacemeYear, Math.floor(lateral.birthAgeYears) + 1);
  const axisLength = (snapshotAxis) => {
    const start = snapshotAxis.points[0];
    const end = snapshotAxis.points.at(-1);
    return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  };
  const birthYear = Math.floor(lateral.birthAgeYears);
  const birthDay = Math.min(
    365,
    Math.ceil((lateral.birthAgeYears - birthYear) * 365) + 1,
  );
  const snapshotAt = (dayOfYear) =>
    evaluateTiselModel(model, { ageYears: birthYear, dayOfYear });
  const findAxis = (snapshot) =>
    snapshot.canes
      .flatMap((cane) => cane.axes)
      .find((axis) => axis.id === lateral.id);

  assert.equal(findAxis(snapshotAt(birthDay - 1)), undefined);
  assert.equal(axisLength(findAxis(snapshotAt(birthDay))), 0);
  const justAfter = axisLength(findAxis(snapshotAt(birthDay + 2)));
  const established = axisLength(findAxis(snapshotAt(260)));
  assert.ok(justAfter > 0 && justAfter < 0.02);
  assert.ok(established > justAfter);

  const attached = snapshotAt(Math.min(260, birthDay + 45));
  const grownLateral = findAxis(attached);
  const parentNode = attached.canes
    .flatMap((cane) => cane.axes)
    .flatMap((axis) => axis.nodes)
    .find((node) => node.id === lateral.parentId);
  assert.ok(parentNode);
  assert.ok(
    Math.hypot(
      grownLateral.points[0].x - parentNode.position.x,
      grownLateral.points[0].y - parentNode.position.y,
      grownLateral.points[0].z - parentNode.position.z,
    ) < 1e-9,
  );
});

test('basal renewal canes emerge from zero during spring instead of appearing in winter', () => {
  const model = createTiselModel({ seed: 'winter-birth-probe', maxYears: 8 });
  const renewal = model.canes.find((cane) => cane.cohort === 'renewal');
  const birthYear = Math.floor(renewal.birthAgeYears);
  const birthDay = Math.ceil((renewal.birthAgeYears - birthYear) * 365 + 1);

  assert.ok(birthDay >= TISEL_PROFILE.growth.renewalEmergenceDayRange[0]);
  assert.ok(birthDay <= TISEL_PROFILE.growth.renewalEmergenceDayRange[1] + 1);
  const winter = evaluateTiselModel(model, {
    ageYears: birthYear,
    dayOfYear: 1,
  });
  assert.equal(
    winter.canes.some((cane) => cane.id === renewal.id),
    false,
  );

  const atEmergence = evaluateTiselModel(model, {
    ageYears: birthYear,
    dayOfYear: birthDay,
  }).canes.find((cane) => cane.id === renewal.id);
  assert.ok(atEmergence);
  assert.ok(atEmergence.height < 0.005);
  assert.ok(atEmergence.growthScale < 0.005);
  assert.ok(atEmergence.axes.every((axis) => axis.growthScale < 0.005));

  const midsummer = evaluateTiselModel(model, {
    ageYears: birthYear,
    dayOfYear: 200,
  }).canes.find((cane) => cane.id === renewal.id);
  assert.ok(midsummer.height > atEmergence.height);
  assert.ok(midsummer.growthScale > atEmergence.growthScale);
});

test('thermal offsets shift stable renewal and lateral emergence without changing IDs', () => {
  const model = createTiselModel({ seed: 'offset-growth-births', maxYears: 8 });
  const renewal = model.canes.find((cane) => cane.cohort === 'renewal');
  const sourceYear = Math.floor(renewal.birthAgeYears);
  const sourceDay = Math.ceil((renewal.birthAgeYears - sourceYear) * 365) + 1;
  const earlyDay = sourceDay - 45;

  const meanBefore = evaluateTiselModel(model, {
    ageYears: sourceYear,
    dayOfYear: earlyDay,
  });
  const shiftedAtBirth = evaluateTiselModel(model, {
    ageYears: sourceYear,
    dayOfYear: earlyDay,
    offsetDays: -45,
  });
  const shiftedLater = evaluateTiselModel(model, {
    ageYears: sourceYear,
    dayOfYear: Math.min(365, earlyDay + 30),
    offsetDays: -45,
  });
  assert.equal(
    meanBefore.canes.some((cane) => cane.id === renewal.id),
    false,
  );
  const emerged = shiftedAtBirth.canes.find((cane) => cane.id === renewal.id);
  assert.ok(emerged);
  assert.ok(emerged.growthScale < 0.005);
  assert.equal(emerged.id, renewal.id);
  assert.ok(
    shiftedLater.canes.find((cane) => cane.id === renewal.id).growthScale >
      emerged.growthScale,
  );

  const delayed = evaluateTiselModel(model, {
    ageYears: sourceYear,
    dayOfYear: sourceDay,
    offsetDays: 45,
  });
  assert.equal(
    delayed.canes.some((cane) => cane.id === renewal.id),
    false,
  );
});

test('new leaves unfold locally instead of appearing at full size', () => {
  const model = createTiselModel({ seed: 'leaf-unfold', maxYears: 4 });
  const sourceNode = model.canes
    .find((cane) => cane.birthAgeYears === 0)
    .axes.find((axis) => axis.order === 0)
    .nodes.at(-1);
  const birthYear = Math.floor(sourceNode.birthAgeYears);
  const birthDay = Math.min(
    365,
    Math.ceil((sourceNode.birthAgeYears - birthYear) * 365) + 1,
  );
  const leafId = sourceNode.leaves.find((leaf) => leaf.year === birthYear).id;
  const leafAt = (dayOfYear) =>
    evaluateTiselModel(model, { ageYears: birthYear, dayOfYear })
      .canes.flatMap((cane) => cane.axes)
      .flatMap((axis) => axis.nodes)
      .flatMap((node) => node.leaves)
      .find((leaf) => leaf.id === leafId);

  assert.equal(leafAt(birthDay - 1), undefined);
  const emerging = leafAt(birthDay);
  const unfolded = leafAt(Math.min(365, birthDay + 24));
  assert.ok(emerging.unfoldProgress >= 0 && emerging.unfoldProgress < 0.1);
  assert.ok(unfolded.unfoldProgress > emerging.unfoldProgress);
  assert.ok(unfolded.scale > emerging.scale);
});

test('maintenance holds 6-10 canes and replaces the stool every 15 years', () => {
  const model = createTiselModel({ seed: 'maintenance' });
  for (let age = 0; age <= 50; age += 1) {
    const snapshot = evaluateTiselModel(model, {
      ageYears: age,
      dayOfYear: 172,
    });
    assert.ok(
      snapshot.stats.activeCanes >= 6 && snapshot.stats.activeCanes <= 10,
      `age ${age} had ${snapshot.stats.activeCanes} canes`,
    );
  }

  const before = evaluateTiselModel(model, { ageYears: 14, dayOfYear: 172 });
  const after = evaluateTiselModel(model, { ageYears: 15, dayOfYear: 172 });
  assert.equal(before.cycleIndex, 0);
  assert.equal(after.cycleIndex, 1);
  assert.equal(after.stats.activeCanes, 9);
  assert.ok(before.canes.every((cane) => cane.cycleIndex === 0));
  assert.ok(after.canes.every((cane) => cane.cycleIndex === 1));
});

test('care age resets with each 15-year replacement stool', () => {
  const model = createTiselModel({ seed: 'care-cycle' });
  for (const ageYears of [0, 15, 30, 45]) {
    const snapshot = evaluateTiselModel(model, {
      ageYears,
      dayOfYear: 30,
    });
    assert.ok(snapshot.careHints.some((hint) => hint.id === 'plant-dormant'));
    assert.ok(
      snapshot.careHints.every((hint) => hint.id !== 'prune-old-canes'),
    );
  }
  for (const ageYears of [1, 16, 31, 46]) {
    const snapshot = evaluateTiselModel(model, {
      ageYears,
      dayOfYear: 30,
    });
    assert.ok(
      snapshot.careHints.every((hint) => hint.id !== 'prune-old-canes'),
    );
  }
});

test('whole-cane pruning is reversible when evaluating either side of the event', () => {
  const model = createTiselModel({ seed: 'pruning' });
  const baseline = evaluateTiselModel(model, { ageYears: 5, dayOfYear: 90 });
  const caneId = baseline.canes[0].id;
  const prune = createPruneEvent({
    id: 'winter-cut-1',
    caneId,
    ageYears: 5,
    dayOfYear: 100,
  });

  const before = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 90,
    events: [prune],
  });
  const after = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 120,
    events: [prune],
  });
  const beforeAgain = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 90,
    events: [prune],
  });
  assert.ok(before.canes.some((cane) => cane.id === caneId));
  assert.ok(after.canes.every((cane) => cane.id !== caneId));
  assert.deepEqual(beforeAgain, before);
  assert.deepEqual(model.canes, createTiselModel({ seed: 'pruning' }).canes);
});

test('remaining crop estimate responds to simulated fruiting capacity', () => {
  const model = createTiselModel({ seed: 'yield-after-pruning', maxYears: 8 });
  const baseline = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
  });
  const prunes = baseline.canes.slice(0, 3).map((cane, index) =>
    createPruneEvent({
      id: `yield-prune-${index}`,
      caneId: cane.id,
      ageYears: 5,
      dayOfYear: 30,
    }),
  );
  const reduced = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
    events: prunes,
  });

  assert.ok(reduced.stats.yieldCapacityRatio > 0);
  assert.ok(reduced.stats.yieldCapacityRatio < 1);
  assert.ok(reduced.stats.estimatedYieldKg < baseline.stats.estimatedYieldKg);
  assert.ok(
    reduced.stats.renderedFruitSampleKg < baseline.stats.renderedFruitSampleKg,
  );
});

test('a harvest event hides and logs only that growing season crop', () => {
  const model = createTiselModel({ seed: 'harvest' });
  const ripe = evaluateTiselModel(model, {
    ageYears: 3,
    dayOfYear: TISEL_CALENDAR.harvestStart,
  });
  assert.ok(ripe.stats.ripeBerries > 0);

  const harvest = createHarvestEvent({
    id: 'crop-log-3',
    ageYears: 3,
    dayOfYear: TISEL_CALENDAR.harvestStart,
    amountKg: 1.25,
    note: 'freezer batch',
  });
  assert.equal(harvest.amountKg, 1.25);
  assert.equal(harvest.note, 'freezer batch');
  const picked = evaluateTiselModel(model, {
    ageYears: 3,
    dayOfYear: TISEL_CALENDAR.harvestStart,
    events: [harvest],
  });
  const rewound = evaluateTiselModel(model, {
    ageYears: 3,
    dayOfYear: 160,
    events: [harvest],
  });
  const nextYear = evaluateTiselModel(model, {
    ageYears: 4,
    dayOfYear: TISEL_CALENDAR.harvestStart,
    events: [harvest],
  });
  assert.equal(picked.stats.ripeBerries, 0);
  assert.ok(picked.stats.harvestedBerries > 0);
  assert.equal(rewound.stats.harvestedBerries, 0);
  assert.ok(nextYear.stats.harvestedBerries === 0);
});

test('central-Poland phenology windows expose expected BBCH boundaries', () => {
  assert.equal(dayOfYear('04-15'), TISEL_CALENDAR.floweringStart);
  assert.equal(dayOfYear('06-09'), TISEL_CALENDAR.colouringStart);
  assert.equal(dayOfYear('06-24'), TISEL_CALENDAR.harvestStart);
  assert.equal(getTiselPhenology('04-15').phase, 'flowering');
  assert.equal(getTiselPhenology('04-26').bbch, '69');
  assert.equal(getTiselPhenology('04-27').phase, 'fruit-set');
  assert.equal(getTiselPhenology('06-09').phase, 'colouring');
  assert.equal(getTiselPhenology('06-21').bbch, '87');
  assert.equal(getTiselPhenology('06-24').phase, 'ripe');
  assert.equal(getTiselPhenology('06-24').ripeProgress, 1);
  assert.equal(getTiselPhenology('06-24').harvestProgress, 0);
  assert.equal(getTiselPhenology('07-01').bbch, '89');
  assert.equal(getTiselPhenology('07-02').phase, 'overripe');
  assert.equal(getTiselPhenology('09-16').phase, 'autumn');
  assert.equal(getTiselPhenology('12-15').bbch, '00');

  const model = createTiselModel({ seed: 'maturity-boundary', maxYears: 8 });
  const beforeMaturity = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestStart - 1,
  });
  const atMaturity = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestStart,
  });
  assert.equal(beforeMaturity.stats.ripeBerries, 0);
  assert.ok(beforeMaturity.stats.greenBerries > 0);
  assert.ok(atMaturity.stats.ripeBerries > 0);
});

test('calendar parsing uses valid local civil dates and coherent dormancy care', () => {
  assert.equal(dayOfYear(new Date(2026, 3, 15)), dayOfYear('04-15'));
  assert.throws(() => dayOfYear('02-31'), /Expected/);
  assert.throws(() => dayOfYear('04-31'), /Expected/);
  assert.throws(() => dayOfYear(999), /between 1 and 365/);
  assert.throws(
    () => getTiselCareHints(30, { plantAgeYears: Infinity }),
    /plantAgeYears/,
  );

  const dormant = getTiselCareHints(TISEL_CALENDAR.dormantEnd, {
    plantAgeYears: 0,
  });
  const emerged = getTiselCareHints(TISEL_CALENDAR.leafEmergenceStart, {
    plantAgeYears: 0,
  });
  assert.ok(dormant.some((hint) => hint.id === 'plant-dormant'));
  assert.ok(emerged.every((hint) => hint.id !== 'plant-dormant'));
});

test('trial-year phenology profiles keep observations separate from modeled durations', () => {
  assert.equal(TISEL_PHASE_ASSUMPTIONS.floweringDurationDays, 12);
  assert.equal(TISEL_PHASE_ASSUMPTIONS.colouringDurationDays, 14);
  assert.equal(TISEL_PHASE_ASSUMPTIONS.overripeRetentionDays, 25);
  assert.equal(TISEL_TRIAL_OBSERVATIONS[2024].fullMaturity, dayOfYear('06-11'));

  for (const trialYear of [2022, 2023, 2024, 'mean']) {
    const observation = TISEL_TRIAL_OBSERVATIONS[trialYear];
    const atFlowering = getTiselPhenology(observation.floweringOnset, {
      trialYear,
    });
    const atColouring = getTiselPhenology(observation.colouringOnset, {
      trialYear,
    });
    const atMaturity = getTiselPhenology(observation.fullMaturity, {
      trialYear,
    });
    assert.equal(atFlowering.phase, 'flowering');
    assert.equal(atColouring.phase, 'colouring');
    assert.equal(atMaturity.phase, 'ripe');
    assert.ok(
      atFlowering.calendar.floweringStart < atFlowering.calendar.colouringStart,
    );
    assert.ok(
      atFlowering.calendar.colouringStart <= atFlowering.calendar.harvestStart,
    );
  }

  const baseline = getTiselPhenology('04-15');
  const delayed = getTiselPhenology('04-15', { offsetDays: 10 });
  assert.equal(
    delayed.calendar.floweringStart,
    baseline.calendar.floweringStart + 10,
  );
  assert.ok(delayed.leafProgress < baseline.leafProgress);
  assert.throws(
    () => getTiselPhenology('04-15', { trialYear: 2025 }),
    /trialYear/,
  );
  assert.throws(
    () => getTiselPhenology('04-15', { offsetDays: Infinity }),
    /offsetDays/,
  );

  const model = createTiselModel({ seed: 'trial-profile-threading' });
  const early2024 = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_TRIAL_OBSERVATIONS[2024].fullMaturity,
    trialYear: 2024,
  });
  assert.equal(early2024.phenology.phase, 'ripe');
  assert.equal(early2024.phenology.trialYear, 2024);
  assert.ok(early2024.careHints.some((hint) => hint.id === 'harvest-tisel'));
});

test('pre-flowering racemes are buds, while unpicked ripe fruit drops explicitly', () => {
  const model = createTiselModel({
    seed: 'organ-stage-semantics',
    maxYears: 8,
  });
  const budStage = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.floweringStart - 10,
  });
  const openStage = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.floweringStart,
  });
  assert.equal(budStage.stats.flowers, 0);
  assert.ok(budStage.stats.flowerBuds > 0);
  assert.ok(openStage.stats.flowers > 0);

  const ripe = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.harvestEnd,
  });
  const overripeDay = Math.round(
    (TISEL_CALENDAR.harvestEnd + TISEL_CALENDAR.fruitDropEnd) / 2,
  );
  const overripe = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: overripeDay,
  });
  const dropped = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: TISEL_CALENDAR.fruitDropEnd,
  });
  assert.equal(overripe.phenology.phase, 'overripe');
  assert.ok(overripe.stats.ripeBerries > 0);
  assert.ok(overripe.stats.ripeBerries < ripe.stats.ripeBerries);
  assert.ok(overripe.stats.droppedBerries > 0);
  assert.ok(overripe.stats.estimatedYieldKg < ripe.stats.estimatedYieldKg);
  assert.ok(
    overripe.careHints.some((hint) => hint.id === 'record-overripe-loss'),
  );
  assert.equal(dropped.phenology.phase, 'post-harvest');
  assert.equal(dropped.stats.ripeBerries, 0);
  assert.equal(dropped.stats.estimatedYieldKg, 0);

  const racemeId = ripe.canes
    .flatMap((cane) => cane.axes)
    .flatMap((axis) => axis.nodes)
    .flatMap((node) => node.racemes)[0].id;
  const partial = createHarvestEvent({
    id: 'partial-first',
    ageYears: 5,
    dayOfYear: 190,
    racemeId,
  });
  const allLater = createHarvestEvent({
    id: 'all-later',
    ageYears: 5,
    dayOfYear: 195,
  });
  const targetStatuses = (snapshot) =>
    snapshot.canes
      .flatMap((cane) => cane.axes)
      .flatMap((axis) => axis.nodes)
      .flatMap((node) => node.racemes)
      .find((raceme) => raceme.id === racemeId)
      .berries.map(({ harvested, dropped }) => ({ harvested, dropped }));
  const partialOnly = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 200,
    events: [partial],
  });
  const mixedOrder = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 200,
    events: [allLater, partial],
  });
  assert.deepEqual(targetStatuses(mixedOrder), targetStatuses(partialOnly));
});

test('young-cane height, seasonal leaf fall and crop estimates follow source anchors', () => {
  const model = createTiselModel({ seed: 'calibration' });
  const firstSummer = evaluateTiselModel(model, {
    ageYears: 0,
    dayOfYear: 175,
  });
  const secondSummer = evaluateTiselModel(model, {
    ageYears: 1,
    dayOfYear: 175,
  });
  const youngCrop = evaluateTiselModel(model, {
    ageYears: 1,
    dayOfYear: 175,
  });
  const matureSummer = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
  });
  const matureAutumn = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 288,
  });
  const matureSummerAgain = evaluateTiselModel(model, {
    ageYears: 5,
    dayOfYear: 175,
  });

  assert.ok(firstSummer.dimensions.height >= 0.5);
  assert.ok(firstSummer.dimensions.height <= 0.8);
  assert.ok(secondSummer.dimensions.height > firstSummer.dimensions.height);
  assert.ok(secondSummer.dimensions.height < matureSummer.dimensions.height);
  assert.equal(youngCrop.stats.estimatedYieldKg, 1.55);
  assert.equal(matureSummer.stats.estimatedYieldKg, 2.81);
  assert.ok(
    matureSummer.stats.renderedFruitSampleKg <
      matureSummer.stats.estimatedYieldKg,
  );
  assert.ok(matureAutumn.stats.leaves > 0);
  assert.ok(matureAutumn.stats.leaves < matureSummer.stats.leaves);
  assert.deepEqual(matureSummerAgain, matureSummer);
});

test('all sampled snapshot dimensions and coordinates remain finite', () => {
  const model = createTiselModel({ seed: 'finite' });
  for (const ageYears of [0, 1, 4, 14, 15, 29, 30, 45, 50]) {
    for (const day of [20, 100, 172, 280]) {
      const snapshot = evaluateTiselModel(model, { ageYears, dayOfYear: day });
      assert.ok(Number.isFinite(snapshot.dimensions.height));
      assert.ok(Number.isFinite(snapshot.dimensions.radius));
      assert.ok(snapshot.dimensions.height >= 0);
      for (const cane of snapshot.canes) {
        assert.ok(Number.isFinite(cane.height));
        for (const axis of cane.axes) {
          for (const point of axis.points) {
            assert.ok([point.x, point.y, point.z].every(Number.isFinite));
          }
        }
      }
    }
  }
});

test('stable organ history never extends past the requested model horizon', () => {
  for (const maxYears of [1, 8, 50]) {
    const model = createTiselModel({ seed: `horizon-${maxYears}`, maxYears });
    for (const cane of model.canes) {
      for (const axis of cane.axes) {
        assert.ok(axis.birthAgeYears < cane.naturalDeathAgeYears);
        assert.ok(axis.birthAgeYears < maxYears + 1);
        for (const node of axis.nodes) {
          assert.ok(node.leaves.every((leaf) => leaf.year <= maxYears));
          assert.ok(
            node.racemes.every((raceme) => raceme.fruitingYear <= maxYears),
          );
        }
      }
    }
  }
});

test('the year and day coordinates cannot describe two different simulation times', () => {
  const model = createTiselModel({ seed: 'integer-year-contract' });
  assert.throws(
    () => evaluateTiselModel(model, { ageYears: 14.9, dayOfYear: 365 }),
    /integer/,
  );
  assert.throws(
    () =>
      createPruneEvent({
        caneId: 'cane:1',
        ageYears: 4.2,
        dayOfYear: 30,
      }),
    /integer/,
  );
  assert.throws(
    () => createHarvestEvent({ ageYears: 4, dayOfYear: 30.5 }),
    /integer/,
  );
  assert.throws(
    () =>
      evaluateTiselModel(model, {
        ageYears: 4,
        dayOfYear: 30,
        events: [{ id: 'fractional-event', type: 'inspection', ageYears: 3.5 }],
      }),
    /event ageYears.*integer/,
  );
  assert.throws(
    () => evaluateTiselModel(model, { events: [null] }),
    /event ageYears/,
  );

  const replacement = evaluateTiselModel(model, {
    ageYears: 15,
    dayOfYear: 1,
  });
  assert.equal(replacement.cycleIndex, 1);
  assert.equal(replacement.cycleAgeYears, 0);
  assert.ok(replacement.canes.every((cane) => cane.birthAgeYears >= 15));
});

test('leap day maps consistently to the leap-neutral 1 March simulation day', () => {
  const leapDate = new Date(2024, 1, 29);
  assert.equal(dayOfYear(leapDate), dayOfYear('2024-02-29'));
  assert.equal(dayOfYear('02-29'), dayOfYear('03-01'));
  assert.equal(dayOfYear('2024-02-29'), 60);
  assert.throws(() => dayOfYear('2023-02-29'), /Expected/);
});
