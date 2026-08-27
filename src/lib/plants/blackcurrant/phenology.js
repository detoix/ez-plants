import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { TISEL_PROFILE, TISEL_SOURCES } from './tisel.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

export const TISEL_TRIAL_OBSERVATIONS = Object.freeze({
  2022: Object.freeze({
    floweringOnset: monthDayToDay(4, 19),
    colouringOnset: monthDayToDay(6, 15),
    fullMaturity: monthDayToDay(6, 29),
  }),
  2023: Object.freeze({
    floweringOnset: monthDayToDay(4, 23),
    colouringOnset: monthDayToDay(6, 17),
    fullMaturity: monthDayToDay(7, 1),
  }),
  2024: Object.freeze({
    floweringOnset: monthDayToDay(4, 2),
    colouringOnset: monthDayToDay(5, 27),
    fullMaturity: monthDayToDay(6, 11),
  }),
  mean: Object.freeze({
    floweringOnset: monthDayToDay(4, 15),
    colouringOnset: monthDayToDay(6, 9),
    fullMaturity: monthDayToDay(6, 24),
  }),
});

export const TISEL_PHASE_ASSUMPTIONS = Object.freeze({
  floweringDurationDays: 12,
  colouringDurationDays: 14,
  harvestWindowDays: 8,
  overripeRetentionDays: 25,
  note: 'Phase durations shape the animation. Flowering and colouring durations are supported by the 2022 IO-PIB trial; the post-maturity picking window and overripe retention period are renderer assumptions, not observed trial intervals.',
});

function createCalendar(observation, offsetDays = 0) {
  const shift = (day) => Math.max(1, Math.min(365, day + offsetDays));
  const floweringStart = shift(observation.floweringOnset);
  const colouringStart = shift(observation.colouringOnset);
  const harvestStart = shift(observation.fullMaturity);
  const harvestEnd = Math.min(
    365,
    harvestStart + TISEL_PHASE_ASSUMPTIONS.harvestWindowDays - 1,
  );
  return Object.freeze({
    dormantEnd: shift(59),
    budBreakStart: shift(60),
    leafEmergenceStart: shift(80),
    floweringStart,
    floweringEnd: Math.min(
      colouringStart - 1,
      floweringStart + TISEL_PHASE_ASSUMPTIONS.floweringDurationDays - 1,
    ),
    fruitSetStart: Math.min(
      colouringStart - 1,
      floweringStart + TISEL_PHASE_ASSUMPTIONS.floweringDurationDays,
    ),
    colouringStart,
    colouringEnd: Math.min(
      harvestStart,
      colouringStart + TISEL_PHASE_ASSUMPTIONS.colouringDurationDays - 1,
    ),
    harvestStart,
    harvestEnd,
    fruitDropEnd: Math.min(
      365,
      harvestEnd + TISEL_PHASE_ASSUMPTIONS.overripeRetentionDays,
    ),
    autumnStart: shift(monthDayToDay(9, 16)),
    leafFallEnd: shift(monthDayToDay(10, 31)),
  });
}

function calendarFor(trialYear = 'mean', offsetDays = 0) {
  if (!Object.hasOwn(TISEL_TRIAL_OBSERVATIONS, trialYear)) {
    throw new RangeError("trialYear must be 2022, 2023, 2024 or 'mean'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 45) {
    throw new RangeError('offsetDays must be a finite number from -45 to 45');
  }
  return createCalendar(
    TISEL_TRIAL_OBSERVATIONS[trialYear],
    Math.round(offsetDays),
  );
}

export const TISEL_CALENDAR = createCalendar(TISEL_TRIAL_OBSERVATIONS.mean);

export const TISEL_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile: 'mean of 2022-2024 central-Poland milestones',
  observedYears: TISEL_TRIAL_OBSERVATIONS,
  assumptions: TISEL_PHASE_ASSUMPTIONS,
});

function stageFor(day, calendar) {
  if (day <= calendar.dormantEnd || day > calendar.leafFallEnd) {
    return ['dormant', 'Dormant', '00'];
  }
  if (day < calendar.leafEmergenceStart) {
    return ['bud-swelling', 'Bud swelling', '01'];
  }
  if (day < calendar.floweringStart) {
    return ['leaf-emergence', 'Leaf emergence', '11'];
  }
  if (day <= calendar.floweringEnd) {
    const flower = progress(
      day,
      calendar.floweringStart,
      calendar.floweringEnd,
    );
    return [
      'flowering',
      'Flowering',
      flower < 0.34 ? '61' : flower < 0.76 ? '65' : '69',
    ];
  }
  if (day < calendar.colouringStart) {
    const fruitSetMidpoint =
      calendar.fruitSetStart +
      (calendar.colouringStart - calendar.fruitSetStart) * 0.45;
    return [
      'fruit-set',
      'Fruit set and green berries',
      day < fruitSetMidpoint ? '71' : '75',
    ];
  }
  if (day < calendar.harvestStart) {
    return [
      'colouring',
      'Berries colouring',
      progress(day, calendar.colouringStart, calendar.harvestStart) < 0.75
        ? '81'
        : '87',
    ];
  }
  if (day <= calendar.harvestEnd) {
    return ['ripe', 'Ripe berries and harvest', '89'];
  }
  if (day < calendar.fruitDropEnd) {
    return ['overripe', 'Overripe berries and fruit drop', '89'];
  }
  if (day < calendar.autumnStart) {
    return ['post-harvest', 'Post-harvest canopy', '91'];
  }
  return [
    'autumn',
    'Autumn colour and leaf fall',
    progress(day, calendar.autumnStart, calendar.leafFallEnd) < 0.42
      ? '92'
      : progress(day, calendar.autumnStart, calendar.leafFallEnd) < 0.82
        ? '95'
        : '97',
  ];
}

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

