import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHidcoteCalendar,
  getHidcoteCareHints,
  getHidcotePhenology,
  HIDCOTE_CALENDAR,
  HIDCOTE_CALENDAR_PROVENANCE,
  HIDCOTE_PHASE_ASSUMPTIONS,
  HIDCOTE_REGION_OBSERVATIONS,
} from '../src/lib/plants/lavender/phenology.js';
import {
  HIDCOTE_PROFILE,
  HIDCOTE_SOURCES,
} from '../src/lib/plants/lavender/hidcote.js';
import { monthDayToDay } from '../src/lib/calendar.js';

const CALENDAR = HIDCOTE_CALENDAR;

test('the calendar sits inside the cited Polish flowering window', () => {
  // The Polish atlas gives the species "(June) July to August (September)".
  // Two dated photographs of identified 'Hidcote' plants narrow it: full
  // anthesis in Vilnius on 8 July, and the same cultivar dark and drying but
  // still uncut at the Wojslawice arboretum on 30 July.
  assert.ok(CALENDAR.floweringStart >= monthDayToDay(6, 15));
  assert.ok(CALENDAR.floweringStart <= monthDayToDay(7, 5));
  assert.equal(getHidcotePhenology(monthDayToDay(7, 8)).phase, 'flowering');
  assert.equal(getHidcotePhenology(monthDayToDay(7, 30)).phase, 'dry-heads');
  // And the plant is still uncut on that date, which the photograph shows.
  assert.ok(monthDayToDay(7, 30) < CALENDAR.trimDay);
});

test('the shear lands in August, after flowering and before the frosts', () => {
  assert.ok(CALENDAR.trimDay > CALENDAR.floweringEnd);
  assert.ok(CALENDAR.trimDay >= monthDayToDay(8, 1));
  assert.ok(CALENDAR.trimDay <= monthDayToDay(8, 25));
  // RHS: any re-growth needs time to harden before the first frosts, so the
  // regrowth window has to close well inside the autumn.
  assert.ok(CALENDAR.regrowthEnd < CALENDAR.winterHardeningStart);
});

test('nothing on this plant is ever leafless', () => {
  // The one fact that separates it from the three shrubs beside it: it is
  // evergreen, so `leafiness` is a density and never reaches zero on any day
  // of the year, including the day of the shear.
  for (let day = 1; day <= 365; day += 1) {
    const { leafiness } = getHidcotePhenology(day);
    assert.ok(
      leafiness > 0.4 && leafiness <= 1,
      `day ${day} reports leafiness ${leafiness}`,
    );
  }
});

test('the shear removes every spike on one day rather than fading them out', () => {
  const before = getHidcotePhenology(CALENDAR.trimDay - 1);
  const after = getHidcotePhenology(CALENDAR.trimDay);
  assert.equal(before.spikeVisibility, 1);
  assert.equal(before.trimmed, false);
  assert.equal(after.spikeVisibility, 0);
  assert.equal(after.trimmed, true);
  assert.ok(after.leafiness < before.leafiness, 'the trim takes leaves too');
});

test('spikes are up from emergence and gone at the shear, and never otherwise', () => {
  for (let day = 1; day <= 365; day += 1) {
    const { spikeVisibility } = getHidcotePhenology(day);
    const inSeason =
      day >= CALENDAR.spikeEmergenceStart && day < CALENDAR.trimDay;
    assert.equal(spikeVisibility, inSeason ? 1 : 0, `day ${day}`);
  }
});

test('the display runs green, then violet, then dry, in that order', () => {
  const green = getHidcotePhenology(CALENDAR.spikeEmergenceStart + 2);
  const peak = getHidcotePhenology(CALENDAR.floweringPeak);
  const dry = getHidcotePhenology(CALENDAR.dryHeadEnd - 1);
  assert.ok(green.spikeMaturity < peak.spikeMaturity);
  assert.ok(peak.spikeMaturity < dry.spikeMaturity);
  assert.ok(peak.displayIntensity > green.displayIntensity);
  assert.ok(peak.displayIntensity > dry.displayIntensity);
});

test('the north-east lag is the one this library already observed', () => {
  const central = getHidcoteCalendar('central');
  const northeast = getHidcoteCalendar('northeast');
  const lag = northeast.floweringStart - central.floweringStart;
  assert.ok(lag >= 10 && lag <= 14, `north-east lag is ${lag} days`);
  assert.ok(HIDCOTE_REGION_OBSERVATIONS.central.observed);
  assert.ok(HIDCOTE_REGION_OBSERVATIONS.northeast.observed);
  // `early` and `late` are declared scenarios, not observed station means.
  assert.equal(HIDCOTE_REGION_OBSERVATIONS.early.observed, false);
  assert.equal(HIDCOTE_REGION_OBSERVATIONS.late.observed, false);
});

test('an offset places the calendar without changing its shape', () => {
  const base = getHidcoteCalendar('central');
  const shifted = getHidcoteCalendar('central', 9);
  assert.equal(shifted.floweringStart - base.floweringStart, 9);
  assert.equal(
    shifted.floweringEnd - shifted.floweringStart,
    base.floweringEnd - base.floweringStart,
  );
  assert.throws(() => getHidcoteCalendar('central', 60), RangeError);
  assert.throws(() => getHidcoteCalendar('gdansk'), RangeError);
});

test('observed values and assumptions are labelled separately', () => {
  assert.equal(
    HIDCOTE_CALENDAR_PROVENANCE.assumptions,
    HIDCOTE_PHASE_ASSUMPTIONS,
  );
  assert.match(HIDCOTE_PHASE_ASSUMPTIONS.note, /renderer assumptions/);
  for (const source of Object.values(HIDCOTE_SOURCES)) {
    assert.match(source.url, /^https?:\/\//);
    assert.ok(source.supports.length > 20);
  }
});

test('care guidance never offers a cut this plant cannot take', () => {
  const everyHint = [];
  for (let day = 1; day <= 365; day += 5) {
    for (const age of [0, 3, 9]) {
      everyHint.push(...getHidcoteCareHints(day, { plantAgeYears: age }));
    }
  }
  assert.ok(everyHint.length > 0);
  // Lavender does not break from old wood. Nothing in the guidance may
  // suggest renewal pruning, and the one cut it does get is the shear.
  const pruning = everyHint.filter((hint) => hint.category === 'pruning');
  assert.ok(pruning.length > 0);
  for (const hint of pruning) {
    assert.doesNotMatch(hint.message, /renew|hard prune|to the ground/i);
  }
  assert.ok(
    everyHint.some((hint) => hint.id === 'late-summer-trim'),
    'the annual shear must be offered',
  );
  assert.ok(
    everyHint.some((hint) => hint.id === 'plan-replacement'),
    'an ageing plant is replaced, not cut back',
  );
  assert.equal(HIDCOTE_PROFILE.management.cutsIntoOldWood, false);
});
