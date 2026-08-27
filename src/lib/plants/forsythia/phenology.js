import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import {
  LYNWOOD_PROFILE,
  LYNWOOD_RENDER_PRIORS,
  LYNWOOD_SOURCES,
} from './lynwood.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

/**
 * Regional flowering profiles for Poland.
 *
 * `central` is the turn-of-March/April peak reported for most Forsythia x
 * intermedia cultivars in central Poland. `northeast` applies the reported
 * 10-14 day lag for Mazury, Podlasie and Suwalszczyzna. `early` and `late`
 * bracket the weather-driven spread a single garden actually sees between
 * years; they are renderer scenarios, not observed station means.
 */
export const LYNWOOD_REGION_OBSERVATIONS = Object.freeze({
  central: Object.freeze({
    floweringOnset: monthDayToDay(3, 29),
    leafEmergenceOnset: monthDayToDay(4, 12),
    label: 'central Poland',
    observed: true,
  }),
  northeast: Object.freeze({
    floweringOnset: monthDayToDay(4, 10),
    leafEmergenceOnset: monthDayToDay(4, 23),
    label: 'north-east Poland (Mazury, Podlasie, Suwalszczyzna)',
    observed: true,
  }),
  early: Object.freeze({
    floweringOnset: monthDayToDay(3, 18),
    leafEmergenceOnset: monthDayToDay(4, 2),
    label: 'early (mild) central-Poland season',
    observed: false,
  }),
  late: Object.freeze({
    floweringOnset: monthDayToDay(4, 16),
    leafEmergenceOnset: monthDayToDay(4, 28),
    label: 'late (cold) central-Poland season',
    observed: false,
  }),
});

export const LYNWOOD_PHASE_ASSUMPTIONS = Object.freeze({
  budSwellingLeadDays: 26,
  // Individual clusters are staggered across the crown. The whole population
  // spans 24 days even though its dense, showy plateau is about two weeks.
  floweringDurationDays: 24,
  floweringPeakOffsetDays: 8,
  leafExpansionDays: 34,
  capsuleMaturityDay: monthDayToDay(9, 20),
  autumnStartDay: monthDayToDay(10, 4),
  leafFallEndDay: monthDayToDay(11, 14),
  note: 'Flowering onset and the north-east lag come from Polish horticultural sources. Phase durations, bud-swelling lead time and the autumn window shape the animation and are renderer assumptions, not observed station intervals.',
});

function createCalendar(observation, offsetDays = 0) {
  const shift = (day) => Math.max(1, Math.min(365, day + offsetDays));
  const floweringStart = shift(observation.floweringOnset);
  const floweringEnd = Math.min(
    365,
    floweringStart + LYNWOOD_PHASE_ASSUMPTIONS.floweringDurationDays - 1,
  );
  // Leaves break while the last flowers are still hanging on. Forsythia is
  // never simultaneously bare and fully leafy, but it IS simultaneously
  // flowering and just-breaking for roughly a week.
  const leafEmergenceStart = shift(observation.leafEmergenceOnset);
  return Object.freeze({
    dormantEnd: Math.max(
      1,
      floweringStart - LYNWOOD_PHASE_ASSUMPTIONS.budSwellingLeadDays - 1,
    ),
    budSwellingStart: Math.max(
      1,
      floweringStart - LYNWOOD_PHASE_ASSUMPTIONS.budSwellingLeadDays,
    ),
    floweringStart,
    floweringPeak:
      floweringStart + LYNWOOD_PHASE_ASSUMPTIONS.floweringPeakOffsetDays,
    floweringEnd,
    leafEmergenceStart,
    leafFullExpansion: Math.min(
      365,
      leafEmergenceStart + LYNWOOD_PHASE_ASSUMPTIONS.leafExpansionDays,
    ),
    capsuleSetStart: floweringEnd + 1,
    capsuleMatureStart: LYNWOOD_PHASE_ASSUMPTIONS.capsuleMaturityDay,
    autumnStart: LYNWOOD_PHASE_ASSUMPTIONS.autumnStartDay,
    leafFallEnd: LYNWOOD_PHASE_ASSUMPTIONS.leafFallEndDay,
  });
}

function calendarFor(region = 'central', offsetDays = 0) {
  if (!Object.hasOwn(LYNWOOD_REGION_OBSERVATIONS, region)) {
    throw new RangeError(
      "region must be 'central', 'northeast', 'early' or 'late'",
    );
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 45) {
    throw new RangeError('offsetDays must be a finite number from -45 to 45');
  }
  return createCalendar(
    LYNWOOD_REGION_OBSERVATIONS[region],
    Math.round(offsetDays),
  );
}

