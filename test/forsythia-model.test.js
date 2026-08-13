import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLynwoodModel,
  createPruneEvent,
  evaluateLynwoodModel,
  lynwoodEventTime,
} from '../src/lib/plants/forsythia/model.js';
import {
  LYNWOOD_CALENDAR,
  LYNWOOD_PHASE_ASSUMPTIONS,
  LYNWOOD_REGION_OBSERVATIONS,
  dayOfYear,
  getLynwoodCareHints,
  getLynwoodPhenology,
} from '../src/lib/plants/forsythia/phenology.js';
import {
  LYNWOOD_PROFILE,
  LYNWOOD_SOURCES,
  METRES_PER_UNIT,
} from '../src/lib/plants/forsythia/lynwood.js';

/* -------------------------------------------------------------------- *
 * Profile
 * -------------------------------------------------------------------- */

test('Lynwood profile is a trunkless multi-cane shrub sized to the RHS envelope', () => {
  assert.equal(METRES_PER_UNIT, 1);
  assert.equal(LYNWOOD_PROFILE.architecture.hasTrunk, false);
  assert.equal(LYNWOOD_PROFILE.species, 'Forsythia × intermedia');
  assert.equal(LYNWOOD_PROFILE.cultivar, 'Lynwood');

  const [minHeight, maxHeight] =
    LYNWOOD_PROFILE.architecture.rhsUltimateHeightRangeM;
  assert.ok(
    LYNWOOD_PROFILE.architecture.matureHeightM >= minHeight &&
      LYNWOOD_PROFILE.architecture.matureHeightM <= maxHeight,
    'modelled mature height must sit inside the published RHS range',
  );
  // Every cane must be able to reach the modelled mature height.
  assert.ok(
    LYNWOOD_PROFILE.cane.targetHeightM[1] >=
      LYNWOOD_PROFILE.architecture.matureHeightM,
  );
  assert.match(LYNWOOD_SOURCES.rhsCultivar.url, /rhs\.org\.uk/);
  assert.match(LYNWOOD_SOURCES.polishSeason.supports, /central Poland/i);
});

test('leaves are opposite and decussate, not alternate', () => {
  assert.equal(LYNWOOD_PROFILE.leaf.arrangement, 'opposite-decussate');
  assert.equal(LYNWOOD_PROFILE.leaf.leavesPerNode, 2);
  assert.equal(LYNWOOD_PROFILE.leaf.decussateTurnRadians, Math.PI / 2);
});

test('flowers are four-lobed and borne on one- and two-year-old wood', () => {
  assert.equal(LYNWOOD_PROFILE.flower.corollaLobes, 4);
  assert.equal(LYNWOOD_PROFILE.flower.precedesLeaves, true);
  assert.deepEqual(LYNWOOD_PROFILE.flower.bornOnWoodAgeYears, [1, 2]);
  assert.deepEqual(LYNWOOD_PROFILE.flower.perNodeRange, [1, 6]);
});

test('pruning follows flowering rather than dormancy', () => {
  const management = LYNWOOD_PROFILE.management;
  assert.equal(management.pruningWindow, 'immediately after flowering');
  assert.equal(management.oldestCaneRemovalFraction, 1 / 5);
  // Mid-July: pruning later removes the wood carrying next spring's buds.
  assert.equal(management.latestSafePruningDay, 196);
  assert.ok(management.latestSafePruningDay > LYNWOOD_CALENDAR.floweringEnd);
});

/* -------------------------------------------------------------------- *
 * Phenology
 * -------------------------------------------------------------------- */

test('the calendar orders bud swelling, flowering and leaf-out correctly', () => {
  const c = LYNWOOD_CALENDAR;
  assert.ok(c.dormantEnd < c.budSwellingStart);
  assert.ok(c.budSwellingStart < c.floweringStart);
  assert.ok(c.floweringStart < c.floweringPeak);
  assert.ok(c.floweringPeak < c.floweringEnd);
  // The defining overlap: leaves break while the last flowers are still on.
  assert.ok(
    c.leafEmergenceStart > c.floweringStart &&
      c.leafEmergenceStart < c.floweringEnd,
    'leaf emergence must begin inside the flowering window',
  );
  assert.ok(c.leafFullExpansion > c.floweringEnd);
  assert.ok(c.autumnStart < c.leafFallEnd);
});

