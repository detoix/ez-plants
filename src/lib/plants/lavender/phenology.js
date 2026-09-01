import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { HIDCOTE_PROFILE, HIDCOTE_SOURCES } from './hidcote.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

/**
 * Regional flowering profiles for Poland.
 *
 * `central` is the (June) July to August window the Polish atlas gives for the
 * species, narrowed to 'Hidcote' by two dated photographs of identified
 * plants: full anthesis on 8 July, and the same cultivar dark and drying but
 * still uncut on 30 July. `northeast` applies the ten-to-fourteen day lag
 * Mazury, Podlasie and Suwalszczyzna show against central Poland -- the same
 * lag the forsythia profile in this library uses, and observed rather than
 * invented. `early` and `late` bracket the spread one garden sees between
 * years; they are renderer scenarios, not observed station means.
 */
export const HIDCOTE_REGION_OBSERVATIONS = Object.freeze({
  central: Object.freeze({
    spikeEmergenceOnset: monthDayToDay(6, 6),
    floweringOnset: monthDayToDay(6, 26),
    label: 'central Poland',
    observed: true,
  }),
  northeast: Object.freeze({
    spikeEmergenceOnset: monthDayToDay(6, 18),
    floweringOnset: monthDayToDay(7, 8),
    label: 'north-east Poland (Mazury, Podlasie, Suwalszczyzna)',
    observed: true,
  }),
  early: Object.freeze({
    spikeEmergenceOnset: monthDayToDay(5, 28),
    floweringOnset: monthDayToDay(6, 17),
    label: 'early (mild) central-Poland season',
    observed: false,
  }),
  late: Object.freeze({
    spikeEmergenceOnset: monthDayToDay(6, 16),
    floweringOnset: monthDayToDay(7, 6),
    label: 'late (cold) central-Poland season',
    observed: false,
  }),
});

export const HIDCOTE_PHASE_ASSUMPTIONS = Object.freeze({
  /** First colour to the last corolla, across the whole plant. */
  floweringDurationDays: 32,
  floweringPeakOffsetDays: 13,
  /** Spent spikes stand dark and dry for this long before the shears. */
  dryHeadRetentionDays: 12,
  /**
   * The one cut of the year. RHS puts it in late summer, just after
   * flowering; Polish practice puts it in August so the regrowth hardens
   * before the frosts. This lands it at the later end of flowering plus the
   * dry-head window, which for a central-Poland season is the second week of
   * August.
   */
  trimLeadDays: 2,
  /** Green regrowth after the shear, before the plant settles for winter. */
  regrowthDurationDays: 46,
  /** Spring growth resumes: a Mediterranean subshrub waits for warm soil. */
  springGrowthStartDay: monthDayToDay(4, 10),
  springGrowthEndDay: monthDayToDay(6, 14),
  /** The mound stops making leaves and thins into its winter state. */
  winterHardeningStartDay: monthDayToDay(10, 12),
  winterHardeningEndDay: monthDayToDay(11, 20),
  note: 'The flowering onset and the north-east lag come from Polish sources and two dated cultivar photographs. Phase durations, the dry-head window, the exact trim day and the spring and winter transitions shape the animation and are renderer assumptions, not observed station intervals.',
});

function createCalendar(observation, offsetDays = 0) {
  const shift = (day) => Math.max(1, Math.min(365, day + offsetDays));
  const spikeEmergenceStart = shift(observation.spikeEmergenceOnset);
  const floweringStart = shift(observation.floweringOnset);
  const floweringEnd = Math.min(
    365,
    floweringStart + HIDCOTE_PHASE_ASSUMPTIONS.floweringDurationDays - 1,
  );
  const dryHeadEnd = Math.min(
    365,
    floweringEnd + HIDCOTE_PHASE_ASSUMPTIONS.dryHeadRetentionDays,
  );
  const trimDay = Math.min(
    365,
    dryHeadEnd + HIDCOTE_PHASE_ASSUMPTIONS.trimLeadDays,
  );
  return Object.freeze({
    springGrowthStart: shift(HIDCOTE_PHASE_ASSUMPTIONS.springGrowthStartDay),
    springGrowthEnd: shift(HIDCOTE_PHASE_ASSUMPTIONS.springGrowthEndDay),
    spikeEmergenceStart,
    floweringStart,
    floweringPeak:
      floweringStart + HIDCOTE_PHASE_ASSUMPTIONS.floweringPeakOffsetDays,
    floweringEnd,
    dryHeadEnd,
    trimDay,
    regrowthEnd: Math.min(
      365,
      trimDay + HIDCOTE_PHASE_ASSUMPTIONS.regrowthDurationDays,
    ),
    winterHardeningStart: shift(
      HIDCOTE_PHASE_ASSUMPTIONS.winterHardeningStartDay,
    ),
    winterHardeningEnd: shift(HIDCOTE_PHASE_ASSUMPTIONS.winterHardeningEndDay),
  });
}

