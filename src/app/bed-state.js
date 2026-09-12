/**
 * What the bed's two sliders mean, as numbers.
 *
 * Dependency-free on purpose, like `bed-layout.js` and
 * `field-terrain-height.js`. It lives apart from `bed-plants.js` because that
 * module reaches `plants.js`, which imports Vite-resolved asset paths and so
 * cannot be loaded by `node --test` -- and these clamps are exactly the part
 * worth testing.
 */

/**
 * The hue this page's lawn palette is drawn around, in degrees.
 *
 * `LAWN_TARGET_HUE` is not a property of the palette. It is the palette that
 * lands the *rendered image* at the 99 a healthy lawn photographs at, which
 * makes it a property of the lights the lawn stands under -- its own comment
 * lists the sun's colour among the things that move it. Two pages with
 * different lights therefore need two numbers, and this one read the field's
 * by omission.
 *
 * That was harmless while both pages had authored warm suns a degree apart.
 * It stopped being harmless when `/field` began taking its lights from its
 * atmosphere: the field's target fell 12.4 degrees to match, and this bed --
 * still lit by `#fff2d6` and a near-neutral hemisphere -- followed it down
 * from a measured 94.5 to 84.6, a yellow-olive lawn under the 60-120 band
 * turfgrass research calls healthy.
 *
 * 104.4 is what this page rendered with before that, restored rather than
 * recalibrated. The bed has never been swept against the photographs the way
 * the field has, and 94.5 is where it actually sits; sweeping it changes how
 * this page looks and belongs with a decision rather than with a bug fix.
 *
 * It lives here, beside the other numbers this page owns, so that
 * `test/bed-state.test.js` can hold it apart from the field's.
 */
export const BED_LAWN_TARGET_HUE = 104.4;

/**
 * Marks on the day slider.
 *
 * Not a menu -- the slider is continuous. These are the dates worth stopping
 * at, offered as tick marks so a drag can find them:
 *
 *   30   dry hydrangea heads, standing grass, lavender mound
 *   120  hydrangea leaf-out, grass emerging, lavender in spring growth
 *   190  lavender at peak, hydrangea in green bud, grass a green fountain
 *   212  the one date all three are showing at once, and the default
 *   250  hydrangea turning pink, grass in full cream brush
 *   300  hydrangea dry, grass in autumn colour
 *
 * 230 reads well on paper and is the wrong default: it falls four days after
 * the lavender is sheared, so a third of the planting opens as stubble.
 */
export const BED_SEASON_MARKS = Object.freeze([
  Object.freeze({ day: 30, label: 'Zima' }),
  Object.freeze({ day: 120, label: 'Wiosna' }),
  Object.freeze({ day: 190, label: 'Lawenda' }),
  Object.freeze({ day: 212, label: 'Pełnia' }),
  Object.freeze({ day: 250, label: 'Róż' }),
  Object.freeze({ day: 300, label: 'Jesień' }),
]);

export const BED_DEFAULT_DAY = 212;
export const BED_DEFAULT_AGE = 5;
export const BED_MAX_AGE = 15;

/**
 * `Number(null)` is 0, not NaN, so a missing query parameter has to be
 * rejected before it is converted -- otherwise an absent `?age=` reads as year
 * zero, clamps to 1, and the page opens on seedlings.
 */
function missing(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

export function clampDay(value, fallback = BED_DEFAULT_DAY) {
  if (missing(value)) return fallback;
  const day = Math.round(Number(value));
  if (!Number.isFinite(day)) return fallback;
  return Math.min(365, Math.max(1, day));
}

export function clampAge(value, fallback = BED_DEFAULT_AGE) {
  if (missing(value)) return fallback;
  const age = Math.round(Number(value));
  if (!Number.isFinite(age)) return fallback;
  return Math.min(BED_MAX_AGE, Math.max(1, age));
}

/** The mark a day is sitting on, or the nearest one. */
export function nearestSeasonMark(day) {
  return BED_SEASON_MARKS.reduce((best, mark) =>
    Math.abs(mark.day - day) < Math.abs(best.day - day) ? mark : best,
  );
}

/** rok / lata / lat, including the 12-14 exception. */
export function yearsLabel(age) {
  if (age === 1) return 'rok';
  const last = age % 10;
  const teens = age % 100;
  return last >= 2 && last <= 4 && (teens < 12 || teens > 14) ? 'lata' : 'lat';
}
