import { dayOfYear, monthDayToDay } from '../../calendar.js';
import { SMARAGD_PROFILE, SMARAGD_SOURCES } from './smaragd.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const progress = (value, start, end) =>
  clamp01((value - start) / Math.max(1, end - start));
const smoothstep = (value) => value * value * (3 - 2 * value);

export const SMARAGD_SEASON_PROFILES = Object.freeze({
  typical: Object.freeze({ label: 'typical central-Poland season', shift: 0 }),
  early: Object.freeze({ label: 'early mild season', shift: -12 }),
  late: Object.freeze({ label: 'late cold season', shift: 12 }),
});

export const SMARAGD_PHASE_ASSUMPTIONS = Object.freeze({
  budSwellingStart: monthDayToDay(4, 12),
  shootExtensionStart: monthDayToDay(5, 1),
  shootExtensionEnd: monthDayToDay(7, 5),
  hardeningStart: monthDayToDay(8, 15),
  winterToneStart: monthDayToDay(11, 5),
  note: "'Smaragd' is evergreen and specifically selected not to bronze in winter. Daily shoot-extension dates and the very small seasonal colour shift are renderer assumptions; they animate observed spring growth without inventing leaf fall.",
});

function validateProfile(seasonProfile, offsetDays) {
  if (!Object.hasOwn(SMARAGD_SEASON_PROFILES, seasonProfile)) {
    throw new RangeError("seasonProfile must be 'typical', 'early' or 'late'");
  }
  if (!Number.isFinite(offsetDays) || Math.abs(offsetDays) > 45) {
    throw new RangeError('offsetDays must be a finite number from -45 to 45');
  }
}

export function getSmaragdCalendar({
  seasonProfile = 'typical',
  offsetDays = 0,
} = {}) {
  validateProfile(seasonProfile, offsetDays);
  const shift =
    SMARAGD_SEASON_PROFILES[seasonProfile].shift + Math.round(offsetDays);
  const move = (day) => Math.max(1, Math.min(365, day + shift));
  return Object.freeze({
    budSwellingStart: move(SMARAGD_PHASE_ASSUMPTIONS.budSwellingStart),
    shootExtensionStart: move(SMARAGD_PHASE_ASSUMPTIONS.shootExtensionStart),
    shootExtensionEnd: move(SMARAGD_PHASE_ASSUMPTIONS.shootExtensionEnd),
    hardeningStart: move(SMARAGD_PHASE_ASSUMPTIONS.hardeningStart),
    winterToneStart: move(SMARAGD_PHASE_ASSUMPTIONS.winterToneStart),
  });
}

export const SMARAGD_CALENDAR = getSmaragdCalendar();

export const SMARAGD_CALENDAR_PROVENANCE = Object.freeze({
  observationProfile:
    "evergreen 'Smaragd' retaining emerald colour through winter",
  assumptions: SMARAGD_PHASE_ASSUMPTIONS,
});

function seasonFor(day) {
  if (day >= 60 && day <= 151) return 'spring';
  if (day >= 152 && day <= 243) return 'summer';
  if (day >= 244 && day <= 334) return 'autumn';
  return 'winter';
}

function stageFor(day, calendar) {
  if (day < calendar.budSwellingStart) {
    return ['winter-evergreen', 'Evergreen winter crown', '00'];
  }
  if (day < calendar.shootExtensionStart) {
    return ['bud-swelling', 'Vegetative buds swelling', '03'];
  }
  if (day <= calendar.shootExtensionEnd) {
    const extension = progress(
      day,
      calendar.shootExtensionStart,
      calendar.shootExtensionEnd,
    );
    return [
      'spring-flush',
      extension < 0.45
        ? 'Fresh emerald tips extending'
        : 'Spring sprays filling',
      extension < 0.45 ? '11' : '15',
    ];
  }
  if (day < calendar.hardeningStart) {
    return ['summer-canopy', 'Dense green summer crown', '19'];
  }
  if (day < calendar.winterToneStart) {
    return ['hardening', 'New sprays hardening', '91'];
  }
  return ['winter-evergreen', 'Evergreen winter crown', '00'];
}

export function getSmaragdPhenology(
  value = 180,
  { seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const calendar = getSmaragdCalendar({ seasonProfile, offsetDays });
  const [phase, label, bbch] = stageFor(day, calendar);
  const shootGrowthProgress = smoothstep(
    progress(day, calendar.shootExtensionStart, calendar.shootExtensionEnd),
  );
  const freshTipProgress =
    day >= calendar.shootExtensionStart && day <= calendar.hardeningStart
      ? Math.min(
          progress(
            day,
            calendar.shootExtensionStart,
            calendar.shootExtensionStart + 20,
          ),
          1 -
            progress(day, calendar.shootExtensionEnd, calendar.hardeningStart),
        )
      : 0;
  // Smaragd's defining winter behaviour is colour retention. This is only a
  // small cooling/darkening term, never the bronze phase of the wild species.
  const winterTone =
    day >= calendar.winterToneStart || day < calendar.budSwellingStart ? 1 : 0;

  return Object.freeze({
    dayOfYear: day,
    season: seasonFor(day),
    phase,
    stage: label,
    label,
    bbch,
    bbchCode: bbch,
    seasonProfile,
    seasonProfileLabel: SMARAGD_SEASON_PROFILES[seasonProfile].label,
    offsetDays: Math.round(offsetDays),
    calendar,
    foliageVisibility: 1,
    shootGrowthProgress,
    shootExtensionActive:
      day >= calendar.shootExtensionStart && day <= calendar.shootExtensionEnd,
    freshTipProgress,
    tipHardeningProgress:
      day < calendar.shootExtensionEnd
        ? 0
        : progress(day, calendar.shootExtensionEnd, calendar.hardeningStart),
    winterTone,
    evergreen: true,
    winterBronzing: false,
  });
}

const hint = (id, category, priority, title, message, source) =>
  Object.freeze({ id, category, priority, title, message, source });

export function getSmaragdCareHints(
  value = 180,
  { plantAgeYears = 0, seasonProfile = 'typical', offsetDays = 0 } = {},
) {
  const day = dayOfYear(value);
  const phenology = getSmaragdPhenology(day, { seasonProfile, offsetDays });
  if (!Number.isFinite(plantAgeYears) || plantAgeYears < 0) {
    throw new RangeError('plantAgeYears must be a non-negative finite number');
  }
  const hints = [];
  if (plantAgeYears < 1 && (day <= 105 || day >= 260)) {
    hints.push(
      hint(
        'plant-cool-season',
        'planting',
        'recommended',
        'Plant in cool, moist weather',
        "Set the root ball into moist but well-drained soil and water through establishment; leave room for the cultivar's narrow mature cone.",
        SMARAGD_SOURCES.rhsCultivar.url,
      ),
    );
  }
  if (phenology.phase === 'spring-flush') {
    hints.push(
      hint(
        'protect-spring-flush',
        'phenology',
        'notice',
        'Fresh sprays are extending',
        "The light emerald tips are this season's extension. Clip only lightly if shaping; the maintained model keeps a foliage-covered base.",
        SMARAGD_SOURCES.americanConiferSociety.url,
      ),
    );
  }
  return Object.freeze(hints);
}