function calendarFor(region = 'central', offsetDays = 0) {
  if (!Object.hasOwn(HIDCOTE_REGION_OBSERVATIONS, region)) {
    throw new RangeError(
      "region must be 'central', 'northeast', 'early' or 'late'",
    );
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 45) {
    throw new RangeError('offsetDays must be a finite number from -45 to 45');
  }
  return createCalendar(
    HIDCOTE_REGION_OBSERVATIONS[region],
    Math.round(offsetDays),
  );
}

/** The calendar a caller gets when it names a region rather than passing one. */
export function getHidcoteCalendar(region = 'central', offsetDays = 0) {
  return calendarFor(region, offsetDays);
}

export const HIDCOTE_CALENDAR = createCalendar(
  HIDCOTE_REGION_OBSERVATIONS.central,
);

export const HIDCOTE_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'central-Poland (June) July to August flowering window, narrowed by two dated cultivar photographs',
  observedRegions: HIDCOTE_REGION_OBSERVATIONS,
  assumptions: HIDCOTE_PHASE_ASSUMPTIONS,
});

function stageFor(day, calendar) {
  if (
    day >= calendar.winterHardeningStart ||
    day < calendar.springGrowthStart
  ) {
    // Evergreen, so there is no dormant bare wood to report -- what the plant
    // does instead is stop, thin and go grey. BBCH 00 is still the right code:
    // the mound is alive and holding leaves, and nothing is growing.
    return ['winter', 'Evergreen winter mound', '00'];
  }
  if (day < calendar.spikeEmergenceStart) {
    return [
      'spring-growth',
      'Spring shoot extension',
      progress(day, calendar.springGrowthStart, calendar.spikeEmergenceStart) <
      0.5
        ? '11'
        : '19',
    ];
  }
  if (day < calendar.floweringStart) {
    const emergence = progress(
      day,
      calendar.spikeEmergenceStart,
      calendar.floweringStart,
    );
    return [
      'spike-emergence',
      'Green spikes on rising stems',
      emergence < 0.45 ? '51' : emergence < 0.8 ? '55' : '59',
    ];
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
      flower < 0.28 ? '61' : flower < 0.72 ? '65' : '69',
    ];
  }
  if (day < calendar.trimDay) {
    return ['dry-heads', 'Spent spikes drying', '87'];
  }
  if (day <= calendar.regrowthEnd) {
    return [
      'regrowth',
      'Sheared and regrowing',
      progress(day, calendar.trimDay, calendar.regrowthEnd) < 0.25
        ? '93'
        : '19',
    ];
  }
  return ['late-summer', 'Grey-green mound', '91'];
}

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

/**
 * Baseline central-Poland 'Hidcote' stage for a calendar day.
 *
 * Every value returned here is a fraction the model or renderer reads
 * directly. Two of them carry most of the plant: `spikeVisibility`, which
 * is one only between the stems rising and the shears, and `trimmed`, which
 * flips the whole plant from flowering to sheared in a single day the way a
 * real one does.
 */