test('flowering opens on genuinely bare wood', () => {
  const onset = getLynwoodPhenology(LYNWOOD_CALENDAR.floweringStart);
  assert.ok(onset.flowerOpenVisibility > 0, 'flowers must be open at onset');
  assert.equal(onset.leafOpacity, 0, 'no leaf may be showing at flower onset');
  assert.equal(onset.bareWoodFlowering, true);
  assert.equal(onset.flowersPrecedeLeaves, true);

  const peak = getLynwoodPhenology(LYNWOOD_CALENDAR.floweringPeak);
  assert.ok(peak.flowerOpenVisibility > 0.9);
  assert.equal(peak.leafOpacity, 0);
});

test('full summer canopy carries no flowers', () => {
  const summer = getLynwoodPhenology(200);
  assert.equal(summer.flowerOpenVisibility, 0);
  assert.equal(summer.flowerBudVisibility, 0);
  assert.equal(summer.leafOpacity, 1);
  assert.equal(summer.phase, 'summer-canopy');
});

test('closed buds precede open corollas and hand over at the peak', () => {
  const budDay = LYNWOOD_CALENDAR.budSwellingStart + 14;
  const buds = getLynwoodPhenology(budDay);
  assert.ok(buds.flowerBudVisibility > 0);
  assert.equal(buds.flowerOpenVisibility, 0);
  assert.equal(buds.leafOpacity, 0);

  const peak = getLynwoodPhenology(LYNWOOD_CALENDAR.floweringPeak);
  assert.equal(peak.flowerBudVisibility, 0, 'all buds are open by the peak');
});

test('leaves fall by the end of the autumn window and winter is bare', () => {
  assert.equal(
    getLynwoodPhenology(LYNWOOD_CALENDAR.leafFallEnd).leafOpacity,
    0,
  );
  const winter = getLynwoodPhenology(20);
  assert.equal(winter.leafOpacity, 0);
  assert.equal(winter.flowerOpenVisibility, 0);
  assert.equal(winter.phase, 'dormant');
  assert.equal(winter.bbch, '00');
});

test('the north-east region runs 10-14 days behind central Poland', () => {
  const central = LYNWOOD_REGION_OBSERVATIONS.central.floweringOnset;
  const northeast = LYNWOOD_REGION_OBSERVATIONS.northeast.floweringOnset;
  const lag = northeast - central;
  assert.ok(lag >= 10 && lag <= 14, `expected a 10-14 day lag, got ${lag}`);

  const shifted = getLynwoodPhenology(100, { region: 'northeast' });
  assert.equal(shifted.calendar.floweringStart, northeast);
  assert.match(shifted.regionLabel, /north-east/i);
});

test('phenology rejects unknown regions and out-of-range offsets', () => {
  assert.throws(
    () => getLynwoodPhenology(100, { region: 'mars' }),
    /region must be/,
  );
  assert.throws(
    () => getLynwoodPhenology(100, { offsetDays: 90 }),
    /offsetDays/,
  );
});

test('phase durations are declared as renderer assumptions', () => {
  assert.match(LYNWOOD_PHASE_ASSUMPTIONS.note, /renderer assumptions/i);
  assert.ok(LYNWOOD_PHASE_ASSUMPTIONS.floweringDurationDays > 0);
});

test('dayOfYear accepts dates, strings and numbers on a 365-day calendar', () => {
  assert.equal(dayOfYear(1), 1);
  assert.equal(dayOfYear('03-29'), 88);
  assert.equal(dayOfYear('2025-03-29'), 88);
  assert.equal(dayOfYear(new Date(2025, 2, 29)), 88);
  // Leap day collapses onto 1 March so every simulated year is 365 days.
  assert.equal(dayOfYear('2024-02-29'), dayOfYear('03-01'));
  assert.throws(() => dayOfYear(0), RangeError);
  assert.throws(() => dayOfYear(366), RangeError);
  assert.throws(() => dayOfYear('nonsense'), TypeError);
});

/* -------------------------------------------------------------------- *
 * Care hints
 * -------------------------------------------------------------------- */

test('care hints tell you to prune after flowering and to stop by mid-July', () => {
  const afterFlowering = getLynwoodCareHints(
    LYNWOOD_CALENDAR.floweringEnd + 5,
    {
      plantAgeYears: 6,
    },
  );
  const pruneHint = afterFlowering.find(
    (h) => h.id === 'prune-after-flowering',
  );
  assert.ok(pruneHint, 'expected a post-flowering pruning hint');
  assert.match(pruneHint.message, /one fifth|oldest stems/i);
  assert.match(pruneHint.source, /rhs\.org\.uk/);

  const august = getLynwoodCareHints(230, { plantAgeYears: 6 });
  assert.ok(
    august.some((h) => h.id === 'no-late-pruning'),
    'late summer must warn against pruning away next spring flowers',
  );
  assert.ok(!august.some((h) => h.id === 'prune-after-flowering'));
});

