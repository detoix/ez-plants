import { dayOfYear } from '../blackcurrant/phenology.js';
import { MALEPARTUS_PROFILE, MALEPARTUS_SOURCES } from './malepartus.js';

export { dayOfYear };

const MONTH_START = Object.freeze([
  0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
]);

const MONTH_NAMES = Object.freeze([
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

const monthDayToDay = (month, day) => MONTH_START[month] + day;

function calendarLabel(dayOfYearValue) {
  for (let month = 12; month >= 1; month -= 1) {
    if (dayOfYearValue > MONTH_START[month]) {
      return `${dayOfYearValue - MONTH_START[month]} ${MONTH_NAMES[month]}`;
    }
  }
  return '1 January';
}

/**
 * Relative seasons for exploring weather timing around the central-Poland
 * baseline. The mid-August to November display is observed; the +/-10-day
 * scenarios are animation brackets, not weather-station averages.
 *
 * The bracket matters more for a C4 grass than for this library's shrubs:
 * Miscanthus waits for warm soil rather than for a chill requirement, so a
 * cold spring genuinely delays the whole season rather than only budbreak.
 */
export const MALEPARTUS_SEASON_PROFILES = Object.freeze({
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
 * A visually continuous calendar anchored to the observed mid-August to
 * November display and to the early-spring cutback reported for Polish
 * gardens. Emergence, extension and the fine colour-transition dates are
 * declared renderer assumptions.
 */
export const MALEPARTUS_PHASE_ASSUMPTIONS = Object.freeze({
  baseline: Object.freeze({
    // Last season's culms stand untouched until the cutback window.
    cutbackStart: MALEPARTUS_PROFILE.management.cutbackDayRange[0],
    cutbackEnd: MALEPARTUS_PROFILE.management.cutbackDayRange[1],
    // A C4 grass waits for warm soil; nothing green appears in March.
    emergenceStart: monthDayToDay(4, 28),
    tilleringStart: monthDayToDay(5, 8),
    culmElongationStart: monthDayToDay(5, 28),
    foliageFullExpansion: monthDayToDay(7, 22),
    bootingStart: monthDayToDay(7, 26),
    panicleEmergenceStart: monthDayToDay(8, 8),
    panicleFullyExposed: monthDayToDay(8, 28),
    plumeOpenStart: monthDayToDay(8, 20),
    plumeFullFluff: monthDayToDay(9, 16),
    silveringStart: monthDayToDay(9, 22),
    silverFull: monthDayToDay(11, 15),
    autumnStart: monthDayToDay(10, 18),
    autumnPeak: monthDayToDay(11, 2),
    strawStart: monthDayToDay(10, 27),
    strawFull: monthDayToDay(11, 30),
    // Winter weathering thins and scruffs the standing plant but does not
    // remove it; only the cutback does that.
    weatheringFull: monthDayToDay(2, 20),
  }),
  note: 'The mid-August to November display, its coppery-to-silver sequence, the arching white-midribbed foliage and the early-spring cut to about 10 cm are source observations. Emergence, tillering, culm-extension, autumn-colour and winter-weathering dates, and the +/-10-day season profiles, are renderer assumptions for central Poland.',
});

function createCalendar(seasonProfile = 'typical', offsetDays = 0) {
  if (!Object.hasOwn(MALEPARTUS_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 30) {
    throw new RangeError('offsetDays must be a finite number from -30 to 30');
  }

  const profile = MALEPARTUS_SEASON_PROFILES[seasonProfile];
  const totalOffset = profile.dayOffset + Math.round(offsetDays);
  const shift = (day) => Math.max(1, Math.min(365, day + totalOffset));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(MALEPARTUS_PHASE_ASSUMPTIONS.baseline).map(
        ([key, day]) => [key, shift(day)],
      ),
    ),
  );
}

export function getMalepartusCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  return createCalendar(seasonProfile, offsetDays);
}

export const MALEPARTUS_CALENDAR = createCalendar();

export const MALEPARTUS_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'mid-August to November plume display, coppery-purple opening to silver, and an early-spring cut to about 10 cm',
  seasonProfiles: MALEPARTUS_SEASON_PROFILES,
  assumptions: MALEPARTUS_PHASE_ASSUMPTIONS,
  sources: Object.freeze([
    MALEPARTUS_SOURCES.rhsCultivar.url,
    MALEPARTUS_SOURCES.diggingDog.url,
    MALEPARTUS_SOURCES.polishGuide.url,
    MALEPARTUS_SOURCES.ncsuSpecies.url,
  ]),
});

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

/**
 * Growth stages labelled with the BBCH cereal scale.
 *
 * The shrubs in this library use the woody-plant codes; a grass belongs on the
 * monocotyledon scale, where 0x is germination/emergence, 2x tillering,
 * 3x stem elongation, 4x booting, 5x heading, 6x flowering, 7x-8x ripening
 * and 9x senescence.
 */
