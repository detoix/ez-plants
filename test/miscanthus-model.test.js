import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMalepartusModel,
  evaluateMalepartusModel,
} from '../src/lib/plants/miscanthus/model.js';
import { MALEPARTUS_PROFILE } from '../src/lib/plants/miscanthus/malepartus.js';
import {
  getMalepartusCalendar,
  getMalepartusPhenology,
} from '../src/lib/plants/miscanthus/phenology.js';
import {
  BLADE_ARCH_VARIANTS,
  bladeTipOffset,
} from '../src/lib/plants/miscanthus/geometry.js';

const CALENDAR = getMalepartusCalendar();

function model(options = {}) {
  return createMalepartusModel({ seed: 4242, maxYears: 25, ...options });
}

function at(graph, options) {
  return evaluateMalepartusModel(graph, { ageYears: 8, ...options });
}

function culms(snapshot) {
  return snapshot.tillers.flatMap((tiller) =>
    tiller.culms.filter((culm) => culm.visible),
  );
}

function blades(snapshot) {
  return culms(snapshot)
    .flatMap((culm) => culm.nodes)
    .map((node) => node.blade)
    .filter((blade) => blade?.visible && blade.retained);
}

test('the graph is a bounded crown of tiller sites, built once', () => {
  const graph = model();
  assert.equal(graph.kind, 'miscanthus-malepartus-growth-model');
  assert.ok(graph.tillers.length > 0);
  assert.ok(
    graph.tillers.length <= MALEPARTUS_PROFILE.architecture.maximumTillerCount,
  );
  assert.ok(Object.isFrozen(graph));

  const ids = new Set(graph.tillers.map((tiller) => tiller.id));
  assert.equal(ids.size, graph.tillers.length, 'tiller ids must be unique');

  for (const tiller of graph.tillers) {
    // Every site is baked at its mature size and its own fixed place in the
    // crown; tillers do not migrate outward as the clump widens.
    assert.ok(tiller.points.length >= 2);
    assert.equal(tiller.points.length, tiller.radii.length);
    assert.ok(
      Math.hypot(tiller.position.x, tiller.position.z) <=
        MALEPARTUS_PROFILE.architecture.matureCrownRadiusM + 1e-9,
    );
    for (const node of tiller.nodes) {
      if (!node.blade) continue;
      assert.ok(BLADE_ARCH_VARIANTS.includes(node.blade.arch));
    }
  }
});

test('the same seed rebuilds an identical graph', () => {
  assert.deepEqual(model(), model());
});

test('nothing above the crown survives the year: no woody framework', () => {
  const graph = model();
  // Every culm the model can ever show is rebuilt from the same baked axis,
  // so there is no organ whose age exceeds one season.
  for (const tiller of graph.tillers) {
    assert.equal(typeof tiller.flowering, 'boolean');
    assert.ok(tiller.totalHeightM > 0);
  }
  const winter = at(graph, { dayOfYear: 20 });
  const summer = at(graph, { dayOfYear: 250 });
  const winterCohorts = new Set(culms(winter).map((culm) => culm.cohort));
  const summerCohorts = new Set(culms(summer).map((culm) => culm.cohort));
  assert.deepEqual([...winterCohorts], ['previous']);
  assert.deepEqual([...summerCohorts], ['current']);
});

test('the maintained spring cut leaves stubble, not a bare crown', () => {
  const graph = model();
  const before = at(graph, { dayOfYear: CALENDAR.cutbackStart - 5 });
  const after = at(graph, { dayOfYear: CALENDAR.cutbackEnd + 2 });

  assert.ok(before.stats.standingDeadCulms > 0);
  assert.equal(after.stats.standingDeadCulms, 0);
  assert.ok(after.stats.stubs > 0, 'the cut leaves visible stubble');
  assert.equal(after.stats.visibleBlades, 0);

  const stubHeight = after.dimensions.heightM;
  assert.ok(
    Math.abs(stubHeight - MALEPARTUS_PROFILE.management.cutbackHeightM) < 0.02,
    `stubble should stand at about the cited 10 cm, got ${stubHeight}`,
  );
});

test('the cut is staggered across the pruning window rather than instant', () => {
  const graph = model();
  const counts = [0.0, 0.35, 0.7, 1].map((fraction) => {
    const day = Math.round(
      CALENDAR.cutbackStart +
        fraction * (CALENDAR.cutbackEnd - CALENDAR.cutbackStart),
    );
    return at(graph, { dayOfYear: day }).stats.standingDeadCulms;
  });
  for (let index = 1; index < counts.length; index += 1) {
    assert.ok(
      counts[index] < counts[index - 1],
      `standing culms must fall through the window: ${counts}`,
    );
  }
  assert.equal(counts.at(-1), 0);
});

test('an uncut clump keeps last season among the new growth', () => {
  const graph = model();
  const day = 250;
  const maintained = at(graph, { dayOfYear: day, scenario: 'maintained' });
  const neglected = at(graph, { dayOfYear: day, scenario: 'neglected' });

  assert.equal(maintained.stats.standingDeadCulms, 0);
  assert.ok(neglected.stats.standingDeadCulms > 0);
  assert.ok(
    neglected.stats.livingCulms > neglected.stats.standingDeadCulms,
    'an uncut clump is a mixture, not a solid thatch of old culms',
  );
});

