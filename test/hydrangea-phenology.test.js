import assert from 'node:assert/strict';
import test from 'node:test';

import { dayOfYear as sharedDayOfYear } from '../src/lib/plants/blackcurrant/phenology.js';
import {
  LIMELIGHT_CALENDAR,
  LIMELIGHT_CALENDAR_PROVENANCE,
  LIMELIGHT_PHASE_ASSUMPTIONS,
  LIMELIGHT_SEASON_PROFILES,
  dayOfYear,
  getLimelightCalendar,
  getLimelightCareHints,
  getLimelightPhenology,
} from '../src/lib/plants/hydrangea/phenology.js';
import {
  LIMELIGHT_PROFILE,
  LIMELIGHT_SOURCES,
  METRES_PER_UNIT,
} from '../src/lib/plants/hydrangea/limelight.js';

test('Limelight profile is an immutable, source-backed multi-stem shrub', () => {
  assert.equal(METRES_PER_UNIT, 1);
  assert.equal(LIMELIGHT_PROFILE.species, 'Hydrangea paniculata');
  assert.equal(LIMELIGHT_PROFILE.cultivar, 'Limelight');
  assert.equal(LIMELIGHT_PROFILE.architecture.hasTrunk, false);
  assert.match(LIMELIGHT_PROFILE.architecture.habit, /upright-spreading/i);
  assert.ok(Object.isFrozen(LIMELIGHT_PROFILE));
  assert.ok(Object.isFrozen(LIMELIGHT_PROFILE.architecture));

  assert.match(LIMELIGHT_SOURCES.rhsCultivar.url, /rhs\.org\.uk/);
  assert.match(LIMELIGHT_SOURCES.cultivarPatent.url, /patents\.google\.com/);
  assert.match(LIMELIGHT_SOURCES.polishRetailer.url, /zielonyexpert\.pl/);
  assert.match(LIMELIGHT_SOURCES.rhsTrial2008.supports, /mid-July/i);
});

test('mature dimensions stay inside published envelopes and retain measured anchors', () => {
  const architecture = LIMELIGHT_PROFILE.architecture;
  const [minimumHeight, maximumHeight] = architecture.rhsUltimateHeightRangeM;
  const [minimumSpread, maximumSpread] = architecture.rhsUltimateSpreadRangeM;
  const modeledSpread = architecture.matureRadiusM * 2;

  assert.ok(architecture.matureHeightM >= minimumHeight);
  assert.ok(architecture.matureHeightM <= maximumHeight);
  assert.ok(modeledSpread >= minimumSpread);
  assert.ok(modeledSpread <= maximumSpread);
  assert.equal(architecture.observedRhsTrialHeightM, 1.65);
  assert.equal(architecture.observedRhsTrialSpreadM, 2.25);
  assert.notEqual(
    architecture.matureHeightM,
    architecture.observedRhsTrialHeightM,
    'the renderer target must remain distinct from the measured RHS trial height',
  );
  assert.deepEqual(architecture.yearsToMaturity, [5, 10]);
  assert.match(LIMELIGHT_SOURCES.chicagoTrial.supports, /1\.78 m high/i);
});

test('opposite leaves retain the patented dimensions and ovate aspect', () => {
  const leaf = LIMELIGHT_PROFILE.leaf;
  assert.match(leaf.arrangement, /^opposite/i);
  assert.equal(leaf.leavesPerNode, 2);
  assert.equal(leaf.decussateTurnRadians, Math.PI / 2);
  assert.deepEqual(leaf.lengthM, [0.085, 0.1]);
  assert.deepEqual(leaf.widthM, [0.04, 0.055]);
  assert.ok(leaf.lengthM[0] > leaf.widthM[1]);
  assert.match(leaf.shape, /ovate/i);
  assert.equal(leaf.margin, 'serrulate');
});

test('dense terminal panicles flower on current-season shoots', () => {
  assert.equal(LIMELIGHT_PROFILE.flowering.wood, 'current-season growth');
  assert.equal(LIMELIGHT_PROFILE.flowering.terminal, true);
  assert.match(LIMELIGHT_PROFILE.panicle.position, /terminal/i);
  assert.deepEqual(LIMELIGHT_PROFILE.panicle.lengthM, [0.15, 0.25]);
  assert.deepEqual(LIMELIGHT_PROFILE.panicle.widthM, [0.12, 0.18]);
  assert.deepEqual(LIMELIGHT_PROFILE.panicle.showySterileFraction, [0.8, 1]);
  assert.equal(LIMELIGHT_PROFILE.panicle.calyxPersistent, true);
  assert.equal(LIMELIGHT_PROFILE.management.recommendedPruning, 'medium');
  assert.equal(LIMELIGHT_PROFILE.management.avoidHardPruning, true);
});