test('no pruning hint is offered during the flowering display', () => {
  const hints = getLynwoodCareHints(LYNWOOD_CALENDAR.floweringPeak, {
    plantAgeYears: 8,
  });
  assert.ok(!hints.some((hint) => hint.category === 'pruning'));
  assert.ok(hints.some((hint) => hint.id === 'flowering-watch'));
});

test('young plants are not told to renew, and care hints validate age', () => {
  const young = getLynwoodCareHints(LYNWOOD_CALENDAR.floweringEnd + 5, {
    plantAgeYears: 1,
  });
  assert.ok(!young.some((hint) => hint.id === 'prune-after-flowering'));
  assert.throws(
    () => getLynwoodCareHints(100, { plantAgeYears: -1 }),
    RangeError,
  );
});

/* -------------------------------------------------------------------- *
 * Growth model
 * -------------------------------------------------------------------- */

test('the graph is deterministic and A to B to A snapshots are reproducible', () => {
  const first = createLynwoodModel({ seed: 'same-garden' });
  const second = createLynwoodModel({ seed: 'same-garden' });
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'forsythia-growth-model');
  assert.equal(first.maxYears, 50);

  const ageA = evaluateLynwoodModel(first, { ageYears: 6, dayOfYear: 96 });
  evaluateLynwoodModel(first, { ageYears: 30, dayOfYear: 280 });
  const ageAAgain = evaluateLynwoodModel(first, { ageYears: 6, dayOfYear: 96 });
  assert.deepEqual(ageA, ageAAgain);
});

