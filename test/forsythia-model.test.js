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
  LYNWOOD_RENDER_PRIORS,
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

test('closed buds precede open corollas and finish opening just after the peak', () => {
  const budDay = LYNWOOD_CALENDAR.budSwellingStart + 14;
  const buds = getLynwoodPhenology(budDay);
  assert.ok(buds.flowerBudVisibility > 0);
  assert.equal(buds.flowerOpenVisibility, 0);
  assert.equal(buds.leafOpacity, 0);

  const peak = getLynwoodPhenology(LYNWOOD_CALENDAR.floweringPeak);
  assert.ok(
    peak.flowerBudVisibility > 0,
    'the latest staggered clusters must still be in bud at the global peak',
  );
  const latestOpeningDay = Math.ceil(
    LYNWOOD_CALENDAR.floweringStart +
      LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[1] +
      LYNWOOD_RENDER_PRIORS.corollaOpeningDays,
  );
  const fullyOpen = getLynwoodPhenology(latestOpeningDay);
  assert.equal(fullyOpen.flowerBudVisibility, 0);
  assert.ok(fullyOpen.flowerOpenVisibility > 0);
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

test('establishment begins with four canes and builds a mixed-age stool', () => {
  const model = createLynwoodModel({ seed: 19460412, maxYears: 10 });
  const summerCounts = [0, 1, 2, 3].map(
    (ageYears) =>
      evaluateLynwoodModel(model, {
        ageYears,
        dayOfYear: 200,
      }).stats.visibleCanes,
  );
  assert.deepEqual(summerCounts, [4, 6, 8, 10]);

  const maturePeak = evaluateLynwoodModel(model, {
    ageYears: 6,
    dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
  });
  const matureSummer = evaluateLynwoodModel(model, {
    ageYears: 6,
    dayOfYear: 200,
  });
  assert.equal(maturePeak.stats.visibleCanes, 14);
  assert.equal(matureSummer.stats.visibleCanes, 14);
  assert.ok(
    new Set(maturePeak.canes.map((cane) => Math.floor(cane.birthAgeYears)))
      .size >= 5,
    'a mature stool should not consist of one synchronized founding cohort',
  );
});

test('schema 2 stays compact while preserving the lazy axes compatibility view', () => {
  const model = createLynwoodModel({ seed: 'compact-schema', maxYears: 50 });
  const descriptor = model.canes[0];
  const axesProperty = Object.getOwnPropertyDescriptor(descriptor, 'axes');

  assert.equal(model.schemaVersion, 2);
  assert.equal(axesProperty?.enumerable, false);
  assert.equal(typeof axesProperty?.get, 'function');
  assert.ok(Array.isArray(descriptor.axes));

  const json = JSON.stringify(model);
  assert.ok(!json.includes('"axes"'));
  assert.ok(!json.includes('"points"'));

  const compact = JSON.parse(json);
  assert.equal(compact.schemaVersion, 2);
  assert.equal(Object.hasOwn(compact.canes[0], 'axes'), false);
  assert.ok(
    evaluateLynwoodModel(compact, {
      ageYears: 6,
      dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
    }).stats.visibleFlowers > 0,
  );
});

test('shoot nodes finish inside the source growing year', () => {
  const model = createLynwoodModel({ seed: 'source-year', maxYears: 20 });
  const firstRenewal = model.canes.find((cane) => cane.cohort === 'renewal');
  const laterRenewal = model.canes.find(
    (cane) => cane.cohort === 'renewal' && cane.birthAgeYears >= 12,
  );
  const descriptors = [model.canes[0], firstRenewal, laterRenewal];
  let inspectedNodes = 0;

  for (const cane of descriptors) {
    assert.ok(cane, 'expected a representative cane cohort');
    for (const axis of cane.axes) {
      const sourceYear = Math.floor(axis.birthAgeYears);
      assert.equal(
        Math.floor(axis.birthAgeYears + axis.growthDurationYears),
        sourceYear,
        `${axis.id} crosses out of its source growing year`,
      );
      for (const node of axis.nodes) {
        inspectedNodes += 1;
        assert.ok(node.birthAgeYears >= axis.birthAgeYears);
        assert.ok(
          node.birthAgeYears <=
            axis.birthAgeYears + axis.growthDurationYears + Number.EPSILON,
        );
        assert.equal(
          Math.floor(node.birthAgeYears),
          sourceYear,
          `${node.id} forms outside ${sourceYear}`,
        );
      }
    }
  }
  assert.ok(inspectedNodes > 0);
});

test('leafy-season shoots stay out of bare bloom and spent short shoots clear', () => {
  assert.ok(
    LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[0] >
      LYNWOOD_CALENDAR.floweringPeak,
  );
  const model = createLynwoodModel({ seed: 19460412, maxYears: 10 });
  const peak = evaluateLynwoodModel(model, {
    ageYears: 6,
    dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
  });
  const shortShootYears = [];

  for (const cane of peak.canes) {
    for (const axis of cane.axes) {
      if (axis.order > 0) {
        assert.ok(
          axis.sourceNodes.every(
            (node) => Math.floor(node.birthAgeYears) < peak.ageYears,
          ),
          `${axis.id} appears during bloom in its own formation year`,
        );
      }
      if (axis.order === 2) {
        shortShootYears.push(Number(axis.id.match(/:short:y(\d+):/)?.[1]));
      }
    }
  }
  assert.ok(shortShootYears.length > 0);
  assert.ok(
    shortShootYears.every((year) => year === peak.ageYears - 1),
    'only last season short shoots should remain at the next full bloom',
  );

  const leafySeason = evaluateLynwoodModel(model, {
    ageYears: 6,
    dayOfYear: LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[1],
  });
  assert.ok(
    leafySeason.canes.some((cane) =>
      cane.axes.some(
        (axis) =>
          axis.order > 0 &&
          axis.sourceNodes.some(
            (node) => Math.floor(node.birthAgeYears) === leafySeason.ageYears,
          ),
      ),
    ),
    'current-season branch modules should emerge once the shrub is in leaf',
  );
});

test('the demo seed carries a dense full-bloom display without a flower multiplier', () => {
  const snapshot = evaluateLynwoodModel(
    createLynwoodModel({ seed: 19460412, maxYears: 10 }),
    {
      ageYears: 6,
      dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
    },
  );
  const showyOrgans =
    snapshot.stats.visibleFlowers + snapshot.stats.visibleFlowerBuds;
  assert.ok(showyOrgans >= 4000 && showyOrgans <= 5500, `${showyOrgans}`);
  assert.equal(snapshot.stats.visibleLeaves, 0);
});

test('each node has one bloom year with 1-6 flowers on supported wood ages', () => {
  const model = createLynwoodModel({ seed: 'cluster-contract', maxYears: 8 });
  const supportAges = new Set();
  let inspectedClusters = 0;

  for (const axis of model.canes[0].axes) {
    for (const node of axis.nodes) {
      assert.ok(
        new Set(node.clusters.map((cluster) => cluster.floweringYear)).size <=
          1,
        `${node.id} repeats a flower cluster across bloom years`,
      );
      for (const cluster of node.clusters) {
        inspectedClusters += 1;
        supportAges.add(cluster.woodAgeYears);
        assert.ok(
          cluster.flowers.length >= LYNWOOD_PROFILE.flower.perNodeRange[0] &&
            cluster.flowers.length <= LYNWOOD_PROFILE.flower.perNodeRange[1],
          `${cluster.id} has ${cluster.flowers.length} flowers`,
        );
      }
    }
  }

  assert.ok(inspectedClusters > 0);
  assert.deepEqual(
    [...supportAges].sort((a, b) => a - b),
    [1, 2],
  );
});

test('staggered clusters mix buds and flowers near peak without overlap per flower', () => {
  const model = createLynwoodModel({ seed: 'mixed-phase', maxYears: 10 });
  const snapshot = evaluateLynwoodModel(model, {
    ageYears: 6,
    dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
  });
  let buds = 0;
  let open = 0;

  for (const cane of snapshot.canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        for (const cluster of node.clusters) {
          for (const flower of cluster.flowers) {
            const isBud = flower.budVisibility > 0.015;
            const isOpen = flower.openVisibility > 0.015;
            assert.equal(
              isBud && isOpen,
              false,
              `${flower.id} is simultaneously a bud and an open corolla`,
            );
            if (isBud) buds += 1;
            if (isOpen) open += 1;
          }
        }
      }
    }
  }

  assert.ok(buds > 0, 'late clusters must still be in bud near peak');
  assert.ok(open > 0, 'early clusters must already be open near peak');
});

