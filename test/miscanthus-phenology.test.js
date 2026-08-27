import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMalepartusCalendar,
  getMalepartusCareHints,
  getMalepartusPhenology,
  MALEPARTUS_CALENDAR,
  MALEPARTUS_CALENDAR_PROVENANCE,
  MALEPARTUS_PHASE_ASSUMPTIONS,
  MALEPARTUS_SEASON_PROFILES,
} from '../src/lib/plants/miscanthus/phenology.js';
import {
  MALEPARTUS_PROFILE,
  MALEPARTUS_SOURCES,
} from '../src/lib/plants/miscanthus/malepartus.js';

const CALENDAR = MALEPARTUS_CALENDAR;

test('the calendar is anchored to the cited August-to-November display', () => {
  // Digging Dog and the RHS both put 'Malepartus' in flower from mid-August,
  // early for the genus. That anchor is what the whole calendar hangs on.
  assert.ok(CALENDAR.panicleEmergenceStart >= 212);
  assert.ok(CALENDAR.panicleEmergenceStart <= 232);
  assert.ok(CALENDAR.silverFull >= 273, 'silvering runs into late October');
  assert.ok(CALENDAR.silverFull <= 320);
  // The cut is the one cited management date: early spring, about 10 cm.
  assert.deepEqual(
    [CALENDAR.cutbackStart, CALENDAR.cutbackEnd],
    [...MALEPARTUS_PROFILE.management.cutbackDayRange],
  );
});

test('a C4 grass emerges long after the shrubs around it', () => {
  // Nothing green before late April is the single most distinctive thing
  // about this plant in a spring border.
  assert.ok(CALENDAR.emergenceStart >= 105, 'no growth before mid-April');
  assert.ok(CALENDAR.emergenceStart > CALENDAR.cutbackEnd);
  assert.equal(
    getMalepartusPhenology(CALENDAR.emergenceStart - 1).emergenceProgress,
    0,
  );
  assert.ok(
    getMalepartusPhenology(CALENDAR.emergenceStart + 30).emergenceProgress > 0,
  );
});

test('every phase in the year is reachable and BBCH-labelled on the cereal scale', () => {
  const phases = new Map();
  for (let day = 1; day <= 365; day += 1) {
    const phenology = getMalepartusPhenology(day);
    assert.equal(phenology.bbchScale, 'cereal');
    assert.match(phenology.bbch, /^\d{2}$/);
    phases.set(phenology.phase, phenology.bbch);
  }
  for (const phase of [
    'standing-dry',
    'dormant',
    'emergence',
    'tillering',
    'culm-elongation',
    'booting',
    'heading',
    'flowering',
    'silvering',
    'senescence',
  ]) {
    assert.ok(phases.has(phase), `unreachable phase: ${phase}`);
  }
  // The cut phase only exists for a clump that is actually being cut.
  const cut = getMalepartusPhenology(CALENDAR.cutbackEnd + 3, {});
  assert.equal(cut.phase, 'cut-back');
});

test('weathering stays continuous when the slider wraps past New Year', () => {
  // This season's culms become last season's on 1 January. If the two
  // measures did not meet, the whole clump would visibly jump.
  const december = getMalepartusPhenology(365);
  const january = getMalepartusPhenology(1);
  assert.ok(
    Math.abs(december.weatheringProgress - january.previousWeatheringProgress) <
      0.02,
    `${december.weatheringProgress} vs ${january.previousWeatheringProgress}`,
  );
  assert.equal(
    getMalepartusPhenology(CALENDAR.strawStart).weatheringProgress,
    0,
  );
  // By the March cut, last season's culms have stood through a whole winter.
  assert.ok(
    getMalepartusPhenology(CALENDAR.cutbackStart).previousWeatheringProgress >
      0.7,
  );
});

