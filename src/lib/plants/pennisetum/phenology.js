import { calendarLabel, dayOfYear, monthDayToDay } from '../../calendar.js';
import { HAMELN_PROFILE, HAMELN_SOURCES } from './hameln.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));

/**
 * Relative seasons for exploring weather timing around the central-Poland
 * baseline. The late-July to September display is observed; the +/-10-day
 * scenarios are animation brackets, not weather-station averages.
 *
 * The bracket matters more for a C4 grass than for this library's shrubs:
 * Pennisetum waits for warm soil rather than for a chill requirement, so a
 * cold spring genuinely delays the whole season rather than only budbreak.
 */
export const HAMELN_SEASON_PROFILES = Object.freeze({
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
 * A visually continuous calendar anchored to the observed late-July to
 * September display and to the early-spring cutback reported for Polish
 * gardens. Emergence, extension and the fine colour-transition dates are
 * declared renderer assumptions.
 */
export const HAMELN_PHASE_ASSUMPTIONS = Object.freeze({
  baseline: Object.freeze({
    // Last season's culms stand untouched until the cutback window.
    cutbackStart: HAMELN_PROFILE.management.cutbackDayRange[0],
    cutbackEnd: HAMELN_PROFILE.management.cutbackDayRange[1],
    // A C4 grass waits for warm soil; nothing green appears in March.
    emergenceStart: monthDayToDay(4, 22),
    tilleringStart: monthDayToDay(5, 1),
    culmElongationStart: monthDayToDay(5, 18),
    foliageFullExpansion: monthDayToDay(7, 10),
    bootingStart: monthDayToDay(7, 12),
    panicleEmergenceStart: monthDayToDay(7, 25),
    panicleFullyExposed: monthDayToDay(8, 10),
    plumeOpenStart: monthDayToDay(7, 30),
    plumeFullFluff: monthDayToDay(8, 12),
    headMaturingStart: monthDayToDay(8, 28),
    headMature: monthDayToDay(10, 10),
    autumnStart: monthDayToDay(9, 25),
    autumnPeak: monthDayToDay(10, 20),
    strawStart: monthDayToDay(10, 12),
    strawFull: monthDayToDay(11, 20),
    // Winter weathering thins and scruffs the standing plant but does not
    // remove it; only the cutback does that.
    weatheringFull: monthDayToDay(2, 25),
  }),
  note: 'The late-July to September display, greenish-white to pinkish then grey-brown head sequence, compact fountain habit and early-spring cut are source observations. Emergence, tillering, culm-extension, fine colour-transition dates and the +/-10-day season profiles are renderer assumptions for central Poland.',
});

function createCalendar(seasonProfile = 'typical', offsetDays = 0) {
  if (!Object.hasOwn(HAMELN_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 30) {
    throw new RangeError('offsetDays must be a finite number from -30 to 30');
  }

  const profile = HAMELN_SEASON_PROFILES[seasonProfile];
  const totalOffset = profile.dayOffset + Math.round(offsetDays);
  const shift = (day) => Math.max(1, Math.min(365, day + totalOffset));
  return Object.freeze(
    Object.fromEntries(
      Object.entries(HAMELN_PHASE_ASSUMPTIONS.baseline).map(([key, day]) => [
        key,
        shift(day),
      ]),
    ),
  );
}

export function getHamelnCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  return createCalendar(seasonProfile, offsetDays);
}

export const HAMELN_CALENDAR = createCalendar();

export const HAMELN_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    'late-July to September bottlebrush display, greenish-white opening through pinkish to grey-brown, and an early-spring cut',
  seasonProfiles: HAMELN_SEASON_PROFILES,
  assumptions: HAMELN_PHASE_ASSUMPTIONS,
  sources: Object.freeze([
    HAMELN_SOURCES.rhsCultivar.url,
    HAMELN_SOURCES.polishNurseryAssociation.url,
    HAMELN_SOURCES.ifasCultivar.url,
    HAMELN_SOURCES.missouriExtension.url,
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
      "Last season's dry fountain standing above the crown",
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
    return [
      'heading',
      'Greenish-cream brushes pushing clear of the foliage',
      '55',
    ];
  }
  if (day < calendar.headMaturingStart) {
    return [
      'flowering',
      'Cream bottlebrush heads opening above the dome',
      '65',
    ];
  }
  if (day < calendar.strawStart) {
    return [
      'maturing',
      'Heads warming through pink-beige as the foliage stays green',
      '75',
    ];
  }
  if (day < calendar.strawFull) {
    return [
      'senescence',
      'Foliage fading through yellow-orange to straw',
      '93',
    ];
  }
  return [
    'standing-dry',
    'Weathered brushes over a buff winter fountain',
    '97',
  ];
}

function plumeColourStage(day, calendar) {
  if (day < calendar.panicleEmergenceStart) return 'absent';
  if (day < calendar.plumeOpenStart) return 'greenish-cream';
  if (day < calendar.headMaturingStart) return 'pinkish-cream';
  if (day < calendar.headMature) return 'warm-beige';
  if (day < calendar.strawFull) return 'grey-brown';
  return 'weathered-straw';
}

/**
 * Returns a continuous Hameln state for one leap-neutral calendar day.
 *
 * Because the plant is rebuilt from the crown every year, the interesting
 * quantity is not "how much older is the framework" but "how far through this
 * year's build-and-collapse cycle are we". `standingDryVisibility` describes
 * last year's culms and `emergenceProgress` this year's, and the two only
 * overlap when the plant is not cut.
 */
export function getHamelnPhenology(
  value = 250,
  { seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = createCalendar(seasonProfile, offsetDays);

  // The clump loses last year's culms across the cutback window.
  const cutProgress = progress(day, calendar.cutbackStart, calendar.cutbackEnd);
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
  const standingDryVisibility = 1 - cutProgress;
  // Fresh stubble is bare and obvious, then hidden as the canopy closes.
  const stubbleVisibility =
    cutProgress *
    (1 - progress(day, calendar.emergenceStart, calendar.tilleringStart));
  const cut = day >= calendar.cutbackEnd;
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
  // Bristles lengthen after the closed spike clears the flag-leaf sheath.
  const headExpansionProgress = progress(
    day,
    calendar.panicleEmergenceStart + 4,
    calendar.plumeFullFluff,
  );
  const plumeFluffProgress = progress(
    day,
    calendar.plumeOpenStart,
    calendar.plumeFullFluff,
  );
  const headMaturityProgress = progress(
    day,
    calendar.headMaturingStart,
    calendar.headMature,
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
    seasonProfileLabel: HAMELN_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
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
    headExpansionProgress,
    plumeFluffProgress,
    plumeVisibility,
    headMaturityProgress,
    plumeColourStage: plumeColourStage(day, calendar),
    flowersOnCurrentSeasonCulms: true,
    foliageIsDeciduousButPersistent: true,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

/** Returns Hameln care guidance relevant to the selected day and age. */
export function getHamelnCareHints(
  value = 250,
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
        'spring-cutback',
        'pruning',
        'important',
        'Cut last year’s fountain to about 8 cm',
        `The annual cut falls now, from ${calendarLabel(calendar.cutbackStart)}: take the dry clump down to roughly 8 cm before or just as new blades appear. Cutting later slices the emerging shoots and leaves blunt tips all summer.`,
        HAMELN_SOURCES.polishNurseryAssociation.url,
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
        `Hameln is a warm-season grass, so a bare crown in early spring is normal rather than a loss. The modeled first blades appear about ${calendarLabel(calendar.emergenceStart)}.`,
        HAMELN_SOURCES.ifasCultivar.url,
      ),
    );
  }

  if (
    day >= calendar.panicleEmergenceStart &&
    day <= calendar.headMature &&
    plantAgeYears >= HAMELN_PROFILE.growth.firstFloweringAgeYears
  ) {
    hints.push(
      hint(
        'observe-plume-sequence',
        'phenology',
        'notice',
        'Track the cream-to-grey-brown change',
        `The modeled display opens about ${calendarLabel(calendar.panicleEmergenceStart)} — early for the species — with greenish-cream brushes that flush faint pink and mature warm beige to grey-brown. Real timing moves with site and weather.`,
        HAMELN_SOURCES.polishNurseryAssociation.url,
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
        'The dry blades and remaining brushes make the winter fountain and shelter the crown. Tidying waits until the early-spring cut.',
        HAMELN_SOURCES.polishNurseryAssociation.url,
      ),
    );
  }

  if (
    plantAgeYears < HAMELN_PROFILE.growth.firstFloweringAgeYears &&
    day >= calendar.panicleEmergenceStart
  ) {
    hints.push(
      hint(
        'first-season-vegetative',
        'phenology',
        'notice',
        'A first-year clump usually stays vegetative',
        'Expect foliage only in the planting year. The RHS puts full height two to five years out, and the plumes arrive with it.',
        HAMELN_SOURCES.rhsCultivar.url,
      ),
    );
  }

  return Object.freeze(hints);
}

export { dayOfYear };