/**
 * Returns the baseline central-Poland Tisel stage for a calendar day. Weather
 * can shift real seasons by weeks, so callers may later apply a thermal offset.
 */
export function getTiselPhenology(
  value = 172,
  { trialYear = 'mean', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(trialYear, offsetDays);
  const [phase, label, bbch] = stageFor(day, calendar);
  const leafProgress = progress(
    day,
    calendar.leafEmergenceStart - 5,
    calendar.floweringEnd + 8,
  );
  const autumnProgress = progress(
    day,
    calendar.autumnStart,
    calendar.leafFallEnd,
  );
  const floweringProgress = progress(
    day,
    calendar.floweringStart,
    calendar.floweringEnd,
  );
  const fruitProgress = progress(
    day,
    calendar.fruitSetStart,
    calendar.harvestStart,
  );
  const fruitColorProgress = progress(
    day,
    calendar.colouringStart,
    calendar.colouringEnd,
  );
  const ripeProgress = progress(
    day,
    calendar.colouringStart,
    calendar.harvestStart,
  );
  const harvestProgress = progress(
    day,
    calendar.harvestStart,
    calendar.harvestEnd,
  );
  const flowerFade =
    1 - progress(day, calendar.floweringEnd, calendar.floweringEnd + 4);
  const flowerVisibility =
    day >= calendar.floweringStart - 15 && day <= calendar.floweringEnd + 4
      ? Math.min(
          progress(day, calendar.floweringStart - 15, calendar.floweringStart),
          flowerFade,
        )
      : 0;
  const flowerOpenVisibility =
    day >= calendar.floweringStart ? flowerVisibility : 0;
  const berryVisibility =
    day >= calendar.fruitSetStart && day < calendar.fruitDropEnd
      ? Math.min(
          1,
          progress(day, calendar.fruitSetStart, calendar.fruitSetStart + 12) +
            0.16,
        )
      : 0;
  const fruitDropProgress =
    day <= calendar.harvestEnd
      ? 0
      : progress(day, calendar.harvestEnd + 1, calendar.fruitDropEnd);
  const leafOpacity = clamp01(leafProgress * (1 - autumnProgress));

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    trialYear,
    offsetDays: Math.round(offsetDays),
    calendar,
    leafProgress,
    leafOpacity,
    flowerProgress: floweringProgress,
    flowerVisibility,
    flowerOpenVisibility,
    fruitProgress,
    fruitColorProgress,
    ripeProgress,
    harvestProgress,
    berryVisibility,
    fruitDropProgress,
    autumnProgress,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns care guidance relevant to the selected day and plant age. */
export function getTiselCareHints(
  value = 172,
  { plantAgeYears = 0, trialYear = 'mean', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(trialYear, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }
  const hints = [];
  const dormant = day <= calendar.dormantEnd || day > calendar.leafFallEnd;

  if (dormant && plantAgeYears < 1) {
    hints.push(
      hint(
        'plant-dormant',
        'planting',
        'recommended',
        'Plant while dormant',
        'Plant bare-root blackcurrants from late autumn to early spring when soil is workable and not frozen.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (
    dormant &&
    plantAgeYears >= TISEL_PROFILE.management.renewalPruningMinimumAgeYears
  ) {
    hints.push(
      hint(
        'prune-old-canes',
        'pruning',
        'important',
        'Renew the shrub at crown level',
        'Remove up to one third of the oldest whole canes at the crown. Do not shorten every cane into a miniature tree.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.budBreakStart && day < calendar.floweringStart) {
    hints.push(
      hint(
        'spring-mulch-check',
        'soil',
        'recommended',
        'Mulch and check nutrition',
        'Refresh mulch, keep it clear of the crown, and base fertiliser on soil or leaf assessment instead of an automatic dose.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.floweringStart && day <= calendar.floweringEnd) {
    hints.push(
      hint(
        'flowering-watch',
        'phenology',
        'notice',
        'Flowering window',
        `This profile's modeled flowering onset is ${calendarLabel(calendar.floweringStart)}. Trial onset dates ranged from 2 to 23 April across 2022-2024, so watch the real buds and local forecast.`,
        TISEL_SOURCES.polishPomology2026.url,
      ),
    );
  }

  if (day >= calendar.fruitSetStart && day <= calendar.harvestEnd) {
    hints.push(
      hint(
        'water-fruit',
        'watering',
        'important',
        'Protect fruit development from drought',
        'Keep the root zone evenly moist during fruit set and berry swelling, without waterlogging the crown.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.harvestStart && day <= calendar.harvestEnd) {
    hints.push(
      hint(
        'harvest-tisel',
        'harvest',
        'important',
        'Check clusters for harvest',
        `This profile's modeled full-maturity date is ${calendarLabel(calendar.harvestStart)}. Observed dates were 11 June, 29 June and 1 July across the three trial years; pick fully black clusters on the real plant and log the crop.`,
        TISEL_SOURCES.polishPomology2026.url,
      ),
    );
  }

  if (day > calendar.harvestEnd && day < calendar.fruitDropEnd) {
    hints.push(
      hint(
        'record-overripe-loss',
        'harvest',
        'important',
        'Record overripe fruit and losses',
        'Unpicked berries are now modeled as progressively dropping. Check the real clusters, harvest usable fruit, and log shrivel or drop instead of treating it as remaining yield.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.autumnStart && day <= calendar.leafFallEnd) {
    hints.push(
      hint(
        'autumn-inspection',
        'inspection',
        'notice',
        'Inspect as leaves fall',
        'Record weak, damaged or congesting canes now so crown-level renewal cuts can be planned for dormancy.',
        TISEL_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  return Object.freeze(hints);
}

export { dayOfYear };
