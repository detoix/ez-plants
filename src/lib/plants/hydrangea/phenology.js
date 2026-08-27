import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { LIMELIGHT_PROFILE, LIMELIGHT_SOURCES } from './limelight.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

/**
 * Relative seasons for exploring weather timing around the central-Poland
 * baseline. The July-October display is observed; the +/-10-day scenarios are
 * animation brackets, not weather-station averages.
 */
export const LIMELIGHT_SEASON_PROFILES = Object.freeze({
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
 * A visually continuous calendar anchored to the mid-July to early-October
 * RHS trial display and the Polish July-October report. Fine-scale leaf,
 * shoot, colour-transition and leaf-fall dates are declared assumptions.
 */
export const LIMELIGHT_PHASE_ASSUMPTIONS = Object.freeze({
  baseline: Object.freeze({
    dormantEnd: monthDayToDay(3, 15),
    budSwellingStart: monthDayToDay(3, 16),
    leafEmergenceStart: monthDayToDay(4, 10),
    shootEmergenceStart: LIMELIGHT_PROFILE.growth.shootEmergenceDay,
    leafFullExpansion: monthDayToDay(5, 20),
    panicleInitiationStart: monthDayToDay(6, 12),
    visiblePanicleBudStart: monthDayToDay(6, 22),
    floweringStart: monthDayToDay(7, 15),
    limePeak: monthDayToDay(7, 27),
    creamWhiteStart: monthDayToDay(8, 7),
    floweringPeak: monthDayToDay(8, 18),
    pinkStart: monthDayToDay(9, 8),
    burgundyStart: monthDayToDay(9, 26),
    autumnStart: monthDayToDay(9, 30),
    freshDisplayEnd: monthDayToDay(10, 7),
    dryPanicleStart: monthDayToDay(10, 8),
    dryPanicleFull: monthDayToDay(10, 20),
    leafFallEnd: monthDayToDay(11, 15),
    previousPaniclePruneStart: LIMELIGHT_PROFILE.management.pruningDayRange[0],
    previousPaniclePruneEnd: LIMELIGHT_PROFILE.management.pruningDayRange[1],
  }),
  note: 'Flowering from mid-July to early October and its lime-to-white-to-pink sequence are source observations. The exact intra-season transitions, spring growth dates, +/-10-day season profiles and autumn leaf-fall window are renderer assumptions for central Poland.',
});

function createCalendar(seasonProfile = 'typical', offsetDays = 0) {
  if (!Object.hasOwn(LIMELIGHT_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 30) {
    throw new RangeError('offsetDays must be a finite number from -30 to 30');
  }

  const profile = LIMELIGHT_SEASON_PROFILES[seasonProfile];
  const totalOffset = profile.dayOffset + Math.round(offsetDays);
  const shift = (day) => Math.max(1, Math.min(365, day + totalOffset));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(LIMELIGHT_PHASE_ASSUMPTIONS.baseline).map(([key, day]) => [
        key,
        shift(day),
      ]),
    ),
  );
}

export function getLimelightCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  return createCalendar(seasonProfile, offsetDays);
}

export const LIMELIGHT_CALENDAR = createCalendar();

export const LIMELIGHT_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'mid-July to early-October RHS trial display and Polish July-October display',
  seasonProfiles: LIMELIGHT_SEASON_PROFILES,
  assumptions: LIMELIGHT_PHASE_ASSUMPTIONS,
  sources: Object.freeze([
    LIMELIGHT_SOURCES.rhsTrial2008.url,
    LIMELIGHT_SOURCES.polishRetailer.url,
    LIMELIGHT_SOURCES.treesAndShrubsOnline.url,
  ]),
});

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

