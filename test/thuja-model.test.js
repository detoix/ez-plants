import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSmaragdModel,
  evaluateSmaragdModel,
} from '../src/lib/plants/thuja/model.js';
import {
  getSmaragdCalendar,
  getSmaragdPhenology,
  SMARAGD_PHASE_ASSUMPTIONS,
} from '../src/lib/plants/thuja/phenology.js';
import {
  SMARAGD_PROFILE,
  SMARAGD_RENDER_PRIORS,
  SMARAGD_SOURCES,
} from '../src/lib/plants/thuja/smaragd.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function isFiniteVector(value) {
  return [value.x, value.y, value.z].every(Number.isFinite);
}

function axesById(snapshot) {
  return new Map(snapshot.canes[0].axes.map((axis) => [axis.id, axis]));
}

function sprays(snapshot) {
  return snapshot.canes[0].axes.flatMap((axis) =>
    axis.nodes.flatMap((node) => node.sprays ?? []),
  );
}

test('Smaragd is a source-backed narrow evergreen with flat sprays', () => {
  assert.equal(SMARAGD_PROFILE.species, 'Thuja occidentalis');
  assert.equal(SMARAGD_PROFILE.cultivar, 'Smaragd');
  assert.equal(SMARAGD_PROFILE.architecture.hasTrunk, true);
  assert.match(SMARAGD_PROFILE.architecture.habit, /narrow pyramidal/);
  assert.match(SMARAGD_PROFILE.foliage.type, /flattened fan-shaped sprays/);
  assert.equal(SMARAGD_PROFILE.foliage.evergreen, true);
  assert.equal(SMARAGD_PROFILE.foliage.winterBronzing, false);
  assert.ok(Object.keys(SMARAGD_SOURCES).length >= 4);
});