export const LYNWOOD_CALENDAR = createCalendar(
  LYNWOOD_REGION_OBSERVATIONS.central,
);

export const LYNWOOD_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile: 'central-Poland turn-of-March/April flowering peak',
  observedRegions: LYNWOOD_REGION_OBSERVATIONS,
  assumptions: LYNWOOD_PHASE_ASSUMPTIONS,
});

function stageFor(day, calendar) {
  if (day <= calendar.dormantEnd || day > calendar.leafFallEnd) {
    return ['dormant', 'Dormant bare wood', '00'];
  }
  if (day < calendar.floweringStart) {
    const swell = progress(
      day,
      calendar.budSwellingStart,
      calendar.floweringStart,
    );
    return [
      'flower-bud',
      'Flower buds swelling on bare wood',
      swell < 0.45 ? '53' : swell < 0.85 ? '55' : '59',
    ];
  }
  if (day <= calendar.floweringEnd) {
    const flower = progress(
      day,
      calendar.floweringStart,
      calendar.floweringEnd,
    );
    // Leaves break inside the flowering window, so the label has to say which
    // half of the display the viewer is looking at.
    const leafy = day >= calendar.leafEmergenceStart;
    if (flower < 0.28) {
      return ['flowering', 'Flowering on bare wood', '61'];
    }
    if (flower < 0.72) {
      return [
        'flowering',
        leafy ? 'Full flowering, first leaves breaking' : 'Full flowering',
        '65',
      ];
    }
    return ['flowering', 'Flowers fading, leaves expanding', '67'];
  }
  if (day < calendar.leafFullExpansion) {
    return ['leaf-expansion', 'Leaf expansion after flowering', '15'];
  }
  if (day < calendar.capsuleMatureStart) {
    return ['summer-canopy', 'Full green summer canopy', '19'];
  }
  if (day < calendar.autumnStart) {
    return ['capsule-maturity', 'Capsules maturing in the canopy', '81'];
  }
  const autumn = progress(day, calendar.autumnStart, calendar.leafFallEnd);
  return [
    'autumn',
    'Autumn colour and leaf fall',
    autumn < 0.42 ? '92' : autumn < 0.82 ? '95' : '97',
  ];
}

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

/**
 * Returns the baseline Polish 'Lynwood' stage for a calendar day.
 *
 * The returned shape intentionally matches the blackcurrant phenology contract
 * for the keys a renderer or UI shares (leafOpacity, flowerVisibility,
 * autumnProgress), so one demo panel and one React component can drive either
 * plant. Weather can shift real seasons by weeks; callers may apply an offset.
 */