function stageFor(day, calendar) {
  if (day <= calendar.dormantEnd || day > calendar.leafFallEnd) {
    return ['dormant', 'Dormant framework with retained dry panicles', '00'];
  }
  if (day < calendar.leafEmergenceStart) {
    return ['bud-swelling', 'Vegetative buds swelling', '01'];
  }
  if (day < calendar.leafFullExpansion) {
    return [
      'leaf-emergence',
      'Leaves and current-season shoots expanding',
      '11',
    ];
  }
  if (day < calendar.panicleInitiationStart) {
    return ['shoot-extension', 'Current-season shoot extension', '19'];
  }
  if (day < calendar.floweringStart) {
    return ['panicle-bud', 'Terminal panicles forming in green bud', '55'];
  }
  if (day < calendar.creamWhiteStart) {
    return ['lime-flowering', 'Pale-lime florets opening', '61'];
  }
  if (day < calendar.pinkStart) {
    return ['cream-flowering', 'Cream-white panicles in full display', '65'];
  }
  if (day < calendar.burgundyStart) {
    return ['pink-ageing', 'Panicles ageing blush pink', '67'];
  }
  if (day < calendar.dryPanicleStart) {
    return [
      'burgundy-ageing',
      'Pink-burgundy panicles and autumn foliage',
      '69',
    ];
  }
  if (day <= calendar.leafFallEnd) {
    return [
      'autumn-drying',
      'Panicles drying tan as leaves colour and fall',
      '95',
    ];
  }
  return ['dormant', 'Dormant framework with retained dry panicles', '00'];
}

function panicleColourStage(day, calendar, oldPanicleVisibility) {
  if (oldPanicleVisibility > 0 && day < calendar.panicleInitiationStart) {
    return 'dry-tan';
  }
  if (day < calendar.floweringStart) return 'green-bud';
  if (day < calendar.creamWhiteStart) return 'pale-lime';
  if (day < calendar.pinkStart) return 'cream-white';
  if (day < calendar.burgundyStart) return 'blush-pink';
  if (day < calendar.dryPanicleStart) return 'burgundy-pink';
  return 'dry-tan';
}

/**
 * Returns a continuous Limelight state for one leap-neutral calendar day.
 * Panicles are split into fresh current-season heads and persistent dry heads
 * so a renderer can show both summer bloom and the characteristic winter
 * skeleton without pretending that the same flower is biologically new.
 */