test('absolute cane cohorts continue through ages 20 and 40 without a reset', () => {
  const model = createLynwoodModel({ seed: 'no-cycle-reset', maxYears: 41 });
  const snapshots = new Map();
  for (const ageYears of [19, 20, 21, 39, 40, 41]) {
    const snapshot = evaluateLynwoodModel(model, {
      ageYears,
      dayOfYear: LYNWOOD_CALENDAR.floweringPeak,
    });
    assert.ok(snapshot.stats.visibleFlowers > 0, `age ${ageYears} lost bloom`);
    assert.ok(
      snapshot.dimensions.heightM > 0,
      `age ${ageYears} lost its crown`,
    );
    snapshots.set(ageYears, new Set(snapshot.canes.map((cane) => cane.id)));
  }

  const overlap = (left, right) =>
    [...snapshots.get(left)].filter((id) => snapshots.get(right).has(id))
      .length;
  for (const [left, right] of [
    [19, 20],
    [20, 21],
    [39, 40],
    [40, 41],
  ]) {
    const shared = overlap(left, right);
    assert.ok(shared > 0, `${left} -> ${right} replaced the whole shrub`);
    assert.ok(
      shared < snapshots.get(left).size,
      `${left} -> ${right} failed to renew any cane`,
    );
  }
  assert.equal(overlap(19, 39), 0, 'age 39 reused age-19 cane identities');
  assert.equal(overlap(20, 40), 0, 'age 40 reused age-20 cane identities');
});

