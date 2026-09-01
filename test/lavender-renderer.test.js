import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Lavender } from '../src/lib/plants/lavender/lavender.js';
import { HIDCOTE_CALENDAR } from '../src/lib/plants/lavender/phenology.js';
import {
  HIDCOTE_PROFILE,
  HIDCOTE_RENDER_PRIORS,
} from '../src/lib/plants/lavender/hidcote.js';
import { isSharedResource } from '../src/lib/shared-resources.js';

/**
 * Two organ kinds, not three. The flower stems are wood: a peduncle is a
 * stiff round stem and it goes in the same merged mesh as the frame it grows
 * from, which is what leaves band 0 its third draw for the spikes. See
 * library rule 9.
 */
const MESH_NAMES = Object.freeze({
  wood: 'Lavender_Wood',
  leaves: 'Lavender_Leaves_Decussate',
  spikes: 'Lavender_Spikes',
});

const makePlant = (options = {}) =>
  new Lavender({ seed: 8181, maxYears: 20, ...options });

function meshNamed(plant, name) {
  let found = null;
  plant.traverse((object) => {
    if (object.isMesh && object.name === name) found = object;
  });
  assert.ok(found, `missing scene mesh ${name}`);
  return found;
}

test('the plant declares exactly wood, foliage and one feature organ', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 193 });
  try {
    assert.deepEqual([...plant._organKinds], ['leaves', 'spikes']);
    for (const name of Object.values(MESH_NAMES)) meshNamed(plant, name);
    assert.equal(plant.stats().drawCalls, 3);
  } finally {
    plant.dispose();
  }
});

test('the spike mesh is live only while the plant is in flower', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 1 });
  try {
    const spikes = meshNamed(plant, MESH_NAMES.spikes);
    assert.equal(spikes.count, 0);
    plant.setTime({ dayOfYear: HIDCOTE_CALENDAR.floweringPeak });
    assert.ok(spikes.count > 40);
    // Sheared: every spike goes on the same day, and the draw goes with them.
    plant.setTime({ dayOfYear: HIDCOTE_CALENDAR.trimDay });
    assert.equal(spikes.count, 0);
    assert.equal(plant.stats().drawCalls, 2);
  } finally {
    plant.dispose();
  }
});

test('foliage is never empty, on any day of any year', () => {
  const plant = makePlant({ ageYears: 4, dayOfYear: 1 });
  try {
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    for (let day = 1; day <= 365; day += 5) {
      plant.setTime({ dayOfYear: day });
      assert.ok(leaves.count > 0, `day ${day} renders a bare lavender`);
    }
  } finally {
    plant.dispose();
  }
});

test('coarse bands carry the display on the leaf card rather than dropping it', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 193 });
  try {
    const spikes = meshNamed(plant, MESH_NAMES.spikes);
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    const band0 = { spikes: spikes.count, leaves: leaves.count };
    assert.ok(band0.spikes > 0);
    assert.equal(plant.stats().spikesDrawnAsCards, false);

    for (const level of [1, 2]) {
      plant.setLevel(level);
      const stats = plant.stats();
      // The spike mesh is gone and the plant is inside two draws...
      assert.equal(spikes.count, 0);
      assert.equal(stats.drawCalls, 2);
      // ...but the spikes themselves are not: they are still reported, and
      // they are still being written, as cards from the leaf pool.
      assert.equal(stats.spikesDrawnAsCards, true);
      assert.ok(stats.visibleSpikes > 0, `band ${level} lost its flowers`);
      assert.ok(
        leaves.count > stats.visibleSpikes * 2,
        `band ${level} leaf pool must carry the stems and spikes too`,
      );
    }

    plant.setLevel(0);
    assert.equal(spikes.count, band0.spikes);
    assert.equal(leaves.count, band0.leaves);
  } finally {
    plant.dispose();
  }
});

test('coarse bands stop meshing every stem but keep what grows on them', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 193 });
  try {
    const wood = meshNamed(plant, MESH_NAMES.wood);
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    const fine = wood.geometry.index.count;
    plant.setLevel(2);
    assert.ok(
      wood.geometry.index.count < fine * 0.3,
      'band 2 should mesh only the framework',
    );
    assert.ok(leaves.count > 0, 'the foliage the dropped shoots carried stays');
  } finally {
    plant.dispose();
  }
});

test('instance pools are bounded and never reallocate while scrubbing', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 193 });
  try {
    const capacities = {
      leaves: meshNamed(plant, MESH_NAMES.leaves).instanceMatrix.count,
      spikes: meshNamed(plant, MESH_NAMES.spikes).instanceMatrix.count,
    };
    assert.ok(
      capacities.spikes >= HIDCOTE_RENDER_PRIORS.instanceCapacities.spikes,
    );
    for (const age of [0, 2, 5, 9, 14, 19]) {
      for (const day of [1, 100, 166, 193, 215, 260, 330]) {
        for (const level of [0, 1, 2]) {
          plant.setLevel(level);
          plant.setState({ ageYears: age, dayOfYear: day });
          for (const [kind, capacity] of Object.entries(capacities)) {
            const mesh = meshNamed(plant, MESH_NAMES[kind]);
            assert.equal(mesh.instanceMatrix.count, capacity);
            assert.ok(
              mesh.count <= capacity,
              `${kind} at age ${age} day ${day} band ${level}: ${mesh.count}/${capacity}`,
            );
          }
        }
      }
    }
  } finally {
    plant.dispose();
  }
});

