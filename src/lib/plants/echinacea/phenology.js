import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { MAGNUS_PROFILE, MAGNUS_SOURCES } from './magnus.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

/** Weather-timing brackets around the central-Poland baseline. */
export const MAGNUS_SEASON_PROFILES = Object.freeze({
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
 * Continuous renderer calendar around the observed July-September display.
 * Fine transition dates are declared assumptions, not station observations.
 */
export const MAGNUS_PHASE_ASSUMPTIONS = Object.freeze({
  baseline: Object.freeze({
    cutbackStart: monthDayToDay(2, 20),
    cutbackEnd: monthDayToDay(3, 15),
    emergenceStart: monthDayToDay(3, 25),
    leafExpansionStart: monthDayToDay(4, 5),
    stemElongationStart: monthDayToDay(4, 25),
    foliageFullExpansion: monthDayToDay(6, 10),
    budStart: monthDayToDay(6, 12),
    stemFullHeight: monthDayToDay(6, 28),
    floweringStart: monthDayToDay(7, 1),
    floweringPeak: monthDayToDay(7, 20),
    rayFadeStart: monthDayToDay(8, 20),
    seedHeadStart: monthDayToDay(8, 28),
    floweringEnd: monthDayToDay(9, 25),
    autumnStart: monthDayToDay(9, 20),
    leafFallStart: monthDayToDay(10, 15),
    leafFallEnd: monthDayToDay(11, 15),
    dryFull: monthDayToDay(11, 25),
  }),
  note: 'July-September flowering, deciduous top growth and optional winter seed-head retention are observations. Emergence, elongation, individual transition dates and +/-10-day season brackets are renderer assumptions for central Poland.',
});

function createCalendar(seasonProfile = 'typical', offsetDays = 0) {
  if (!Object.hasOwn(MAGNUS_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 30) {
    throw new RangeError('offsetDays must be a finite number from -30 to 30');
  }

  const profile = MAGNUS_SEASON_PROFILES[seasonProfile];
  const totalOffset = profile.dayOffset + Math.round(offsetDays);
  const shift = (day) => Math.max(1, Math.min(365, day + totalOffset));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(MAGNUS_PHASE_ASSUMPTIONS.baseline).map(([key, day]) => [
        key,
        shift(day),
      ]),
    ),
  );
}

export function getMagnusCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  return createCalendar(seasonProfile, offsetDays);
}

export const MAGNUS_CALENDAR = createCalendar();

export const MAGNUS_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'July-September Polish display, herbaceous winter dieback and optional retained seed heads',
  seasonProfiles: MAGNUS_SEASON_PROFILES,
  assumptions: MAGNUS_PHASE_ASSUMPTIONS,
  sources: Object.freeze([
    MAGNUS_SOURCES.rhsCultivar.url,
    MAGNUS_SOURCES.polishNurseryAssociation.url,
    MAGNUS_SOURCES.jelittoCultivar.url,
  ]),
});

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

function stageFor(day, calendar) {
  if (day < calendar.cutbackStart) {
    return ['standing-dry', 'Dry stems and prickly seed heads standing', '97'];
  }
  if (day < calendar.cutbackEnd) {
    return ['cut-back', 'Last year’s stems being cut to the crown', '00'];
  }
  if (day < calendar.emergenceStart) {
    return ['dormant', 'Dormant basal crown', '00'];
  }
  if (day < calendar.stemElongationStart) {
    return ['emergence', 'Rough basal leaves expanding from the crown', '09'];
  }
  if (day < calendar.budStart) {
    return ['stem-elongation', 'Leafy flowering stems extending', '31'];
  }
  if (day < calendar.floweringStart) {
    return [
      'flower-bud',
      'Green terminal buds swelling above the foliage',
      '55',
    ];
  }
  if (day < calendar.floweringPeak) {
    return ['early-flowering', 'First broad rose-purple heads opening', '61'];
  }
  if (day < calendar.rayFadeStart) {
    return [
      'peak-flowering',
      'Peak display of horizontal rose-purple rays',
      '65',
    ];
  }
  if (day < calendar.floweringEnd) {
    return [
      'late-flowering',
      'Open, fading and seed-setting heads mixed',
      '69',
    ];
  }
  if (day < calendar.leafFallStart) {
    return ['seed-ripening', 'Darkening seed heads above autumn foliage', '89'];
  }
  if (day < calendar.dryFull) {
    return ['senescence', 'Top growth drying from ochre to brown', '93'];
  }
  return ['standing-dry', 'Dry stems and prickly seed heads standing', '97'];
}

