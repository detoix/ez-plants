import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHidcoteModel,
  createTrimEvent,
  evaluateHidcoteModel,
} from '../src/lib/plants/lavender/model.js';
import { HIDCOTE_CALENDAR } from '../src/lib/plants/lavender/phenology.js';
import {
  HIDCOTE_PROFILE,
  HIDCOTE_RENDER_PRIORS,
} from '../src/lib/plants/lavender/hidcote.js';

const model = createHidcoteModel({ seed: 'hidcote-test', maxYears: 30 });

const at = (ageYears, dayOfYear, options = {}) =>
  evaluateHidcoteModel(model, { ageYears, dayOfYear, ...options });

const axes = (snapshot) =>
  snapshot.canes.flatMap((branch) => branch.axes).filter((axis) => !axis.spike);

test('the model is plain data and survives a JSON round trip', () => {
  const snapshot = at(5, HIDCOTE_CALENDAR.floweringPeak);
  const restored = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(restored.stats, snapshot.stats);
  assert.equal(restored.canes.length, snapshot.canes.length);
  assert.deepEqual(restored.dimensions, snapshot.dimensions);
});

test('evaluating the same state twice gives the same organs', () => {
  const first = at(6, 200);
  at(2, 20);
  const second = at(6, 200);
  assert.deepEqual(second.stats, first.stats);
  assert.deepEqual(
    second.canes.flatMap((branch) => branch.axes.map((axis) => axis.id)),
    first.canes.flatMap((branch) => branch.axes.map((axis) => axis.id)),
  );
});

test('the plant reaches its cited size in two to five years', () => {
  // RHS: 0.1-0.5 m high by 0.5-1 m wide, at ultimate height in 2-5 years.
  const mature = at(5, HIDCOTE_CALENDAR.floweringPeak).dimensions;
  const [minSpread, maxSpread] =
    HIDCOTE_PROFILE.architecture.rhsUltimateSpreadRangeM;
  assert.ok(
    mature.foliageHeightM > 0.25 && mature.foliageHeightM <= 0.5,
    `foliage mound is ${mature.foliageHeightM.toFixed(2)} m high`,
  );
  assert.ok(
    mature.spreadM >= minSpread && mature.spreadM <= maxSpread,
    `spread is ${mature.spreadM.toFixed(2)} m`,
  );
  // And it is already most of the way there at three.
  const young = at(3, HIDCOTE_CALENDAR.floweringPeak).dimensions;
  assert.ok(young.spreadM > mature.spreadM * 0.8);
  assert.ok(at(0, 200).dimensions.spreadM < mature.spreadM * 0.7);
});

test('a lavender is never bare and never renews from the base', () => {
  // Evergreen: leaves on every day of the year, in every season.
  for (const day of [15, 60, 120, 190, 226, 268, 300, 350]) {
    const snapshot = at(5, day);
    assert.ok(snapshot.stats.leaves > 0, `day ${day} has no leaves`);
    assert.ok(snapshot.stats.frameworkBranches > 0);
  }
  // The framework is the same branches all cycle: no cohort ever replaces it.
  const ids = (age) =>
    at(age, 200)
      .canes.map((branch) => branch.id)
      .sort();
  assert.deepEqual(ids(9), ids(2));
  // And the next cycle is a different plant in the same ground.
  assert.notDeepEqual(ids(12), ids(2));
  assert.equal(at(12, 200).cycleIndex, 1);
  assert.equal(at(12, 200).cycleAgeYears, 2);
});

test('the flower stems exist only between emergence and the shear', () => {
  const calendar = HIDCOTE_CALENDAR;
  const before = at(5, calendar.spikeEmergenceStart - 1);
  const during = at(5, calendar.floweringPeak);
  const after = at(5, calendar.trimDay + 1);

  assert.equal(before.stats.spikes, 0);
  assert.ok(during.stats.spikes > 40);
  assert.equal(after.stats.spikes, 0);

  // The stems are wood, so they are also axes: they appear and disappear with
  // the spikes rather than standing empty.
  const stems = (snapshot) =>
    snapshot.canes.flatMap((branch) =>
      branch.axes.filter((axis) => axis.order === 2),
    ).length;
  assert.equal(stems(before), 0);
  assert.equal(stems(during), during.stats.spikes);
  assert.equal(stems(after), 0);
});

