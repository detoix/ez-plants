import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BED_DEFAULT_AGE,
  BED_DEFAULT_DAY,
  BED_MAX_AGE,
  BED_SEASON_MARKS,
  clampAge,
  clampDay,
  nearestSeasonMark,
  yearsLabel,
} from '../src/app/bed-state.js';

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