export function getLynwoodPhenology(
  value = 100,
  { region = 'central', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(region, offsetDays);
  const [phase, label, bbch] = stageFor(day, calendar);

  const budSwellProgress = progress(
    day,
    calendar.budSwellingStart,
    calendar.floweringStart,
  );
  const floweringProgress = progress(
    day,
    calendar.floweringStart,
    calendar.floweringEnd,
  );
  // Leaf-out begins near the end of flowering and continues well past it.
  const leafProgress = progress(
    day,
    calendar.leafEmergenceStart,
    calendar.leafFullExpansion,
  );
  const autumnProgress = progress(
    day,
    calendar.autumnStart,
    calendar.leafFallEnd,
  );
  const leafOpacity = clamp01(leafProgress * (1 - autumnProgress));

  // Closed buds are visible from bud swelling until they have all opened.
  const latestOpeningDay =
    calendar.floweringStart +
    LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[1] +
    LYNWOOD_RENDER_PRIORS.corollaOpeningDays;
  const flowerBudVisibility =
    day >= calendar.budSwellingStart && day <= latestOpeningDay
      ? clamp01(
          Math.min(
            progress(
              day,
              calendar.budSwellingStart,
              calendar.budSwellingStart + 10,
            ),
            1 - progress(day, calendar.floweringStart, latestOpeningDay),
          ),
        )
      : 0;
  // Open corollas ramp up over the first third of the window and drop off as
  // petals brown and fall.
  const flowerOpenVisibility =
    day >= calendar.floweringStart && day <= calendar.floweringEnd
      ? clamp01(
          Math.min(
            progress(day, calendar.floweringStart - 1, calendar.floweringPeak),
            1 - progress(day, calendar.floweringEnd - 5, calendar.floweringEnd),
          ),
        )
      : 0;
  const flowerVisibility = clamp01(
    Math.max(flowerBudVisibility, flowerOpenVisibility),
  );
  const capsuleVisibility =
    day > calendar.capsuleSetStart && day <= calendar.leafFallEnd
      ? clamp01(
          progress(
            day,
            calendar.capsuleSetStart,
            calendar.capsuleSetStart + 30,
          ),
        )
      : 0;
  const capsuleMaturity = progress(
    day,
    calendar.capsuleMatureStart,
    calendar.leafFallEnd,
  );

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    region,
    regionLabel: LYNWOOD_REGION_OBSERVATIONS[region].label,
    offsetDays: Math.round(offsetDays),
    calendar,
    budSwellProgress,
    leafProgress,
    leafOpacity,
    flowerProgress: floweringProgress,
    flowerVisibility,
    flowerBudVisibility,
    flowerOpenVisibility,
    capsuleVisibility,
    capsuleMaturity,
    autumnProgress,
    // A viewer-facing statement of the defining habit, useful for the demo.
    flowersPrecedeLeaves: true,
    bareWoodFlowering:
      day <= calendar.leafEmergenceStart && flowerOpenVisibility > 0,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns care guidance relevant to the selected day and plant age. */
export function getLynwoodCareHints(
  value = 100,
  { plantAgeYears = 0, region = 'central', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = calendarFor(region, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }
  const hints = [];
  const dormant = day <= calendar.dormantEnd || day > calendar.leafFallEnd;
  const management = LYNWOOD_PROFILE.management;

  if (dormant && plantAgeYears < 1) {
    hints.push(
      hint(
        'plant-dormant',
        'planting',
        'recommended',
        'Plant while dormant',
        'Plant bare-root or container forsythia from autumn to early spring while the soil is workable and not frozen. Allow for a 1.5-2.5 m spread rather than a narrow gap.',
        LYNWOOD_SOURCES.rhsCultivar.url,
      ),
    );
  }

  if (day >= calendar.budSwellingStart && day < calendar.floweringStart) {
    hints.push(
      hint(
        'frost-watch',
        'phenology',
        'notice',
        'Swelling flower buds are frost-exposed',
        `Buds are swelling on bare wood ahead of a modeled ${calendarLabel(calendar.floweringStart)} onset. A hard late frost can brown open corollas, so judge by the buds rather than the date.`,
        LYNWOOD_SOURCES.polishSeason.url,
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
        `Peak flowering for Forsythia × intermedia runs at the turn of March and April in central Poland; the north-east runs 10-14 days later. Do not cut yet — the display is on last year's wood.`,
        LYNWOOD_SOURCES.polishSeason.url,
      ),
    );
  }

  // The defining management rule: the cut follows flowering, not dormancy.
  if (
    day > calendar.floweringEnd &&
    day <= management.latestSafePruningDay &&
    plantAgeYears >= management.renewalPruningMinimumAgeYears
  ) {
    hints.push(
      hint(
        'prune-after-flowering',
        'pruning',
        'important',
        'Prune now, immediately after flowering',
        'Cut flowered growth back to vigorous upward- and outward-facing shoots lower down, and remove up to one fifth of the oldest stems at the base. This is RHS pruning group 2.',
        LYNWOOD_SOURCES.rhsPruning.url,
      ),
    );
  }

  if (day > management.latestSafePruningDay && day < calendar.autumnStart) {
    hints.push(
      hint(
        'no-late-pruning',
        'pruning',
        'important',
        'Stop pruning — next spring flowers are setting',
        management.latestSafePruningNote +
          ' Shortening shoots now trades away next spring flowers for a tidier summer shape.',
        LYNWOOD_SOURCES.rhsPruning.url,
      ),
    );
  }

  if (
    day >= calendar.leafEmergenceStart &&
    day <= calendar.leafFullExpansion &&
    plantAgeYears >= 1
  ) {
    hints.push(
      hint(
        'tip-layering-check',
        'inspection',
        'notice',
        'Check arching tips for self-layering',
        'Arching shoots that touch soil root where they land. Lift or remove them unless you want the shrub to walk outward from its planting position.',
        LYNWOOD_SOURCES.ncStateToolbox.url,
      ),
    );
  }

  if (day >= calendar.autumnStart && day <= calendar.leafFallEnd) {
    hints.push(
      hint(
        'autumn-inspection',
        'inspection',
        'notice',
        'Inspect the framework as leaves fall',
        "Record weak, congested or worn-out stems now so next season's post-flowering renewal cuts can be planned. Do not cut them yet — those stems carry the spring display.",
        LYNWOOD_SOURCES.rhsPruning.url,
      ),
    );
  }

  return Object.freeze(hints);
}

export { dayOfYear };