test('automatic renewal waits until the complete staggered display has ended', () => {
  const model = createLynwoodModel({
    seed: 'automatic-boundary',
    maxYears: 10,
  });
  const removalYear = Math.min(
    ...model.canes.map((cane) => cane.scheduledRemovalYear),
  );
  const victims = model.canes
    .filter((cane) => cane.scheduledRemovalYear === removalYear)
    .map((cane) => cane.id);
  const lastFlowerDay = LYNWOOD_CALENDAR.floweringEnd;
  const cutDay =
    lastFlowerDay + LYNWOOD_PROFILE.management.automaticRenewalDelayDays;
  const stillFlowering = evaluateLynwoodModel(model, {
    ageYears: removalYear,
    dayOfYear: lastFlowerDay - 1,
  });
  const beforeCut = evaluateLynwoodModel(model, {
    ageYears: removalYear,
    dayOfYear: lastFlowerDay,
  });
  const afterCut = evaluateLynwoodModel(model, {
    ageYears: removalYear,
    dayOfYear: cutDay,
  });
  const beforeIds = new Set(beforeCut.canes.map((cane) => cane.id));
  const afterIds = new Set(afterCut.canes.map((cane) => cane.id));

  assert.ok(stillFlowering.stats.visibleFlowers > 0);
  assert.equal(beforeCut.stats.visibleFlowers, 0);
  assert.ok(victims.length > 0);
  for (const id of victims) {
    assert.ok(beforeIds.has(id), `${id} was removed before flowering ended`);
    assert.ok(!afterIds.has(id), `${id} survived its post-flowering cut`);
  }
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