test('every progress value stays inside 0..1 all year, in both scenarios', () => {
  const ratios = [
    'cutProgress',
    'stubbleVisibility',
    'standingDryVisibility',
    'emergenceProgress',
    'culmExtensionProgress',
    'bladeProgress',
    'autumnProgress',
    'strawProgress',
    'weatheringProgress',
    'previousWeatheringProgress',
    'paniclePush',
    'panicleVisibility',
    'fanOpenProgress',
    'plumeFluffProgress',
    'plumeVisibility',
    'silverProgress',
  ];
  for (const scenario of ['maintained', 'neglected']) {
    for (const seasonProfile of Object.keys(MALEPARTUS_SEASON_PROFILES)) {
      for (let day = 1; day <= 365; day += 1) {
        const phenology = getMalepartusPhenology(day, {
          scenario,
          seasonProfile,
        });
        for (const key of ratios) {
          const value = phenology[key];
          assert.ok(
            Number.isFinite(value) && value >= 0 && value <= 1,
            `${key} = ${value} on day ${day} (${scenario}/${seasonProfile})`,
          );
        }
      }
    }
  }
});

test('season profiles shift the whole calendar together', () => {
  const early = getMalepartusCalendar({ seasonProfile: 'early' });
  const late = getMalepartusCalendar({ seasonProfile: 'late' });
  for (const key of Object.keys(MALEPARTUS_PHASE_ASSUMPTIONS.baseline)) {
    assert.equal(late[key] - early[key], 20, `${key} did not shift together`);
  }
  assert.throws(
    () => getMalepartusCalendar({ seasonProfile: 'monsoon' }),
    /seasonProfile must be/,
  );
  assert.throws(
    () => getMalepartusCalendar({ offsetDays: 90 }),
    /offsetDays must be/,
  );
});

test('care hints are cited, and only appear when they are actionable', () => {
  const known = new Set(
    Object.values(MALEPARTUS_SOURCES)
      .map((source) => source.url)
      .filter(Boolean),
  );
  const seen = new Set();
  for (let day = 1; day <= 365; day += 1) {
    for (const plantAgeYears of [0, 2, 12]) {
      for (const hint of getMalepartusCareHints(day, { plantAgeYears })) {
        assert.ok(
          known.has(hint.source),
          `uncited hint source: ${hint.source}`,
        );
        assert.ok(hint.title.length > 0 && hint.message.length > 0);
        seen.add(hint.id);
      }
    }
  }
  assert.ok(seen.has('spring-cutback'));
  assert.ok(seen.has('leave-standing-for-winter'));
  assert.ok(seen.has('divide-open-centre'));
  assert.ok(seen.has('first-season-vegetative'));

  // The cut is only advised inside its own window.
  const ids = (day, options = {}) =>
    getMalepartusCareHints(day, { plantAgeYears: 6, ...options }).map(
      (hint) => hint.id,
    );
  assert.ok(ids(CALENDAR.cutbackStart + 5).includes('spring-cutback'));
  assert.ok(!ids(250).includes('spring-cutback'));
  // Division is only raised once a clump is old enough to have opened out.
  assert.ok(!ids(CALENDAR.cutbackStart + 5).includes('divide-open-centre'));
  assert.ok(
    ids(CALENDAR.cutbackStart + 5, { plantAgeYears: 14 }).includes(
      'divide-open-centre',
    ),
  );
  assert.throws(
    () => getMalepartusCareHints(200, { plantAgeYears: -1 }),
    /plantAgeYears/,
  );
});

test('provenance separates what is observed from what is assumed', () => {
  assert.ok(MALEPARTUS_CALENDAR_PROVENANCE.sources.length >= 3);
  for (const url of MALEPARTUS_CALENDAR_PROVENANCE.sources) {
    assert.match(url, /^https:\/\//);
  }
  assert.match(MALEPARTUS_PHASE_ASSUMPTIONS.note, /renderer assumptions/i);
  assert.equal(MALEPARTUS_SEASON_PROFILES.typical.observedAnchor, true);
  assert.equal(MALEPARTUS_SEASON_PROFILES.early.observedAnchor, false);
  for (const source of Object.values(MALEPARTUS_SOURCES)) {
    // Entries without a url are first-hand observations rather than citable
    // documents (library rule 4: the repo records what looking taught us, not
    // links to particular images). Either way the entry must state its claim.
    if (source.url !== undefined) assert.match(source.url, /^https:\/\//);
    assert.ok(source.supports.length > 40, `${source.title} needs a claim`);
  }
});