test('model options are validated', () => {
  assert.throws(() => createLynwoodModel({ maxYears: 0 }), RangeError);
  assert.throws(() => createLynwoodModel({ maxYears: 51 }), RangeError);
  assert.throws(() => createLynwoodModel({ seed: {} }), TypeError);

  const model = createLynwoodModel({ seed: 1, maxYears: 10 });
  assert.throws(
    () => evaluateLynwoodModel(model, { ageYears: 11 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLynwoodModel(model, { ageYears: 1.5 }),
    RangeError,
  );
  assert.throws(
    () => evaluateLynwoodModel(model, { scenario: 'wild' }),
    RangeError,
  );
  assert.throws(() => evaluateLynwoodModel({ kind: 'nope' }), TypeError);
});

test('no leaf and no flower ever coexist at the flowering peak', () => {
  const model = createLynwoodModel({ seed: 'bare-wood', maxYears: 20 });
  for (const ageYears of [2, 4, 6, 9, 14]) {
    const snapshot = evaluateLynwoodModel(model, {
      ageYears,
      dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
    });
    assert.equal(
      snapshot.stats.visibleLeaves,
      0,
      `age ${ageYears} must be leafless at peak flowering`,
    );
    assert.ok(
      snapshot.stats.visibleFlowers > 0,
      `age ${ageYears} must be flowering at peak flowering`,
    );
    assert.equal(snapshot.stats.bareWoodFlowering, true);
  }
});

test('an established shrub flowers at least as hard as a young one', () => {
  const model = createLynwoodModel({ seed: 'flower-load', maxYears: 20 });
  const at = (ageYears) =>
    evaluateLynwoodModel(model, {
      ageYears,
      dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
    }).stats.visibleFlowers;

  // A plant in its first spring has no one-year-old wood yet.
  assert.equal(at(0), 0);
  assert.ok(at(2) > 0);
  // Established plants keep producing young flowering wood; the display must
  // not collapse as the shrub matures.
  for (const ageYears of [5, 8, 12, 16]) {
    assert.ok(
      at(ageYears) > at(2) * 0.5,
      `age ${ageYears} flower load (${at(ageYears)}) collapsed against age 2 (${at(2)})`,
    );
  }
});

test('mature dimensions land in the published garden size envelope', () => {
  const model = createLynwoodModel({ seed: 'size', maxYears: 20 });
  const snapshot = evaluateLynwoodModel(model, { ageYears: 8, dayOfYear: 200 });
  const { heightM, spreadM } = snapshot.dimensions;
  const [minHeight] = LYNWOOD_PROFILE.architecture.rhsUltimateHeightRangeM;

  assert.ok(
    heightM >= minHeight &&
      heightM <= LYNWOOD_PROFILE.architecture.unmanagedHeightM,
    `height ${heightM} outside 1.5-3 m`,
  );
  assert.ok(spreadM > 1.2 && spreadM < 3.2, `spread ${spreadM} implausible`);
});

test('maintained cane count stays inside the profile range once established', () => {
  const model = createLynwoodModel({ seed: 'canes', maxYears: 20 });
  const [minCanes, maxCanes] = LYNWOOD_PROFILE.architecture.maintainedCaneRange;
  for (const ageYears of [4, 6, 8, 11, 15]) {
    const { visibleCanes } = evaluateLynwoodModel(model, {
      ageYears,
      dayOfYear: 200,
    }).stats;
    assert.ok(
      visibleCanes >= minCanes && visibleCanes <= maxCanes,
      `age ${ageYears} had ${visibleCanes} canes, outside ${minCanes}-${maxCanes}`,
    );
  }
});

test('capsules stay a sparse, non-ornamental presence', () => {
  const model = createLynwoodModel({ seed: 'capsules', maxYears: 20 });
  const summer = evaluateLynwoodModel(model, { ageYears: 8, dayOfYear: 200 });
  assert.equal(LYNWOOD_PROFILE.capsule.ornamental, false);
  // A thrum-eyed clone sets almost no seed: capsules must never read as a crop.
  assert.ok(
    summer.stats.visibleCapsules < summer.stats.visibleLeaves * 0.05,
    'capsules must remain far rarer than leaves',
  );
  // Nothing is in fruit while the plant is flowering on bare wood.
  const spring = evaluateLynwoodModel(model, {
    ageYears: 8,
    dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
  });
  assert.equal(spring.stats.visibleCapsules, 0);
});

test('neglected shrubs keep canes that a maintained one has renewed away', () => {
  const model = createLynwoodModel({ seed: 'scenario', maxYears: 20 });
  const maintained = evaluateLynwoodModel(model, {
    ageYears: 12,
    dayOfYear: 200,
    scenario: 'maintained',
  });
  const neglected = evaluateLynwoodModel(model, {
    ageYears: 12,
    dayOfYear: 200,
    scenario: 'neglected',
  });
  assert.ok(neglected.stats.visibleCanes >= maintained.stats.visibleCanes);
});

test('prune events remove exactly their target cane', () => {
  const model = createLynwoodModel({ seed: 'prune', maxYears: 20 });
  const before = evaluateLynwoodModel(model, { ageYears: 8, dayOfYear: 200 });
  const victim = before.canes[0].id;
  const after = evaluateLynwoodModel(model, {
    ageYears: 8,
    dayOfYear: 200,
    events: [createPruneEvent({ caneId: victim, ageYears: 8, dayOfYear: 130 })],
  });

  assert.equal(after.stats.visibleCanes, before.stats.visibleCanes - 1);
  assert.ok(!after.canes.some((cane) => cane.id === victim));
  assert.ok(after.appliedEvents.length === 1);
});

test('events scheduled in the future are not applied yet', () => {
  const model = createLynwoodModel({ seed: 'future', maxYears: 20 });
  const baseline = evaluateLynwoodModel(model, { ageYears: 8, dayOfYear: 130 });
  const victim = baseline.canes[0].id;
  const withFutureEvent = evaluateLynwoodModel(model, {
    ageYears: 8,
    dayOfYear: 130,
    events: [createPruneEvent({ caneId: victim, ageYears: 9, dayOfYear: 130 })],
  });
  assert.equal(withFutureEvent.stats.visibleCanes, baseline.stats.visibleCanes);
  assert.deepEqual(withFutureEvent.appliedEvents, []);
});

test('prune event construction is validated and ordered by time', () => {
  assert.throws(() => createPruneEvent({ ageYears: 3 }), TypeError);
  assert.throws(
    () => createPruneEvent({ caneId: 'a', ageYears: 1.5 }),
    TypeError,
  );
  assert.throws(
    () => createPruneEvent({ caneId: 'a', ageYears: 3, dayOfYear: 400 }),
    RangeError,
  );
  assert.ok(
    lynwoodEventTime({ ageYears: 3, dayOfYear: 1 }) <
      lynwoodEventTime({ ageYears: 3, dayOfYear: 200 }),
  );
});

test('modelled blades match the published 4-10 x 2-5 cm proportions', () => {
  const model = createLynwoodModel({ seed: 'blade', maxYears: 20 });
  const leaves = [];
  for (const cane of model.canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) leaves.push(...node.leaves);
    }
  }
  assert.ok(leaves.length > 0);
  for (const leaf of leaves.slice(0, 500)) {
    assert.ok(
      leaf.lengthM >= 0.04 && leaf.lengthM <= 0.1,
      `blade length ${leaf.lengthM} outside 4-10 cm`,
    );
    assert.ok(
      leaf.widthM >= 0.02 && leaf.widthM <= 0.05,
      `blade width ${leaf.widthM} outside 2-5 cm`,
    );
  }
});