test('the stems are meshed as wood, not as a third organ pool', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 1 });
  try {
    const wood = meshNamed(plant, MESH_NAMES.wood);
    const winter = wood.geometry.index.count;
    plant.setTime({ dayOfYear: HIDCOTE_CALENDAR.floweringPeak });
    assert.ok(
      wood.geometry.index.count > winter,
      'a hundred flower stems have to show up in the woody mesh',
    );
    plant.setTime({ dayOfYear: HIDCOTE_CALENDAR.trimDay });
    assert.ok(
      wood.geometry.index.count < winter * 1.2,
      'the shear removes them',
    );
  } finally {
    plant.dispose();
  }
});

test('the shear is offered early and refused when it makes no sense', () => {
  const calendar = HIDCOTE_CALENDAR;
  const plant = makePlant({
    ageYears: 5,
    dayOfYear: calendar.floweringStart + 5,
  });
  try {
    assert.equal(plant.shear({ dayOfYear: 30 }).reason, 'before-flowering');
    assert.equal(
      plant.shear({ dayOfYear: calendar.trimDay + 1 }).reason,
      'already-sheared',
    );
    const applied = plant.shear({ dayOfYear: calendar.floweringStart + 5 });
    assert.equal(applied.applied, true);
    assert.equal(plant.stats().visibleSpikes, 0);
    assert.equal(
      plant.shear({ dayOfYear: calendar.floweringStart + 6 }).reason,
      'already-sheared',
    );
    // There is no renewal cut on this plant, and there must not be one.
    assert.equal(typeof plant.pruneOldestCane, 'undefined');
    assert.equal(HIDCOTE_PROFILE.cane.wholeCanePruning, false);
  } finally {
    plant.dispose();
  }
});

test('shared geometry is shared and per-plant materials are not', () => {
  const first = makePlant({ ageYears: 4, dayOfYear: 193 });
  const second = makePlant({ seed: 909, ageYears: 4, dayOfYear: 193 });
  try {
    for (const kind of ['leaves', 'spikes']) {
      const a = meshNamed(first, MESH_NAMES[kind]);
      const b = meshNamed(second, MESH_NAMES[kind]);
      assert.strictEqual(a.geometry, b.geometry, `${kind} geometry not shared`);
      assert.ok(isSharedResource(a.geometry));
    }
    // Foliage material is deliberately NOT shared: it is repainted as the day
    // changes, and two plants sharing one would drag each other through the
    // seasons.
    assert.notStrictEqual(
      meshNamed(first, MESH_NAMES.leaves).material,
      meshNamed(second, MESH_NAMES.leaves).material,
    );
    // Bark is: nothing recolours it after construction.
    assert.strictEqual(
      meshNamed(first, MESH_NAMES.wood).material,
      meshNamed(second, MESH_NAMES.wood).material,
    );
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('the foliage repaints through the season without ever going brown', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 190 });
  try {
    const material = meshNamed(plant, MESH_NAMES.leaves).material;
    const seen = [];
    for (const day of [15, 120, 190, 260, 330]) {
      plant.setTime({ dayOfYear: day });
      seen.push(material.color.clone());
    }
    // It moves...
    assert.ok(seen.some((colour) => !colour.equals(seen[0])));
    // ...but never toward an autumn colour: green stays the strongest channel
    // or ties with red, and nothing ever warms past neutral.
    for (const colour of seen) {
      assert.ok(
        colour.g >= colour.r - 1e-6 && colour.g >= colour.b,
        `${colour.getHexString()} is not a grey-green`,
      );
    }
  } finally {
    plant.dispose();
  }
});

test('serialize round-trips the plant that produced it', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 200, region: 'northeast' });
  try {
    const state = plant.serialize();
    assert.equal(state.type, 'Lavender');
    const restored = new Lavender(state);
    try {
      assert.equal(restored.stats().visibleSpikes, plant.stats().visibleSpikes);
      assert.equal(restored.stats().visibleLeaves, plant.stats().visibleLeaves);
      assert.deepEqual(restored.stats().dimensions, plant.stats().dimensions);
    } finally {
      restored.dispose();
    }
  } finally {
    plant.dispose();
  }
});

test('only the Hidcote profile is accepted, synonyms included', () => {
  for (const cultivar of ['Hidcote', ...HIDCOTE_PROFILE.synonyms]) {
    const plant = makePlant({ cultivar });
    assert.equal(plant.cultivar, 'Hidcote');
    plant.dispose();
  }
  assert.throws(() => makePlant({ cultivar: 'Munstead' }), RangeError);
});

test('dispose releases what the plant owns and nothing that it borrows', () => {
  const keeper = makePlant({ ageYears: 4, dayOfYear: 193 });
  const plant = makePlant({ seed: 55, ageYears: 4, dayOfYear: 193 });
  const shared = meshNamed(plant, MESH_NAMES.spikes).geometry;
  const material = meshNamed(plant, MESH_NAMES.leaves).material;
  let disposed = false;
  material.addEventListener('dispose', () => {
    disposed = true;
  });
  plant.dispose();
  assert.equal(disposed, true);
  assert.equal(plant.children.length, 0);
  // The neighbour still renders, because the cache owns the geometry.
  assert.strictEqual(meshNamed(keeper, MESH_NAMES.spikes).geometry, shared);
  assert.ok(shared.attributes.position.count > 0);
  keeper.dispose();
});

test('nothing in the renderer reads a camera', () => {
  const plant = makePlant({ ageYears: 4, dayOfYear: 193 });
  try {
    assert.throws(() => plant.setLevel(3), RangeError);
    assert.equal(plant.level, 0);
    plant.update(0.016, 1.2);
    assert.equal(plant.level, 0);
    assert.ok(plant.lodLevels.every((level) => 'distance' in level));
    assert.ok(plant.lodLevels[0].distance === 0);
    assert.ok(plant instanceof THREE.Group);
  } finally {
    plant.dispose();
  }
});
