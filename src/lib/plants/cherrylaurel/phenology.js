import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { ROTUNDIFOLIA_PROFILE, ROTUNDIFOLIA_SOURCES } from './rotundifolia.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

function pulse(value, start, peak, end) {
  if (value < start || value > end) return 0;
  return value <= peak
    ? progress(value, start, peak)
    : 1 - progress(value, peak, end);
}

/** Weather-timing brackets around the central-Poland calendar. */
export const ROTUNDIFOLIA_SEASON_PROFILES = Object.freeze({
  typical: Object.freeze({
    label: 'Typical central-Poland season',
    dayOffset: 0,
    observedAnchor: true,
  }),
  early: Object.freeze({
    label: 'Early warm season',
    dayOffset: -10,
    observedAnchor: false,
  }),
  late: Object.freeze({
    label: 'Late cool season',
    dayOffset: 10,
    observedAnchor: false,
  }),
});

/**
 * RHS anchors the cultivar display to mid and late spring; the Sofiyivka
 * field study gives a regional species-level April-May bloom and late-August
 * black-fruit anchor. Intervening transition dates and the +/-10-day weather
 * brackets remain explicit animation assumptions.
 */
export const ROTUNDIFOLIA_PHASE_ASSUMPTIONS = Object.freeze({
  baseline: Object.freeze({
    shootGrowthStart: monthDayToDay(3, 28),
    leafFlushStart: monthDayToDay(4, 2),
    flowerBudStart: monthDayToDay(4, 5),
    floweringStart: monthDayToDay(4, 11),
    floweringPeak: monthDayToDay(4, 29),
    floweringEnd: monthDayToDay(5, 20),
    fruitSetStart: monthDayToDay(5, 21),
    shootGrowthEnd: monthDayToDay(6, 20),
    fruitFullSize: monthDayToDay(6, 28),
    leafHardeningEnd: monthDayToDay(7, 5),
    redFruitStart: monthDayToDay(7, 12),
    blackFruitStart: monthDayToDay(8, 5),
    blackFruitFull: monthDayToDay(8, 25),
    fruitDropStart: monthDayToDay(9, 18),
    fruitDropEnd: monthDayToDay(10, 22),
  }),
  note: 'The evergreen habit, mid-to-late-spring white spikes, first flowering near age four and black fruit by late August are source observations. Exact central-Poland bud, flush, set, colour-transition and drop dates and the +/-10-day profiles are renderer assumptions.',
});

function createCalendar(seasonProfile = 'typical', offsetDays = 0) {
  if (!Object.hasOwn(ROTUNDIFOLIA_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 30) {
    throw new RangeError('offsetDays must be a finite number from -30 to 30');
  }

  const profile = ROTUNDIFOLIA_SEASON_PROFILES[seasonProfile];
  const totalOffset = profile.dayOffset + Math.round(offsetDays);
  const shift = (day) => Math.max(1, Math.min(365, day + totalOffset));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(ROTUNDIFOLIA_PHASE_ASSUMPTIONS.baseline).map(
        ([key, day]) => [key, shift(day)],
      ),
    ),
  );
}

export function getRotundifoliaCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  return createCalendar(seasonProfile, offsetDays);
}

export const ROTUNDIFOLIA_CALENDAR = createCalendar();

export const ROTUNDIFOLIA_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'RHS mid-to-late-spring fragrant white spikes plus Sofiyivka regional observations of first flowering near age four and black fruit in late August',
  seasonProfiles: ROTUNDIFOLIA_SEASON_PROFILES,
  assumptions: ROTUNDIFOLIA_PHASE_ASSUMPTIONS,
  sources: Object.freeze([
    ROTUNDIFOLIA_SOURCES.rhsCultivar.url,
    ROTUNDIFOLIA_SOURCES.rhsScreening.url,
    ROTUNDIFOLIA_SOURCES.sofiyivkaStudy.url,
  ]),
});

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

function stageFor(
  day,
  calendar,
  {
    flowerBudVisibility,
    flowerVisibility,
    fruitVisibility,
    redProgress,
    blackProgress,
  },
) {
  // Derive public labels from the same continuous values that decide which
  // organ the renderer draws. This keeps exact transition days honest: the
  // first/last point of a pulse has zero visibility and must not claim an
  // organ that is absent from the scene.
  if (flowerVisibility > 0.015) {
    return ['flowering', 'Fragrant cream-white racemes in flower', '65'];
  }
  if (fruitVisibility > 0.015) {
    if (blackProgress > 0.65) {
      return [
        'ripe-fruit',
        'Glossy black drupes above evergreen foliage',
        '87',
      ];
    }
    if (redProgress > 0) {
      return [
        'fruit-ripening',
        'Cherry-like drupes ripening from red towards black',
        '81',
      ];
    }
    return ['fruit-set', 'Green drupes swelling on upright racemes', '71'];
  }
  if (flowerBudVisibility > 0.015) {
    return ['flower-bud', 'Upright flower spikes in green bud', '55'];
  }
  if (day >= calendar.shootGrowthStart && day <= calendar.leafHardeningEnd) {
    return ['spring-flush', 'Spring shoots and vivid lime leaf flush', '10'];
  }
  return [
    'evergreen-rest',
    day < calendar.shootGrowthStart
      ? 'Evergreen winter canopy at rest'
      : 'Mature evergreen canopy at rest',
    '00',
  ];
}