/** Continuous state for one leap-neutral calendar day. */
export function getMagnusPhenology(
  value = 205,
  { seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  const [phase, label, bbch] = stageFor(day, calendar);

  const cutProgress = progress(day, calendar.cutbackStart, calendar.cutbackEnd);
  const emergenceProgress = progress(
    day,
    calendar.emergenceStart,
    calendar.foliageFullExpansion,
  );
  const leafProgress = progress(
    day,
    calendar.leafExpansionStart,
    calendar.foliageFullExpansion,
  );
  const stemGrowthProgress = progress(
    day,
    calendar.stemElongationStart,
    calendar.stemFullHeight,
  );
  const budProgress = progress(day, calendar.budStart, calendar.floweringStart);
  const flowerProgress = progress(
    day,
    calendar.floweringStart,
    calendar.floweringEnd,
  );
  const flowerOpenProgress = progress(
    day,
    calendar.floweringStart,
    calendar.floweringPeak,
  );
  const flowerFadeProgress = progress(
    day,
    calendar.rayFadeStart,
    calendar.floweringEnd,
  );
  const seedHeadProgress = progress(
    day,
    calendar.seedHeadStart,
    calendar.floweringEnd,
  );
  const autumnProgress = progress(
    day,
    calendar.autumnStart,
    calendar.leafFallEnd,
  );
  const leafDropProgress = progress(
    day,
    calendar.leafFallStart,
    calendar.leafFallEnd,
  );
  const dryProgress = progress(day, calendar.autumnStart, calendar.dryFull);

  const beforeSpringCut = day < calendar.cutbackEnd;
  const lateDryStand = day >= calendar.dryFull;
  const standingDryVisibility = beforeSpringCut
    ? 1 - cutProgress
    : lateDryStand
      ? dryProgress
      : 0;
  const currentGrowthVisibility =
    day >= calendar.emergenceStart ? emergenceProgress : 0;
  const budVisibility =
    day >= calendar.budStart && day < calendar.floweringEnd
      ? 1 - flowerFadeProgress
      : 0;
  const flowerVisibility = clamp01(
    flowerOpenProgress * (1 - flowerFadeProgress * 0.82),
  );

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    bbchScale: 'general',
    seasonProfile,
    seasonProfileLabel: MAGNUS_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
    calendar,
    cutProgress,
    standingDryVisibility: clamp01(standingDryVisibility),
    currentGrowthVisibility: clamp01(currentGrowthVisibility),
    emergenceProgress,
    leafProgress,
    stemGrowthProgress,
    budProgress,
    budVisibility,
    flowerProgress,
    flowerOpenProgress,
    flowerFadeProgress,
    flowerVisibility,
    seedHeadProgress,
    autumnProgress,
    leafDropProgress,
    dryProgress,
    flowersOnCurrentSeasonStems: true,
    foliageDeciduous: true,
    winterSeedHeadsRetained: true,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Care guidance relevant to the selected day and plant age. */
export function getMagnusCareHints(
  value = 205,
  { plantAgeYears = 0, seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }

  const hints = [];
  if (day >= calendar.cutbackStart && day <= calendar.cutbackEnd) {
    hints.push(
      hint(
        'late-winter-cutback',
        'pruning',
        'important',
        'Cut the dry stems before spring growth',
        `The maintained plant is cleared now, between ${calendarLabel(calendar.cutbackStart)} and ${calendarLabel(calendar.cutbackEnd)}. Cut the old stems close to the crown without damaging the emerging basal shoots.`,
        MAGNUS_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (day >= calendar.floweringStart && day <= calendar.floweringEnd) {
    hints.push(
      hint(
        'deadhead-or-retain',
        'flowering',
        'notice',
        'Choose between repeat bloom and winter seed heads',
        'Removing faded heads can encourage later flowers. Leaving some in place preserves the prickly winter silhouette and food for seed-eating birds; this curated model keeps a natural mixture.',
        MAGNUS_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (day >= calendar.leafFallStart || day < calendar.cutbackStart) {
    hints.push(
      hint(
        'leave-winter-heads',
        'winter-interest',
        'recommended',
        'Leave the strongest seed heads standing',
        'The dry cones remain ornamental through winter. Clear the stand in late winter rather than cutting green growth in autumn.',
        MAGNUS_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (plantAgeYears >= MAGNUS_PROFILE.management.divisionIntervalYears[1]) {
    hints.push(
      hint(
        'consider-division',
        'maintenance',
        'notice',
        'Assess the crown before dividing',
        'Established coneflowers resent unnecessary disturbance. Divide only if vigour or flowering has declined, and replant into freely draining soil.',
        MAGNUS_SOURCES.rhsCultivar.url,
      ),
    );
  }

  return Object.freeze(hints);
}