test('the all-years hierarchy and A-B-A snapshots are deterministic', () => {
  const first = createSmaragdModel({ seed: 'same', maxYears: 12 });
  const second = createSmaragdModel({ seed: 'same', maxYears: 12 });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.schemaVersion, 2);
  assert.ok(Object.isFrozen(first));

  const a = evaluateSmaragdModel(first, { ageYears: 7, dayOfYear: 160 });
  evaluateSmaragdModel(first, { ageYears: 2, dayOfYear: 20 });
  const again = evaluateSmaragdModel(first, {
    ageYears: 7,
    dayOfYear: 160,
  });
  assert.deepEqual(again, a);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test('leader, scaffold and branchlet cohorts form a real persistent topology', () => {
  const model = createSmaragdModel({ seed: 'topology', maxYears: 30 });
  assert.equal(model.scaffolds.length, SMARAGD_RENDER_PRIORS.maximumScaffolds);
  assert.equal(
    model.scaffolds.filter((scaffold) => scaffold.birthAgeYears <= 10).length,
    SMARAGD_RENDER_PRIORS.tenYearScaffolds,
  );

  const leaders = model.axes.filter((axis) =>
    axis.axisClass.startsWith('leader'),
  );
  const scaffoldSegments = model.axes.filter(
    (axis) => axis.axisClass === 'scaffold-segment',
  );
  const branchlets = model.axes.filter(
    (axis) => axis.axisClass === 'branchlet',
  );
  assert.equal(leaders.length, model.maxYears + 1);
  assert.ok(scaffoldSegments.length > model.scaffolds.length);
  assert.ok(branchlets.length > scaffoldSegments.length);

  const knownNodes = new Set();
  for (const axis of model.axes) {
    if (axis.parentId) assert.ok(knownNodes.has(axis.parentId), axis.parentId);
    for (const node of axis.nodes) knownNodes.add(node.id);
  }
  for (const scaffold of model.scaffolds) {
    assert.ok(scaffold.segmentIds.length >= 1);
    assert.ok(scaffold.branchletIds.length >= 1);
    if (scaffold.birthAgeYears <= 10) {
      assert.ok(
        scaffold.branchletIds.length >=
          SMARAGD_RENDER_PRIORS.initialBranchletsPerScaffold,
      );
    }
  }
});

test('the scaffold schedule fills the leader gradually and reaches its declared budgets', () => {
  const model = createSmaragdModel({ seed: 'schedule', maxYears: 30 });
  const birthsByYear = new Map();
  for (const scaffold of model.scaffolds) {
    birthsByYear.set(
      scaffold.birthAgeYears,
      (birthsByYear.get(scaffold.birthAgeYears) ?? 0) + 1,
    );
  }

  assert.equal(model.scaffolds.length, SMARAGD_RENDER_PRIORS.maximumScaffolds);
  assert.equal(
    model.scaffolds.filter((scaffold) => scaffold.birthAgeYears <= 10).length,
    SMARAGD_RENDER_PRIORS.tenYearScaffolds,
  );
  assert.deepEqual(
    model.scaffolds.map((scaffold) => scaffold.birthAgeYears),
    model.scaffolds
      .map((scaffold) => scaffold.birthAgeYears)
      .toSorted((a, b) => a - b),
  );

  const earlyCounts = Array.from(
    { length: 11 },
    (_, year) => birthsByYear.get(year) ?? 0,
  );
  const lateCounts = Array.from(
    { length: model.maxYears - 11 },
    (_, offset) => birthsByYear.get(offset + 12) ?? 0,
  );
  assert.ok(earlyCounts.every((count) => count > 0));
  assert.ok(Math.max(...earlyCounts) - Math.min(...earlyCounts) <= 1);
  assert.equal(
    earlyCounts.reduce((sum, count) => sum + count, 0),
    SMARAGD_RENDER_PRIORS.tenYearScaffolds,
  );
  assert.equal(birthsByYear.get(11) ?? 0, 0);
  assert.ok(lateCounts.every((count) => count > 0));
  assert.ok(Math.max(...lateCounts) - Math.min(...lateCounts) <= 1);
  assert.equal(
    lateCounts.reduce((sum, count) => sum + count, 0),
    SMARAGD_RENDER_PRIORS.maximumScaffolds -
      SMARAGD_RENDER_PRIORS.tenYearScaffolds,
  );
});

test('every branchlet tiles a finite, upward, radially fanned patch', () => {
  const model = createSmaragdModel({ seed: 'planes', maxYears: 30 });
  const branchlets = model.axes.filter(
    (axis) => axis.axisClass === 'branchlet',
  );
  for (const branchlet of branchlets) {
    const family = branchlet.nodes.flatMap((node) => node.sprays);
    assert.equal(family.length, SMARAGD_RENDER_PRIORS.spraysPerBranchlet);
    const terminals = family.filter((spray) => spray.terminal);
    assert.ok(terminals.length > 0);
    assert.ok(terminals.length < family.length);
    let widestNormalPair = 1;
    let widestDirectionPair = 1;
    let patchDiameter = 0;
    for (const spray of family) {
      assert.equal(spray.scaffoldIndex, branchlet.scaffoldIndex);
      assert.equal(spray.branchletId, branchlet.id);
      assert.ok(spray.exposure >= 0 && spray.exposure <= 1);
      assert.ok(isFiniteVector(spray.position));
      assert.ok(isFiniteVector(spray.direction));
      assert.ok(isFiniteVector(spray.normal));
      // Outer fans are deliberately diagonal: real Smaragd layers flattened
      // sprays across the shell instead of stacking vertical brushes.
      assert.ok(spray.direction.y > 0.5, spray.id);
      assert.ok(Math.abs(dot(spray.direction, spray.normal)) < 1e-10);
    }
    for (let first = 0; first < family.length; first += 1) {
      for (let second = first + 1; second < family.length; second += 1) {
        widestNormalPair = Math.min(
          widestNormalPair,
          dot(family[first].normal, family[second].normal),
        );
        widestDirectionPair = Math.min(
          widestDirectionPair,
          dot(family[first].direction, family[second].direction),
        );
        patchDiameter = Math.max(
          patchDiameter,
          Math.hypot(
            family[first].position.x - family[second].position.x,
            family[first].position.y - family[second].position.y,
            family[first].position.z - family[second].position.z,
          ),
        );
      }
    }
    assert.ok(widestNormalPair < Math.cos((70 * Math.PI) / 180));
    // Lower pads fan broadly; near the leader the authored directions converge
    // so the cultivar finishes in one narrow apex rather than several spires.
    assert.ok(widestDirectionPair < Math.cos((24 * Math.PI) / 180));
    assert.ok(patchDiameter > 0.04, branchlet.id);
  }

  // No camera azimuth should see the entire roster nearly edge-on.
  for (let viewIndex = 0; viewIndex < 16; viewIndex += 1) {
    const angle = (viewIndex / 16) * Math.PI * 2;
    const view = { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
    const facing = branchlets.flatMap((branchlet) =>
      branchlet.nodes.flatMap((node) =>
        node.sprays.map((spray) => Math.abs(dot(spray.normal, view))),
      ),
    );
    assert.ok(
      facing.reduce((sum, value) => sum + value, 0) / facing.length >= 0.35,
    );
  }
});

test('established coordinates do not rescale as later cohorts are added', () => {
  const model = createSmaragdModel({ seed: 'persistent', maxYears: 30 });
  const atFive = evaluateSmaragdModel(model, {
    ageYears: 5,
    dayOfYear: 200,
  });
  const atTwenty = evaluateSmaragdModel(model, {
    ageYears: 20,
    dayOfYear: 200,
  });
  const twentyAxes = axesById(atTwenty);
  for (const axis of atFive.canes[0].axes) {
    if (axis.axisClass === 'branchlet') continue;
    const later = twentyAxes.get(axis.id);
    assert.ok(later, axis.id);
    assert.deepEqual(later.points, axis.points, axis.id);
    assert.deepEqual(later.root, axis.root, axis.id);
  }

  const atEight = evaluateSmaragdModel(model, {
    ageYears: 8,
    dayOfYear: 200,
  });
  const eightAxes = axesById(atEight);
  for (const axis of atFive.canes[0].axes) {
    if (axis.axisClass !== 'branchlet') continue;
    const later = eightAxes.get(axis.id);
    assert.ok(later, axis.id);
    assert.deepEqual(later.points, axis.points, axis.id);
  }
});

test('spring growth extends only current cohorts and emphasizes terminal fans', () => {
  const model = createSmaragdModel({ seed: 'spring', maxYears: 15 });
  const scaffoldIndices = new Set(
    model.scaffolds.map((scaffold) => scaffold.scaffoldIndex),
  );
  const dormant = evaluateSmaragdModel(model, {
    ageYears: 10,
    dayOfYear: 110,
  });
  const extending = evaluateSmaragdModel(model, {
    ageYears: 10,
    dayOfYear: 145,
  });
  const dormantAxes = axesById(dormant);
  for (const axis of extending.canes[0].axes) {
    const before = dormantAxes.get(axis.id);
    assert.ok(before, axis.id);
    if (axis.birthAgeYears < 10) {
      assert.deepEqual(axis.points, before.points, axis.id);
      assert.equal(axis.growthScale, 1);
    } else {
      assert.ok(axis.growthScale > before.growthScale, axis.id);
    }
  }

  const fresh = sprays(extending).filter((spray) => spray.birthAgeYears === 10);
  const old = sprays(extending).filter((spray) => spray.birthAgeYears < 10);
  assert.ok(fresh.length > 0);
  assert.ok(
    fresh.some((spray) => spray.terminal && spray.freshGrowthProgress > 0),
  );
  assert.ok(
    fresh.every(
      (spray) =>
        scaffoldIndices.has(spray.scaffoldIndex) &&
        spray.extensionProgress > 0 &&
        spray.extensionProgress < 1,
    ),
  );
  assert.ok(old.every((spray) => spray.freshGrowthProgress === 0));

  const dormantCurrent = sprays(dormant).filter(
    (spray) => spray.birthAgeYears === 10,
  );
  assert.ok(dormantCurrent.length > 0);
  assert.ok(dormantCurrent.every((spray) => spray.visible === false));
  assert.ok(
    dormant.canes[0].axes
      .filter(
        (axis) => axis.axisClass === 'branchlet' && axis.birthAgeYears === 10,
      )
      .every(
        (axis) =>
          axis.sourceNodes.flatMap((node) => node.sprays).length ===
          SMARAGD_RENDER_PRIORS.spraysPerBranchlet,
      ),
  );
});

test('dimensions land on the ten- and thirty-year cultivar envelopes', () => {
  const model = createSmaragdModel({ seed: 'dimensions', maxYears: 30 });
  const ten = evaluateSmaragdModel(model, {
    ageYears: 10,
    dayOfYear: 200,
  });
  const thirty = evaluateSmaragdModel(model, {
    ageYears: 30,
    dayOfYear: 200,
  });
  assert.deepEqual(ten.dimensions, {
    heightM: 2,
    radiusM: 0.25,
    spreadM: 0.5,
  });
  assert.deepEqual(thirty.dimensions, {
    heightM: 4.2,
    radiusM: 0.7,
    spreadM: 1.4,
  });
  assert.equal(ten.stats.visibleBoughs, SMARAGD_RENDER_PRIORS.tenYearScaffolds);
  assert.equal(
    thirty.stats.visibleBoughs,
    SMARAGD_RENDER_PRIORS.maximumScaffolds,
  );
});

test('foliage renewal stays dense but bounded across the full horizon', () => {
  const model = createSmaragdModel({ seed: 'budget', maxYears: 30 });
  let observedMaximum = 0;
  for (let ageYears = 0; ageYears <= 30; ageYears += 1) {
    const snapshot = evaluateSmaragdModel(model, {
      ageYears,
      dayOfYear: 200,
    });
    observedMaximum = Math.max(observedMaximum, snapshot.stats.visibleSprays);
    assert.ok(
      snapshot.stats.visibleSprays <= SMARAGD_RENDER_PRIORS.instanceCapacity,
      `age ${ageYears}: ${snapshot.stats.visibleSprays}`,
    );
    assert.equal(
      snapshot.stats.visibleSprays,
      snapshot.stats.visibleBranchlets *
        SMARAGD_RENDER_PRIORS.spraysPerBranchlet,
    );
  }
  const mature = evaluateSmaragdModel(model, {
    ageYears: 30,
    dayOfYear: 200,
  });
  assert.equal(observedMaximum, model.maximumVisibleSprays);
  assert.ok(model.maximumVisibleSprays > 0);
  assert.ok(
    model.maximumVisibleSprays <= SMARAGD_RENDER_PRIORS.instanceCapacity,
  );
  assert.equal(
    model.maximumVisibleSprays % SMARAGD_RENDER_PRIORS.spraysPerBranchlet,
    0,
  );
  assert.ok(mature.stats.visibleSprays > 0);
  assert.ok(
    mature.stats.visibleSprays <= SMARAGD_RENDER_PRIORS.instanceCapacity,
  );
});

test('annual snapshots preserve dimensions, foliage identity and coverage continuity', () => {
  const model = createSmaragdModel({ seed: 'continuity', maxYears: 30 });
  const minimumAnnualRetention =
    1 - 2 / SMARAGD_RENDER_PRIORS.branchletRetentionYears;
  let previous = null;

  for (let ageYears = 0; ageYears <= model.maxYears; ageYears += 1) {
    const snapshot = evaluateSmaragdModel(model, {
      ageYears,
      dayOfYear: 200,
    });
    const visibleSprays = sprays(snapshot).filter((spray) => spray.visible);
    const visibleIds = new Set(visibleSprays.map((spray) => spray.id));
    const scheduledScaffolds = model.scaffolds.filter(
      (scaffold) => scaffold.birthAgeYears <= ageYears,
    ).length;

    assert.equal(visibleIds.size, snapshot.stats.visibleSprays);
    assert.equal(snapshot.stats.visibleBoughs, scheduledScaffolds);
    assert.ok(Number.isFinite(snapshot.coverageScale));
    assert.ok(snapshot.coverageScale > 0);
    assert.ok(
      visibleSprays.every(
        (spray) => spray.coverageScale === snapshot.coverageScale,
      ),
    );

    if (previous) {
      assert.ok(
        snapshot.dimensions.heightM > previous.snapshot.dimensions.heightM,
      );
      assert.ok(
        snapshot.dimensions.radiusM > previous.snapshot.dimensions.radiusM,
      );
      assert.ok(
        Math.abs(snapshot.coverageScale - previous.snapshot.coverageScale) <
          0.2,
      );
      let retained = 0;
      for (const id of previous.visibleIds) {
        if (visibleIds.has(id)) retained += 1;
      }
      assert.ok(
        retained / previous.visibleIds.size >= minimumAnnualRetention,
        `age ${ageYears}: retained ${retained}/${previous.visibleIds.size}`,
      );
    }

    previous = { snapshot, visibleIds };
  }
});

test('scaffolds rise irregularly and fill azimuth without repeated whorls', () => {
  const model = createSmaragdModel({ seed: 'coverage', maxYears: 30 });
  const attachmentHeights = model.scaffolds.map((scaffold) => scaffold.root.y);
  assert.equal(
    new Set(attachmentHeights.map((height) => height.toFixed(8))).size,
    model.scaffolds.length,
  );

  const bins = Array(8).fill(0);
  for (const scaffold of model.scaffolds) {
    const turn =
      ((scaffold.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    bins[Math.min(7, Math.floor((turn / (Math.PI * 2)) * 8))] += 1;
  }
  const averageBinPopulation = model.scaffolds.length / bins.length;
  assert.ok(Math.min(...bins) >= averageBinPopulation * 0.75, bins.join(','));
  assert.ok(Math.max(...bins) <= averageBinPopulation * 1.25, bins.join(','));

  for (const axis of model.axes.filter(
    (candidate) => candidate.axisClass === 'scaffold-segment',
  )) {
    assert.ok(axis.points.at(-1).y >= axis.points[0].y, axis.id);
  }
});

test('the crown stays evergreen and Smaragd never gains a bronze phase', () => {
  for (let day = 1; day <= 365; day += 7) {
    const phenology = getSmaragdPhenology(day);
    assert.equal(phenology.foliageVisibility, 1);
    assert.equal(phenology.evergreen, true);
    assert.equal(phenology.winterBronzing, false);
  }
  assert.equal(getSmaragdPhenology(140).phase, 'spring-flush');
  assert.ok(getSmaragdPhenology(140).freshTipProgress > 0);
  assert.equal(getSmaragdPhenology(140).shootExtensionActive, true);
  assert.ok(getSmaragdPhenology(200).tipHardeningProgress > 0);
});

test('season profiles shift the whole spring calendar together', () => {
  const early = getSmaragdCalendar({ seasonProfile: 'early' });
  const typical = getSmaragdCalendar({ seasonProfile: 'typical' });
  const late = getSmaragdCalendar({ seasonProfile: 'late' });
  for (const key of Object.keys(typical)) {
    assert.equal(typical[key] - early[key], 12);
    assert.equal(late[key] - typical[key], 12);
  }
  assert.match(SMARAGD_PHASE_ASSUMPTIONS.note, /assumptions/);
});

test('every child axis starts at a real evaluated parent attachment', () => {
  const snapshot = evaluateSmaragdModel(
    createSmaragdModel({ seed: 'attachments', maxYears: 12 }),
    { ageYears: 12, dayOfYear: 200 },
  );
  const knownNodes = new Map();
  for (const axis of snapshot.canes[0].axes) {
    if (axis.parentId) {
      assert.ok(knownNodes.has(axis.parentId), axis.parentId);
      assert.deepEqual(axis.root, knownNodes.get(axis.parentId));
      assert.deepEqual(axis.points[0], axis.root);
    }
    for (const node of axis.nodes) knownNodes.set(node.id, node.position);
  }
});

test('the pure model rejects unsupported history and invalid state', () => {
  const model = createSmaragdModel({ maxYears: 5 });
  assert.throws(
    () => evaluateSmaragdModel(model, { ageYears: 6 }),
    /between 0 and 5/,
  );
  assert.throws(
    () => evaluateSmaragdModel(model, { events: [{ type: 'prune' }] }),
    /no destructive care events/,
  );
  assert.throws(() => createSmaragdModel({ maxYears: 31 }), /from 1 to 30/);
});