test('an undivided clump opens out in the centre with age', () => {
  const graph = model();
  const young = at(graph, {
    ageYears: 5,
    dayOfYear: 250,
    scenario: 'neglected',
  });
  const old = at(graph, {
    ageYears: 22,
    dayOfYear: 250,
    scenario: 'neglected',
  });
  const divided = at(graph, {
    ageYears: 22,
    dayOfYear: 250,
    scenario: 'maintained',
  });

  assert.equal(young.clump.dieOutRadiusM, 0);
  assert.ok(old.clump.dieOutRadiusM > 0);
  assert.equal(divided.clump.dieOutRadiusM, 0);
  assert.ok(
    old.stats.visibleTillers < divided.stats.visibleTillers,
    'the dead centre removes tillers a divided clump keeps',
  );

  const minimumRadius = Math.min(
    ...old.tillers.map((tiller) =>
      Math.hypot(tiller.position.x, tiller.position.z),
    ),
  );
  assert.ok(
    minimumRadius >= old.clump.dieOutRadiusM - 1e-9,
    'no tiller may survive inside the dead centre',
  );
});

test('a warm-season grass stays absent through a Polish April', () => {
  const graph = model();
  const april = getMalepartusPhenology(CALENDAR.emergenceStart - 6);
  assert.equal(april.emergenceProgress, 0);
  const snapshot = at(graph, { dayOfYear: CALENDAR.emergenceStart - 6 });
  assert.equal(snapshot.stats.livingCulms, 0);
  assert.equal(snapshot.stats.visibleBlades, 0);
});

test('the canopy rises before the panicles telescope clear of it', () => {
  const graph = model();
  const leafy = at(graph, { dayOfYear: CALENDAR.foliageFullExpansion });
  const headed = at(graph, { dayOfYear: CALENDAR.panicleFullyExposed + 5 });

  assert.equal(leafy.stats.visiblePanicles, 0);
  assert.ok(headed.stats.visiblePanicles > 0);
  assert.ok(
    headed.dimensions.heightM > leafy.dimensions.heightM + 0.2,
    'heading must add real height, not just colour',
  );
});

test('modelled size stays inside the cited RHS envelope', () => {
  const graph = model();
  const architecture = MALEPARTUS_PROFILE.architecture;
  const [minHeight, maxHeight] = architecture.rhsUltimateHeightRangeM;

  for (const ageYears of [3, 5, 8, 15, 25]) {
    const snapshot = at(graph, { ageYears, dayOfYear: 250 });
    const { heightM, spreadM } = snapshot.dimensions;
    assert.ok(
      heightM >= minHeight && heightM <= maxHeight,
      `height ${heightM} at age ${ageYears} must sit in ${minHeight}-${maxHeight} m`,
    );
    // Vigorous mature clumps run a little past the RHS spread; this bounds
    // how far, so a tuning change cannot quietly double the plant.
    assert.ok(spreadM > 1 && spreadM < 1.8, `spread ${spreadM}`);
  }
});

test('growth is monotone through the building half of the year', () => {
  const graph = model();
  let previous = -1;
  for (
    let day = CALENDAR.emergenceStart;
    day <= CALENDAR.panicleFullyExposed;
    day += 4
  ) {
    const height = at(graph, { dayOfYear: day }).dimensions.heightM;
    assert.ok(height >= previous - 1e-9, `height fell on day ${day}`);
    previous = height;
  }
});

test('scrubbing to a day and back restores the identical snapshot', () => {
  const graph = model();
  const first = at(graph, { dayOfYear: 250 });
  at(graph, { dayOfYear: 40 });
  at(graph, { ageYears: 2, dayOfYear: 120 });
  assert.deepEqual(at(graph, { dayOfYear: 250 }), first);
});

test('every blade stays attached to the node that carries it', () => {
  const graph = model();
  // The node position already carries the culm's growth scale and, on a dead
  // culm, its lean. Re-applying that transform to the blade would slide the
  // whole fan off a half-grown or leaning culm.
  for (const dayOfYear of [140, 170, 250, 340, 20]) {
    for (const scenario of ['maintained', 'neglected']) {
      const snapshot = at(graph, { dayOfYear, scenario });
      for (const culm of culms(snapshot)) {
        for (const node of culm.nodes) {
          if (!node.blade?.visible) continue;
          const gap = Math.hypot(
            node.blade.position.x - node.position.x,
            node.blade.position.y - node.position.y,
            node.blade.position.z - node.position.z,
          );
          assert.ok(gap < 1e-9, `blade ${node.blade.id} floated ${gap} m away`);
        }
      }
    }
  }
});

test('blade reach is predicted from the geometry that is actually drawn', () => {
  const graph = model();
  for (const blade of blades(at(graph, { dayOfYear: 250 })).slice(0, 40)) {
    const offset = bladeTipOffset(blade.arch);
    // Unit-speed integration: the tip lands one blade length along its arc.
    assert.ok(
      Math.abs(Math.hypot(offset.along, offset.across)) <= 1.0001,
      'a blade tip cannot be further than its own arc length',
    );
    assert.ok(offset.across > 0, 'every baked variant arches outward');
  }
});

test('the model rejects states it cannot honestly render', () => {
  const graph = model();
  assert.throws(() => evaluateMalepartusModel({}, {}), TypeError);
  assert.throws(
    () => at(graph, { ageYears: 99 }),
    /ageYears must be an integer/,
  );
  assert.throws(() => at(graph, { scenario: 'wild' }), /scenario must be/);
  assert.throws(
    () => at(graph, { events: [{ type: 'prune' }] }),
    /does not expose destructive care events/,
  );
  assert.throws(
    () => createMalepartusModel({ maxYears: 0 }),
    /maxYears must be an integer/,
  );
});