function stageFor(day, calendar, cut) {
  if (cut) {
    return ['cut-back', 'Cut back to a short crown of stubble', '00'];
  }
  if (day < calendar.cutbackStart) {
    return [
      'standing-dry',
      "Last season's culms and silvered plumes standing dry",
      '97',
    ];
  }
  if (day < calendar.emergenceStart) {
    return ['dormant', 'Dormant crown before the first shoots', '00'];
  }
  if (day < calendar.tilleringStart) {
    return ['emergence', 'New blades emerging from the crown', '09'];
  }
  if (day < calendar.culmElongationStart) {
    return ['tillering', 'Tillers multiplying at the crown', '21'];
  }
  if (day < calendar.bootingStart) {
    return ['culm-elongation', 'Culms elongating through the leaf fan', '32'];
  }
  if (day < calendar.panicleEmergenceStart) {
    return ['booting', 'Panicles swelling inside the flag-leaf sheaths', '47'];
  }
  if (day < calendar.plumeOpenStart) {
    return ['heading', 'Coppery panicles pushing clear of the foliage', '55'];
  }
  if (day < calendar.silveringStart) {
    return ['flowering', 'Wine-red plumes open and fluffing out', '65'];
  }
  if (day < calendar.strawStart) {
    return [
      'silvering',
      'Plumes silvering as the foliage turns bronze and red',
      '75',
    ];
  }
  if (day < calendar.strawFull) {
    return ['senescence', 'Foliage fading through copper to straw', '93'];
  }
  return [
    'standing-dry',
    'Silver plumes over buff winter culms, standing dry',
    '97',
  ];
}

function plumeColourStage(day, calendar) {
  if (day < calendar.panicleEmergenceStart) return 'absent';
  if (day < calendar.plumeOpenStart) return 'coppery-wine';
  if (day < calendar.silveringStart) return 'bronze-pink';
  if (day < calendar.silverFull) return 'silver-pink';
  if (day < calendar.strawFull) return 'silver-white';
  return 'weathered-ivory';
}

/**
 * Returns a continuous Malepartus state for one leap-neutral calendar day.
 *
 * Because the plant is rebuilt from the crown every year, the interesting
 * quantity is not "how much older is the framework" but "how far through this
 * year's build-and-collapse cycle are we". `standingDryVisibility` describes
 * last year's culms and `emergenceProgress` this year's, and the two only
 * overlap when the plant is not cut.
 */
export function getMalepartusPhenology(
  value = 250,
  { seasonProfile = 'typical', offsetDays = 0, scenario = 'maintained' } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);

  // A maintained clump loses last year's culms across the cutback window; an
  // uncut clump keeps them, progressively collapsing, into the new season.
  const cutProgress =
    scenario === 'maintained'
      ? progress(day, calendar.cutbackStart, calendar.cutbackEnd)
      : 0;
  const emergenceProgress = progress(
    day,
    calendar.emergenceStart,
    calendar.foliageFullExpansion,
  );
  // Culms only extend once the leaf fan is established, so a shoot at 20 %
  // emergence is a tuft of blades, not a knee-high stem.
  const culmExtensionProgress = progress(
    day,
    calendar.culmElongationStart,
    calendar.foliageFullExpansion,
  );
  const standingDryVisibility =
    scenario === 'maintained'
      ? 1 - cutProgress
      : // Uncut culms lean, shed blades and settle into the new growth, but
        // never disappear on their own. By late summer roughly a third of the
        // sites are still holding last season's culm above the new fan.
        1 - 0.8 * progress(day, calendar.emergenceStart, calendar.autumnStart);
  const stubbleVisibility =
    scenario === 'maintained'
      ? // Fresh stubble is bare and obvious, then hidden as the canopy closes.
        cutProgress *
        (1 - progress(day, calendar.emergenceStart, calendar.tilleringStart))
      : 0;
  const cut = scenario === 'maintained' && day >= calendar.cutbackEnd;
  const [phase, label, bbch] = stageFor(
    day,
    calendar,
    cut && day < calendar.emergenceStart,
  );

  const paniclePush = progress(
    day,
    calendar.panicleEmergenceStart,
    calendar.panicleFullyExposed,
  );
  // The fan is pressed shut inside the flag-leaf sheath and spreads as it
  // clears it, so opening trails emergence rather than tracking it.
  const fanOpenProgress = progress(
    day,
    calendar.panicleEmergenceStart + 4,
    calendar.plumeFullFluff,
  );
  const plumeFluffProgress = progress(
    day,
    calendar.plumeOpenStart,
    calendar.plumeFullFluff,
  );
  const silverProgress = progress(
    day,
    calendar.silveringStart,
    calendar.silverFull,
  );
  const autumnProgress = progress(
    day,
    calendar.autumnStart,
    calendar.autumnPeak,
  );
  const strawProgress = progress(day, calendar.strawStart, calendar.strawFull);
  // Winter storms tatter blades and plumes. Weathering is measured from the
  // day the cohort went dry, not from 1 January, so it stays continuous when
  // the slider wraps past New Year and this season's culms become last
  // season's. `weatheringDays` is the modelled span from straw to a fully
  // scoured winter clump.
  const weatheringDays = 150;
  const weatheringProgress = clamp01(
    Math.max(0, day - calendar.strawStart) / weatheringDays,
  );
  const previousWeatheringProgress = clamp01(
    (day + 365 - calendar.strawStart) / weatheringDays,
  );

  const panicleVisibility = clamp01(paniclePush);
  const plumeVisibility = clamp01(
    Math.max(plumeFluffProgress * 0.85 + paniclePush * 0.15, 0) *
      (day >= calendar.panicleEmergenceStart ? 1 : 0),
  );

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    bbchScale: 'cereal',
    seasonProfile,
    seasonProfileLabel: MALEPARTUS_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
    scenario,
    calendar,
    cutProgress,
    stubbleVisibility: clamp01(stubbleVisibility),
    standingDryVisibility: clamp01(standingDryVisibility),
    emergenceProgress,
    culmExtensionProgress,
    // Blades expand a little ahead of the culms that carry them.
    bladeProgress: clamp01(Math.pow(emergenceProgress, 0.78)),
    autumnProgress,
    strawProgress,
    weatheringProgress,
    previousWeatheringProgress,
    paniclePush,
    panicleVisibility,
    fanOpenProgress,
    plumeFluffProgress,
    plumeVisibility,
    silverProgress,
    plumeColourStage: plumeColourStage(day, calendar),
    flowersOnCurrentSeasonCulms: true,
    foliageIsDeciduousButPersistent: true,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns Malepartus care guidance relevant to the selected day and age. */