export function getHidcotePhenology(
  value = 190,
  { region = 'central', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(region, offsetDays);
  const [phase, label, bbch] = stageFor(day, calendar);

  const springGrowth = progress(
    day,
    calendar.springGrowthStart,
    calendar.springGrowthEnd,
  );
  const trimmed = day >= calendar.trimDay;
  const regrowth = trimmed
    ? progress(day, calendar.trimDay, calendar.regrowthEnd)
    : 0;
  // Evergreen, so the mound is never empty and this is a density rather than
  // a leaf-fall curve: it thins into winter, refills through spring, loses the
  // 2.5 cm the shears take, and refills again before the frosts.
  const winterProgress =
    day < calendar.springGrowthStart
      ? 1
      : progress(
          day,
          calendar.winterHardeningStart,
          calendar.winterHardeningEnd,
        );
  const WINTER_DENSITY = 0.55;
  const summerDensity = trimmed
    ? 1 - 0.3 * (1 - regrowth)
    : WINTER_DENSITY + (1 - WINTER_DENSITY) * springGrowth;
  const leafiness =
    summerDensity + (WINTER_DENSITY - summerDensity) * winterProgress;

  const flowerProgress = progress(
    day,
    calendar.floweringStart,
    calendar.floweringEnd,
  );
  const spikeEmergence = progress(
    day,
    calendar.spikeEmergenceStart,
    calendar.floweringStart,
  );
  // The stems are up from emergence and gone the day of the shears. Nothing
  // fades out: a sheared lavender loses every spike it has at once.
  const spikeVisibility =
    day >= calendar.spikeEmergenceStart && day < calendar.trimDay ? 1 : 0;
  // How far one average spike has run through green -> violet -> dry. The
  // model staggers individual spikes around this.
  const spikeMaturity = progress(
    day,
    calendar.spikeEmergenceStart,
    calendar.dryHeadEnd,
  );
  const dryProgress = progress(day, calendar.floweringEnd, calendar.dryHeadEnd);

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    region,
    offsetDays: Math.round(offsetDays),
    calendar,
    springGrowth,
    leafiness,
    // How far the mound has gone over to its grey winter colour. A colour
    // change and a thinning together, not a leaf fall: the leaves stay on.
    winterProgress,
    trimmed,
    regrowth,
    spikeEmergence,
    spikeVisibility,
    spikeMaturity,
    flowerProgress,
    dryProgress,
    /** Peak display, for a UI that wants one number for "in flower". */
    displayIntensity:
      spikeVisibility === 0
        ? 0
        : clamp01(Math.min(spikeEmergence * 1.4, 1) * (1 - 0.55 * dryProgress)),
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns care guidance relevant to the selected day and plant age. */
export function getHidcoteCareHints(
  value = 190,
  { plantAgeYears = 0, region = 'central', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(region, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }
  const hints = [];
  const planting = HIDCOTE_PROFILE.management.plantingMonths;
  const plantingStart = monthDayToDay(planting[0], 1);
  const plantingEnd = monthDayToDay(planting.at(-1), 31);

  if (plantAgeYears < 1 && day >= plantingStart && day <= plantingEnd) {
    hints.push(
      hint(
        'plant-in-spring',
        'planting',
        'recommended',
        'Plant in April or May',
        'Plant as the soil warms, into free-draining ground in full sun. Never plant lavender in winter: a young plant sits in cold wet soil and rots.',
        HIDCOTE_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.springGrowthStart && day < calendar.spikeEmergenceStart) {
    hints.push(
      hint(
        'no-spring-cut',
        'pruning',
        'important',
        'Do not cut into the old wood',
        'Lavender does not break easily from old stems. Tidy winter-damaged shoot tips if you must, but keep every cut in this year’s green growth; wood cut bare stays bare.',
        HIDCOTE_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (day >= calendar.spikeEmergenceStart && day <= calendar.floweringEnd) {
    hints.push(
      hint(
        'flowering-watch',
        'phenology',
        'notice',
        'Flowering window',
        `This profile’s modelled first colour is ${calendarLabel(calendar.floweringStart)} and its peak ${calendarLabel(calendar.floweringPeak)}. The Polish window for the species runs from June into August and moves with the year, so watch the real spikes.`,
        HIDCOTE_SOURCES.atlasRoslin.url,
      ),
    );
  }

  if (day > calendar.floweringEnd && day < calendar.trimDay) {
    hints.push(
      hint(
        'harvest-before-shears',
        'harvest',
        'notice',
        'Cut for drying before the shears',
        'Spikes cut just as the first corollas open hold their colour and scent best. Whatever is left standing now is what the late-summer trim takes off.',
        HIDCOTE_SOURCES.atlasRoslin.url,
      ),
    );
  }

  if (day >= calendar.trimDay && day <= calendar.trimDay + 20) {
    hints.push(
      hint(
        'late-summer-trim',
        'pruning',
        'important',
        'Trim now, just after flowering',
        `The one cut of the year: take off the spent flower stems and about ${Math.round(HIDCOTE_PROFILE.management.trimLeafDepthM * 100)} cm of leafy growth, shaping the plant into a dome. Leave it later than ${calendarLabel(calendar.trimDay)} and the regrowth will not harden before the frosts.`,
        HIDCOTE_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  if (
    day >= calendar.winterHardeningStart ||
    day < calendar.springGrowthStart
  ) {
    hints.push(
      hint(
        'winter-drainage',
        'soil',
        'important',
        'Winter wet kills before winter cold does',
        'The species is the hardiest lavender there is and still unreliable in Poland: it is rated to about USDA 6b and dies back in severe winters. Keep the crown clear of mulch and the root zone draining freely.',
        HIDCOTE_SOURCES.atlasRoslin.url,
      ),
    );
  }

  if (plantAgeYears >= HIDCOTE_PROFILE.architecture.replacementCycleYears - 2) {
    hints.push(
      hint(
        'plan-replacement',
        'planting',
        'recommended',
        'Plan the replacement rather than a hard cut',
        'An old lavender goes straggly, woody and open in the middle, and there is no cut that fixes it — it will not break from old wood. Strike cuttings now and replace the plant.',
        HIDCOTE_SOURCES.rhsGrowingGuide.url,
      ),
    );
  }

  return Object.freeze(hints);
}

export { dayOfYear };