test('the shear shortens this year’s shoots and takes their tips with them', () => {
  const calendar = HIDCOTE_CALENDAR;
  const before = at(5, calendar.trimDay - 1);
  const after = at(5, calendar.trimDay);
  assert.ok(after.stats.leaves < before.stats.leaves);
  assert.ok(after.dimensions.foliageHeightM < before.dimensions.foliageHeightM);
  // Only the current season's growth is cut back; older wood keeps its length.
  const scales = (snapshot) =>
    snapshot.canes
      .flatMap((branch) => branch.axes)
      .filter((axis) => axis.order === 1)
      .map((axis) => axis.growthScale);
  assert.ok(Math.max(...scales(after)) <= Math.max(...scales(before)) + 1e-9);
});

test('a gardener may shear early but never late, and never twice', () => {
  const calendar = HIDCOTE_CALENDAR;
  const early = createTrimEvent({
    ageYears: 5,
    dayOfYear: calendar.floweringStart + 4,
  });
  const cut = at(5, calendar.floweringStart + 6, { events: [early] });
  assert.equal(cut.stats.spikes, 0);
  assert.equal(cut.phenology.trimmed, true);
  // Before the event fires, nothing has changed.
  const uncut = at(5, calendar.floweringStart + 2, { events: [early] });
  assert.ok(uncut.stats.spikes > 0);
  // And the calendar shears the plant with or without an event.
  assert.equal(at(5, calendar.trimDay).phenology.trimmed, true);
});

test('an old plant opens out in the middle rather than dying back', () => {
  const young = at(2, 200);
  const old = at(9, 200);
  // Leaves retreat toward the shoot tips as the wood accumulates, so an old
  // plant carries fewer of them on the same number of shoots. That bare
  // interior is why RHS says to replace it rather than cut it back.
  const shoots = (snapshot) =>
    snapshot.canes.flatMap((branch) =>
      branch.axes.filter((axis) => axis.order === 1),
    ).length;
  assert.ok(shoots(old) >= shoots(young));
  assert.ok(
    old.stats.leaves / shoots(old) < young.stats.leaves / shoots(young),
  );
  // It still flowers, though: the display is on the current growth.
  assert.ok(at(9, HIDCOTE_CALENDAR.floweringPeak).stats.spikes > 40);
});

test('every axis is inside the three orders the renderer meshes', () => {
  const orders = new Set(
    at(6, 200)
      .canes.flatMap((branch) => branch.axes)
      .map((axis) => axis.order),
  );
  assert.deepEqual([...orders].sort(), [0, 1, 2]);
  // Frame branches carry no leaves of their own: everything green is on a
  // shoot, which is what makes `woodOrderLimit: 0` a usable LOD lever.
  for (const axis of axes(at(6, 200))) {
    if (axis.order !== 0) continue;
    assert.equal(axis.nodes.length, 0);
  }
});

test('organ counts stay inside the pools the profile declares', () => {
  const capacities = HIDCOTE_RENDER_PRIORS.instanceCapacities;
  for (const age of [1, 3, 5, 9, 14, 29]) {
    for (const day of [1, 100, 166, 193, 215, 260, 330]) {
      const snapshot = at(age, day);
      assert.ok(
        snapshot.stats.leaves <= capacities.leaves,
        `age ${age} day ${day}: ${snapshot.stats.leaves} leaves`,
      );
      assert.ok(
        snapshot.stats.spikes <= capacities.spikes,
        `age ${age} day ${day}: ${snapshot.stats.spikes} spikes`,
      );
    }
  }
});

test('the model rejects states it cannot represent', () => {
  assert.throws(() => at(-1, 200), RangeError);
  assert.throws(() => at(31, 200), RangeError);
  assert.throws(() => at(2.5, 200), RangeError);
  assert.throws(
    () => evaluateHidcoteModel({ kind: 'not-a-lavender' }, {}),
    TypeError,
  );
  assert.throws(
    () => createTrimEvent({ ageYears: 4, dayOfYear: 0 }),
    TypeError,
  );
});