/** Continuous evergreen, flower and fruit state for one calendar day. */
export function getRotundifoliaPhenology(
  value = 130,
  { seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  const shootGrowthProgress = progress(
    day,
    calendar.shootGrowthStart,
    calendar.shootGrowthEnd,
  );
  const leafFlushProgress = progress(
    day,
    calendar.leafFlushStart,
    calendar.leafHardeningEnd,
  );
  const leafFlushVisibility = pulse(
    day,
    calendar.leafFlushStart,
    calendar.floweringPeak,
    calendar.leafHardeningEnd,
  );
  const flowerBudVisibility = pulse(
    day,
    calendar.flowerBudStart,
    calendar.floweringStart,
    calendar.floweringPeak,
  );
  const flowerVisibility = pulse(
    day,
    calendar.floweringStart,
    calendar.floweringPeak,
    calendar.floweringEnd,
  );
  const fruitGrowthProgress = progress(
    day,
    calendar.fruitSetStart,
    calendar.fruitFullSize,
  );
  const fruitDropProgress = progress(
    day,
    calendar.fruitDropStart,
    calendar.fruitDropEnd,
  );
  const fruitVisibility =
    day < calendar.fruitSetStart || day > calendar.fruitDropEnd
      ? 0
      : clamp01(fruitGrowthProgress * (1 - fruitDropProgress));
  const redProgress = progress(
    day,
    calendar.redFruitStart,
    calendar.blackFruitStart,
  );
  const blackProgress = progress(
    day,
    calendar.blackFruitStart,
    calendar.blackFruitFull,
  );

  const stageInputs = {
    flowerBudVisibility,
    flowerVisibility,
    fruitVisibility,
    redProgress,
    blackProgress,
  };
  const [phase, label, bbch] = stageFor(day, calendar, stageInputs);

  let featureStage = 'absent';
  if (flowerVisibility > 0.015) featureStage = 'flower';
  else if (fruitVisibility > 0.015) featureStage = 'fruit';
  else if (flowerBudVisibility > 0.015) featureStage = 'bud';

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    seasonProfile,
    seasonProfileLabel: ROTUNDIFOLIA_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
    calendar,
    evergreen: true,
    evergreenLeafRetention: 1,
    shootGrowthProgress,
    leafFlushProgress,
    leafFlushVisibility,
    flowerBudProgress: progress(
      day,
      calendar.flowerBudStart,
      calendar.floweringStart,
    ),
    flowerBudVisibility,
    flowerProgress: progress(
      day,
      calendar.floweringStart,
      calendar.floweringEnd,
    ),
    flowerVisibility,
    flowerOpenVisibility: flowerVisibility,
    fruitSetProgress: progress(
      day,
      calendar.fruitSetStart,
      calendar.fruitFullSize,
    ),
    fruitGrowthProgress,
    fruitVisibility,
    fruitColourProgress: clamp01((redProgress + blackProgress) / 2),
    redProgress,
    blackProgress,
    ripeFruitVisibility: fruitVisibility * blackProgress,
    fruitDropProgress,
    featureStage,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Care guidance relevant to the selected age and day. */
export function getRotundifoliaCareHints(
  value = 130,
  { plantAgeYears = 0, seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }

  const hints = [];
  const phenology = getRotundifoliaPhenology(day, {
    seasonProfile,
    offsetDays,
  });
  if (phenology.flowerVisibility > 0.015) {
    hints.push(
      hint(
        'observe-spring-racemes',
        'phenology',
        'notice',
        'Compare the upright spring flower spikes',
        `The modelled cream-white display runs from ${calendarLabel(calendar.floweringStart)} to ${calendarLabel(calendar.floweringEnd)}. Site and weather can move it, so compare spike density and the lime terminal flush with the real shrub.`,
        ROTUNDIFOLIA_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (
    plantAgeYears >=
      ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears &&
    day > calendar.floweringEnd &&
    day <= calendar.shootGrowthEnd + 20
  ) {
    hints.push(
      hint(
        'shape-after-flowering',
        'pruning',
        'recommended',
        'Shape after flowering',
        'If shaping is needed, selectively shorten misplaced shoots in late spring or early summer. This model keeps a dense free-standing outline rather than a repeatedly sheared hedge.',
        ROTUNDIFOLIA_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (day >= calendar.redFruitStart && day <= calendar.fruitDropEnd) {
    hints.push(
      hint(
        'fruit-kernel-warning',
        'safety',
        'important',
        'Treat the drupes as ornamental',
        'The fruits mature from red to glossy black, but their seed kernels are harmful if eaten. Keep fallen fruit away from children and pets.',
        ROTUNDIFOLIA_SOURCES.rhsCultivar.url,
      ),
    );
  }

  return Object.freeze(hints);
}