export function getLimelightPhenology(
  value = 230,
  { seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  const [phase, label, bbch] = stageFor(day, calendar);

  const budSwellProgress = progress(
    day,
    calendar.budSwellingStart,
    calendar.leafEmergenceStart,
  );
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
  const shootGrowthProgress = progress(
    day,
    calendar.shootEmergenceStart,
    LIMELIGHT_PROFILE.growth.shootExtensionEndDay +
      (calendar.floweringStart -
        LIMELIGHT_PHASE_ASSUMPTIONS.baseline.floweringStart),
  );

  const currentPanicleVisibility =
    day >= calendar.panicleInitiationStart
      ? progress(
          day,
          calendar.panicleInitiationStart,
          calendar.visiblePanicleBudStart,
        )
      : 0;
  const panicleGrowthProgress = progress(
    day,
    calendar.panicleInitiationStart,
    calendar.creamWhiteStart,
  );
  const panicleBudVisibility =
    day >= calendar.panicleInitiationStart && day <= calendar.floweringPeak
      ? clamp01(
          Math.min(
            progress(
              day,
              calendar.panicleInitiationStart,
              calendar.visiblePanicleBudStart,
            ),
            1 - progress(day, calendar.floweringStart, calendar.floweringPeak),
          ),
        )
      : 0;
  const flowerProgress = progress(
    day,
    calendar.floweringStart,
    calendar.freshDisplayEnd,
  );
  // Limelight's showy sepals persist while they dry; a fresh flower does not
  // disappear and get replaced by a separate dry organ. Overlap the loss of
  // fresh display with the dry-colour transition through dryPanicleFull. If
  // both curves ended/started at dryPanicleStart, their shared zero on that
  // exact integer day would erase every floral surface for one slider step.
  const flowerOpenVisibility =
    day >= calendar.floweringStart && day <= calendar.dryPanicleFull
      ? clamp01(
          Math.min(
            progress(day, calendar.floweringStart - 2, calendar.floweringPeak),
            1 -
              progress(day, calendar.freshDisplayEnd, calendar.dryPanicleFull),
          ),
        )
      : 0;

  // A maintained plant loses last year's heads progressively through its
  // modeled pruning window.
  const oldPanicleVisibility =
    day <= calendar.previousPaniclePruneEnd
      ? 1 -
        progress(
          day,
          calendar.previousPaniclePruneStart,
          calendar.previousPaniclePruneEnd,
        )
      : 0;
  const currentDryProgress =
    day >= calendar.dryPanicleStart
      ? progress(day, calendar.dryPanicleStart, calendar.dryPanicleFull)
      : 0;
  const dryPanicleVisibility = clamp01(
    Math.max(oldPanicleVisibility, currentDryProgress),
  );
  const freshPanicleVisibility = clamp01(
    currentPanicleVisibility * (1 - currentDryProgress),
  );
  const panicleVisibility = Math.max(
    currentPanicleVisibility,
    oldPanicleVisibility,
  );
  const sterileFloretVisibility = Math.max(
    oldPanicleVisibility,
    currentDryProgress,
    flowerOpenVisibility,
  );
  const fertileFloretVisibility = Math.max(
    oldPanicleVisibility * 0.38,
    currentDryProgress * 0.5,
    panicleBudVisibility,
    flowerOpenVisibility * 0.78,
  );

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    seasonProfile,
    seasonProfileLabel: LIMELIGHT_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
    calendar,
    budSwellProgress,
    leafProgress,
    leafOpacity,
    autumnProgress,
    shootGrowthProgress,
    panicleGrowthProgress,
    panicleVisibility,
    currentPanicleVisibility,
    oldPanicleVisibility,
    freshPanicleVisibility,
    dryPanicleVisibility,
    panicleBudVisibility,
    sterileFloretVisibility,
    fertileFloretVisibility,
    flowerProgress,
    flowerVisibility: flowerOpenVisibility,
    flowerOpenVisibility,
    panicleColourStage: panicleColourStage(day, calendar, oldPanicleVisibility),
    limeToCreamProgress: progress(
      day,
      calendar.limePeak,
      calendar.creamWhiteStart,
    ),
    pinkProgress: progress(day, calendar.pinkStart, calendar.burgundyStart),
    burgundyProgress: progress(
      day,
      calendar.burgundyStart,
      calendar.dryPanicleStart,
    ),
    dryProgress: Math.max(oldPanicleVisibility, currentDryProgress),
    flowersOnCurrentSeasonWood: true,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns Limelight care guidance relevant to the selected day and age. */
export function getLimelightCareHints(
  value = 230,
  { plantAgeYears = 0, seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }

  const hints = [];
  if (
    plantAgeYears >= 1 &&
    day >= calendar.previousPaniclePruneStart &&
    day <= calendar.previousPaniclePruneEnd
  ) {
    hints.push(
      hint(
        'medium-spring-prune',
        'pruning',
        'important',
        'Medium-prune before new growth',
        "Shorten last season's flowered shoots to the established framework, retaining about four buds and removing weak or crossing growth. Limelight flowers on shoots it will make this year, but repeated severe cuts encourage oversized heads on softer stems.",
        LIMELIGHT_SOURCES.treesAndShrubsOnline.url,
      ),
    );
  }

  if (
    day > calendar.previousPaniclePruneEnd &&
    day < calendar.panicleInitiationStart
  ) {
    hints.push(
      hint(
        'protect-current-shoots',
        'pruning',
        'notice',
        'Protect the developing flowering shoots',
        "The expanding shoots are this season's flower-bearing wood. Limit work now to damaged or clearly misplaced growth so the terminal panicles can form.",
        LIMELIGHT_SOURCES.polishRetailer.url,
      ),
    );
  }

  if (day >= calendar.floweringStart && day <= calendar.freshDisplayEnd) {
    hints.push(
      hint(
        'observe-colour-sequence',
        'phenology',
        'notice',
        'Track the long panicle display',
        `The modeled display begins ${calendarLabel(calendar.floweringStart)} and runs into early October, changing from lime through cream-white to pink. Real timing moves with site and weather, so compare the selected date with the actual heads.`,
        LIMELIGHT_SOURCES.rhsTrial2008.url,
      ),
    );
  }

  if (day >= calendar.creamWhiteStart && day < calendar.dryPanicleStart) {
    hints.push(
      hint(
        'check-panicle-support',
        'inspection',
        'recommended',
        'Check heavy heads after rain',
        'Limelight usually has strong stems, but very large dense heads can pull long or severely pruned shoots over. Inspect rather than responding with another hard cut.',
        LIMELIGHT_SOURCES.rhsTrial2008.url,
      ),
    );
  }

  if (
    day >= calendar.dryPanicleStart ||
    day <= calendar.previousPaniclePruneStart
  ) {
    hints.push(
      hint(
        'retain-dry-heads',
        'seasonal-care',
        'notice',
        'Dry panicles may remain for winter',
        'The showy calyces are persistent, so tan heads can remain on the bare framework. If retained, remove them during the late-winter to early-spring pruning window rather than treating them as new bloom.',
        LIMELIGHT_SOURCES.cultivarPatent.url,
      ),
    );
  }

  return Object.freeze(hints);
}

export { dayOfYear };