test('the calendar orders growth, flowering, colour change and dormancy', () => {
  const calendar = LIMELIGHT_CALENDAR;
  const orderedMilestones = [
    calendar.dormantEnd,
    calendar.budSwellingStart,
    calendar.leafEmergenceStart,
    calendar.shootEmergenceStart,
    calendar.leafFullExpansion,
    calendar.panicleInitiationStart,
    calendar.visiblePanicleBudStart,
    calendar.floweringStart,
    calendar.limePeak,
    calendar.creamWhiteStart,
    calendar.floweringPeak,
    calendar.pinkStart,
    calendar.burgundyStart,
    calendar.autumnStart,
    calendar.freshDisplayEnd,
    calendar.dryPanicleStart,
    calendar.dryPanicleFull,
    calendar.leafFallEnd,
  ];

  for (let index = 1; index < orderedMilestones.length; index += 1) {
    assert.ok(
      orderedMilestones[index] > orderedMilestones[index - 1],
      `milestone ${index} must follow milestone ${index - 1}`,
    );
  }
});

test('early and late profiles shift the complete calendar around typical', () => {
  const typical = getLimelightCalendar({ seasonProfile: 'typical' });
  const early = getLimelightCalendar({ seasonProfile: 'early' });
  const late = getLimelightCalendar({ seasonProfile: 'late' });

  for (const milestone of [
    'leafEmergenceStart',
    'floweringStart',
    'pinkStart',
    'leafFallEnd',
  ]) {
    assert.equal(early[milestone], typical[milestone] - 10);
    assert.equal(late[milestone], typical[milestone] + 10);
  }

  assert.equal(LIMELIGHT_SEASON_PROFILES.typical.observedAnchor, true);
  assert.equal(LIMELIGHT_SEASON_PROFILES.early.observedAnchor, false);
  assert.equal(LIMELIGHT_SEASON_PROFILES.late.observedAnchor, false);
  assert.equal(
    getLimelightCalendar({ offsetDays: 4 }).floweringStart,
    typical.floweringStart + 4,
  );
});

test('winter is leafless while persistent previous-season heads remain dry', () => {
  const winter = getLimelightPhenology(20);
  assert.equal(winter.phase, 'dormant');
  assert.equal(winter.bbch, '00');
  assert.equal(winter.leafOpacity, 0);
  assert.equal(winter.currentPanicleVisibility, 0);
  assert.equal(winter.oldPanicleVisibility, 1);
  assert.equal(winter.dryPanicleVisibility, 1);
  assert.equal(winter.panicleColourStage, 'dry-tan');
  assert.equal(winter.flowerOpenVisibility, 0);

  const afterPruning = getLimelightPhenology(
    LIMELIGHT_CALENDAR.previousPaniclePruneEnd + 1,
  );
  assert.equal(afterPruning.oldPanicleVisibility, 0);
});

test('panicle colour follows lime, cream, pink, burgundy and dry-tan stages', () => {
  const calendar = LIMELIGHT_CALENDAR;
  const lime = getLimelightPhenology(calendar.floweringStart);
  const cream = getLimelightPhenology(calendar.creamWhiteStart);
  const pink = getLimelightPhenology(calendar.pinkStart);
  const burgundy = getLimelightPhenology(calendar.burgundyStart);
  const tan = getLimelightPhenology(calendar.dryPanicleFull);

  assert.equal(lime.panicleColourStage, 'pale-lime');
  assert.equal(cream.panicleColourStage, 'cream-white');
  assert.equal(pink.panicleColourStage, 'blush-pink');
  assert.equal(burgundy.panicleColourStage, 'burgundy-pink');
  assert.equal(tan.panicleColourStage, 'dry-tan');
  assert.ok(lime.flowerOpenVisibility > 0);
  assert.equal(cream.limeToCreamProgress, 1);
  assert.equal(burgundy.pinkProgress, 1);
  assert.equal(tan.dryProgress, 1);
});

