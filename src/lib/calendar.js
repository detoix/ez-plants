/**
 * The library's shared civil calendar.
 *
 * Every plant is a function of an age and a day of year (library rule 1), so
 * every plant needs the same small set of date conversions. They live here
 * rather than in any one plant's folder: a plant that imported them from a
 * neighbour would drag that neighbour's cultivar profile into the bundle, and
 * rule 7 forbids one plant reaching into another.
 *
 * This module is deliberately dependency-free — no Three.js, no RNG — so the
 * phenology layer that imports it stays plain data and can be tested without a
 * renderer.
 */

/** Day-of-year immediately before the 1st of each month, 1-indexed. */
export const MONTH_START = Object.freeze([
  0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
]);

/** Days in each month, 1-indexed. February is the common-year 28. */
export const DAYS_IN_MONTH = Object.freeze([
  0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
]);

/** Month names, 1-indexed, for human-readable calendar labels. */
export const MONTH_NAMES = Object.freeze([
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

/** Converts a 1-indexed month and day to a day-of-year in 1-365. */
export const monthDayToDay = (month, day) => MONTH_START[month] + day;

/** Formats a day-of-year as a `12 August`-style label. */
export function calendarLabel(dayOfYearValue) {
  for (let month = 12; month >= 1; month -= 1) {
    if (dayOfYearValue > MONTH_START[month]) {
      return `${dayOfYearValue - MONTH_START[month]} ${MONTH_NAMES[month]}`;
    }
  }
  return '1 January';
}

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Converts a local-civil Date, ISO date, MM-DD string or day number to a
 * leap-neutral 1-365 calendar. Date inputs use local month/day fields so a
 * Warsaw midnight does not shift to the preceding UTC date. Leap-day inputs
 * map to day 60 (the same simulation day as 1 March), keeping every simulated
 * year at 365 days.
 */
export function dayOfYear(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.floor(value);
    if (day < 1 || day > 365) {
      throw new RangeError('Day number must be between 1 and 365');
    }
    return day;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return monthDayToDay(value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'string') {
    const match = value.match(/^(?:(\d{4})-)?(\d{2})-(\d{2})$/);
    if (match) {
      const year = match[1] == null ? null : Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const leapDay = month === 2 && day === 29;
      if (
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        (day <= DAYS_IN_MONTH[month] ||
          (leapDay && (year == null || isLeapYear(year))))
      ) {
        return monthDayToDay(month, day);
      }
    }
  }

  throw new TypeError('Expected a day number, Date, YYYY-MM-DD or MM-DD value');
}
