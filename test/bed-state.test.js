import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BED_DEFAULT_AGE,
  BED_DEFAULT_DAY,
  BED_LAWN_TARGET_HUE,
  BED_MAX_AGE,
  BED_SEASON_MARKS,
  clampAge,
  clampDay,
  nearestSeasonMark,
  yearsLabel,
} from '../src/app/bed-state.js';
import {
  LAWN_TARGET_HUE,
  lawnColorsFor,
} from '../src/app/grass-webgpu/preset.js';

test('an absent slider value falls back, it does not read as zero', () => {
  // Number(null) is 0, not NaN. Clamping that gives year one, so the page
  // would open on seedlings rather than on the default planting.
  assert.equal(clampAge(null), BED_DEFAULT_AGE);
  assert.equal(clampDay(null), BED_DEFAULT_DAY);
  assert.equal(clampAge(undefined), BED_DEFAULT_AGE);
  assert.equal(clampDay(''), BED_DEFAULT_DAY);
  assert.equal(clampAge('   '), BED_DEFAULT_AGE);
});

test('garbage falls back too', () => {
  assert.equal(clampAge('abc'), BED_DEFAULT_AGE);
  assert.equal(clampDay('abc'), BED_DEFAULT_DAY);
});

test('real values are read and clamped to range', () => {
  assert.equal(clampAge('9'), 9);
  assert.equal(clampDay('190'), 190);
  assert.equal(clampAge('0'), 1);
  assert.equal(clampDay('0'), 1);
  assert.equal(clampAge('99'), BED_MAX_AGE);
  assert.equal(clampDay('900'), 365);
  assert.equal(clampAge('4.6'), 5);
});

test('the day slider covers the whole year', () => {
  assert.equal(clampDay(1), 1);
  assert.equal(clampDay(365), 365);
});

test('every season mark is a day the slider can reach', () => {
  for (const mark of BED_SEASON_MARKS) {
    assert.equal(clampDay(mark.day), mark.day);
    assert.ok(mark.label.length > 0);
  }
});

test('the default day is a mark, and is not the sheared-lavender date', () => {
  assert.ok(BED_SEASON_MARKS.some((mark) => mark.day === BED_DEFAULT_DAY));
  assert.notEqual(BED_DEFAULT_DAY, 230);
});

test('a day snaps to the mark it is nearest', () => {
  assert.equal(nearestSeasonMark(191).day, 190);
  assert.equal(nearestSeasonMark(212).day, 212);
  assert.equal(nearestSeasonMark(1).day, 30);
  assert.equal(nearestSeasonMark(365).day, 300);
});

test('years are pluralised the way Polish does it', () => {
  assert.equal(yearsLabel(1), 'rok');
  assert.equal(yearsLabel(2), 'lata');
  assert.equal(yearsLabel(4), 'lata');
  assert.equal(yearsLabel(5), 'lat');
  assert.equal(yearsLabel(12), 'lat');
  assert.equal(yearsLabel(13), 'lat');
  assert.equal(yearsLabel(14), 'lat');
  assert.equal(yearsLabel(15), 'lat');
});

test("the bed owns its lawn hue rather than reading the field's", () => {
  // The two are independent on purpose and must stay that way: the target is
  // the palette that lands the rendered image at 99, so it belongs to the
  // lights, and these two pages no longer share lights. `/field` takes its sun
  // and its ambient from its atmosphere; this one is still authored. Deleting
  // this constant and letting the bed fall back to `LAWN_COLORS` is the exact
  // regression it exists to prevent -- it cost the bed 9.9 degrees of hue once
  // already, silently, in a commit that never mentioned the bed.
  assert.ok(
    Number.isFinite(BED_LAWN_TARGET_HUE),
    'the bed has no lawn hue of its own',
  );
  assert.notEqual(
    BED_LAWN_TARGET_HUE,
    LAWN_TARGET_HUE,
    'the bed and the field have the same lawn target again, which means one ' +
      "of them is being calibrated for the other page's lights",
  );
  assert.ok(
    BED_LAWN_TARGET_HUE >= 60 && BED_LAWN_TARGET_HUE <= 120,
    'the palette has left the range turfgrass research calls lawn',
  );

  // Rotating to it must still be a hue correction and not a repaint, the same
  // contract `test/field-webgpu-blade-bounds.test.js` holds the field's to.
  const authored = lawnColorsFor(86.7);
  const bed = lawnColorsFor(BED_LAWN_TARGET_HUE);
  for (const name of ['bottom', 'top', 'backlight', 'ground']) {
    assert.ok(typeof bed[name] === 'string' && bed[name] !== authored[name]);
  }
});