export function getMalepartusCareHints(
  value = 250,
  {
    plantAgeYears = 0,
    seasonProfile = 'typical',
    offsetDays = 0,
    scenario = 'maintained',
  } = {},
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
        'spring-cutback',
        'pruning',
        'important',
        'Cut last year’s culms to about 10 cm',
        `The one annual cut falls now, from ${calendarLabel(calendar.cutbackStart)}: take every dry culm down to roughly 10 cm before or just as the new blades appear. Cutting later slices the emerging shoots and leaves permanently blunt blade tips all summer.`,
        MALEPARTUS_SOURCES.polishGuide.url,
      ),
    );
  }

  if (day > calendar.cutbackEnd && day < calendar.emergenceStart) {
    hints.push(
      hint(
        'wait-for-warm-soil',
        'phenology',
        'notice',
        'Nothing will move until the soil warms',
        `Malepartus is a C4 warm-season grass, so a bare crown in April is normal rather than a losses. The modeled first blades appear about ${calendarLabel(calendar.emergenceStart)}, weeks after the shrubs around it have leafed out.`,
        MALEPARTUS_SOURCES.ncsuSpecies.url,
      ),
    );
  }

  if (
    day >= calendar.panicleEmergenceStart &&
    day <= calendar.silverFull &&
    plantAgeYears >= MALEPARTUS_PROFILE.growth.firstFloweringAgeYears
  ) {
    hints.push(
      hint(
        'observe-plume-sequence',
        'phenology',
        'notice',
        'Track the coppery-to-silver change',
        `The modeled display opens about ${calendarLabel(calendar.panicleEmergenceStart)} — early for the genus — as coppery wine-red plumes, then lightens through bronze-pink to silver by late October. Real timing moves with site and weather, so compare the selected date with the actual heads.`,
        MALEPARTUS_SOURCES.diggingDog.url,
      ),
    );
  }

  if (day >= calendar.strawStart || day < calendar.cutbackStart) {
    hints.push(
      hint(
        'leave-standing-for-winter',
        'seasonal-care',
        'recommended',
        'Leave the clump standing over winter',
        'The dry culms, blades and silvered plumes are the whole winter display, and the standing crown also protects itself from wet cold. Tidying in autumn removes four months of interest and gains nothing.',
        MALEPARTUS_SOURCES.polishGuide.url,
      ),
    );
  }

  const [divideFrom, divideTo] =
    MALEPARTUS_PROFILE.management.divisionIntervalYears;
  if (
    plantAgeYears >=
      MALEPARTUS_PROFILE.architecture.centreDieOutStartAgeYears &&
    day >= calendar.cutbackStart &&
    day <= calendar.emergenceStart
  ) {
    hints.push(
      hint(
        'divide-open-centre',
        'renewal',
        scenario === 'neglected' ? 'important' : 'recommended',
        'Lift and divide the opening centre',
        `An established clump dies out in the middle and becomes a ring of outer tillers. Lift it in early spring, cut vigorous outer sections away and discard the dead centre; every ${divideFrom}-${divideTo} years keeps it dense.`,
        MALEPARTUS_SOURCES.divisionPractice.url,
      ),
    );
  }

  if (
    plantAgeYears < MALEPARTUS_PROFILE.growth.firstFloweringAgeYears &&
    day >= calendar.panicleEmergenceStart
  ) {
    hints.push(
      hint(
        'first-season-vegetative',
        'phenology',
        'notice',
        'A first-year clump usually stays vegetative',
        'Expect foliage only in the planting year. The RHS puts full height two to five years out, and the plumes arrive with it.',
        MALEPARTUS_SOURCES.rhsCultivar.url,
      ),
    );
  }

  return Object.freeze(hints);
}