test('persistent sepals hand off continuously from fresh display to dry heads', () => {
  for (const seasonProfile of ['typical', 'early', 'late']) {
    const calendar = getLimelightCalendar({ seasonProfile });
    let previousFresh = Infinity;
    let previousDry = -Infinity;

    for (
      let day = calendar.freshDisplayEnd;
      day <= calendar.dryPanicleFull;
      day += 1
    ) {
      const state = getLimelightPhenology(day, { seasonProfile });
      assert.ok(
        state.sterileFloretVisibility > 0.015,
        `${seasonProfile} lost sterile sepals on day ${day}`,
      );
      assert.ok(
        state.fertileFloretVisibility > 0.015,
        `${seasonProfile} lost the fertile interior on day ${day}`,
      );
      assert.ok(
        state.flowerOpenVisibility <= previousFresh,
        `${seasonProfile} fresh visibility rose on day ${day}`,
      );
      assert.ok(
        state.dryProgress >= previousDry,
        `${seasonProfile} dry progress fell on day ${day}`,
      );
      previousFresh = state.flowerOpenVisibility;
      previousDry = state.dryProgress;
    }

    const handoff = getLimelightPhenology(calendar.dryPanicleStart, {
      seasonProfile,
    });
    const firstDryStep = getLimelightPhenology(calendar.dryPanicleStart + 1, {
      seasonProfile,
    });
    const dry = getLimelightPhenology(calendar.dryPanicleFull, {
      seasonProfile,
    });
    assert.ok(handoff.flowerOpenVisibility > 0);
    assert.equal(handoff.dryProgress, 0);
    assert.ok(firstDryStep.flowerOpenVisibility > 0);
    assert.ok(firstDryStep.dryProgress > 0);
    assert.equal(dry.flowerOpenVisibility, 0);
    assert.equal(dry.dryProgress, 1);
  }
});

test('provenance labels observed anchors separately from renderer assumptions', () => {
  assert.match(
    LIMELIGHT_CALENDAR_PROVENANCE.observationProfile,
    /mid-July to early-October/i,
  );
  assert.strictEqual(
    LIMELIGHT_CALENDAR_PROVENANCE.assumptions,
    LIMELIGHT_PHASE_ASSUMPTIONS,
  );
  assert.match(LIMELIGHT_PHASE_ASSUMPTIONS.note, /source observations/i);
  assert.match(LIMELIGHT_PHASE_ASSUMPTIONS.note, /renderer assumptions/i);
  assert.ok(
    LIMELIGHT_CALENDAR_PROVENANCE.sources.every((url) =>
      url.startsWith('https://'),
    ),
  );
});

test('care hints point back to declared evidence URLs', () => {
  const declaredUrls = new Set(
    Object.values(LIMELIGHT_SOURCES).map((source) => source.url),
  );
  const spring = getLimelightCareHints(60, { plantAgeYears: 5 });
  const currentShootGrowth = getLimelightCareHints(110, {
    plantAgeYears: 5,
  });
  const bloom = getLimelightCareHints(LIMELIGHT_CALENDAR.floweringPeak, {
    plantAgeYears: 5,
  });
  const winter = getLimelightCareHints(20, { plantAgeYears: 5 });
  const hints = [...spring, ...currentShootGrowth, ...bloom, ...winter];

  assert.ok(spring.some((hint) => hint.id === 'medium-spring-prune'));
  const protectShoots = currentShootGrowth.find(
    (hint) => hint.id === 'protect-current-shoots',
  );
  assert.equal(protectShoots?.source, LIMELIGHT_SOURCES.polishRetailer.url);
  assert.match(LIMELIGHT_SOURCES.polishRetailer.supports, /current-season/i);
  assert.ok(bloom.some((hint) => hint.id === 'observe-colour-sequence'));
  assert.ok(winter.some((hint) => hint.id === 'retain-dry-heads'));
  assert.ok(hints.every((hint) => declaredUrls.has(hint.source)));
  assert.ok(hints.every((hint) => hint.source.startsWith('https://')));
});

test('phenology validates inputs and reuses the shared 365-day parser', () => {
  assert.strictEqual(dayOfYear, sharedDayOfYear);
  assert.equal(dayOfYear('07-15'), LIMELIGHT_CALENDAR.floweringStart);
  assert.equal(dayOfYear('2024-02-29'), dayOfYear('03-01'));
  assert.throws(() => dayOfYear(0), RangeError);
  assert.throws(() => dayOfYear('02-31'), TypeError);
  assert.throws(
    () => getLimelightPhenology(200, { seasonProfile: 'unknown' }),
    /seasonProfile/,
  );
  assert.throws(
    () => getLimelightPhenology(200, { offsetDays: 31 }),
    /offsetDays/,
  );
  assert.throws(
    () => getLimelightCareHints(200, { plantAgeYears: -1 }),
    /plantAgeYears/,
  );
  assert.throws(
    () => getLimelightCareHints(200, { plantAgeYears: Infinity }),
    /plantAgeYears/,
  );
});
