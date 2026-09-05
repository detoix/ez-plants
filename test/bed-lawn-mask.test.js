import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BED_BOULDERS,
  BED_RADIUS,
  bedKeepsLawnAt,
  bedOutline,
  createBedLayout,
  insideBed,
} from '../src/app/bed-layout.js';

/**
 * The compute shader's mask is written without trig, evaluating the polar
 * curve directly, while the layout decides what is in the bed against the
 * outline polygon. These tests hold the trig-free form to the polygon, because
 * a drift between them is a lawn growing through the mulch.
 */

test('the trig-free mask agrees with the polygon on a dense grid', () => {
  // A band of tolerance around the boundary: the polygon is a 240-segment
  // approximation of the same curve, so the two legitimately disagree by the
  // sagitta there and nowhere else.
  const tolerance = 0.02;
  let compared = 0;
  for (let x = -7; x <= 7; x += 0.05) {
    for (let z = -7; z <= 7; z += 0.05) {
      const keeps = bedKeepsLawnAt(x, z, 0);
      const inside = insideBed(x, z);
      if (keeps === !inside) {
        compared += 1;
        continue;
      }
      // Disagreement is only allowed within the tolerance band of the edge.
      const nearest = Math.min(
        ...bedOutline(240).map(([ox, oz]) => Math.hypot(x - ox, z - oz)),
      );
      assert.ok(
        nearest <= tolerance,
        `mask and polygon disagree at ${x.toFixed(2)}, ${z.toFixed(2)}, ` +
          `${nearest.toFixed(3)} m from the edge`,
      );
    }
  }
  assert.ok(compared > 10_000, 'the grid did not actually cover the bed');
});

test('the margin pushes the lawn further out, never in', () => {
  for (const [x, z] of bedOutline(120)) {
    const outward = Math.hypot(x, z) + 0.15;
    const scale = outward / Math.hypot(x, z);
    const px = x * scale;
    const pz = z * scale;
    assert.equal(bedKeepsLawnAt(px, pz, 0), true, 'bare curve should keep it');
    assert.equal(
      bedKeepsLawnAt(px, pz, 0.3),
      false,
      'a 0.3 m keep-out should still hold it back',
    );
  }
});

test('no blade stands where a plant or a boulder does', () => {
  const layout = createBedLayout({ groundAt: () => 0 });
  for (const entry of layout.species) {
    for (const placement of entry.placements) {
      const [x, , z] = placement.position;
      assert.equal(
        bedKeepsLawnAt(x, z, 0.3),
        false,
        `lawn survives under a ${entry.id} at ${x.toFixed(2)}, ${z.toFixed(2)}`,
      );
    }
  }
  for (const boulder of BED_BOULDERS) {
    assert.equal(bedKeepsLawnAt(boulder.x, boulder.z, 0.3), false);
  }
});

test('the lawn survives well clear of the bed', () => {
  for (const [x, z] of bedOutline(72)) {
    const distance = Math.hypot(x, z);
    const scale = (distance + 1.5) / distance;
    assert.equal(bedKeepsLawnAt(x * scale, z * scale, 0.3), true);
  }
  assert.equal(bedKeepsLawnAt(40, 40, 0.3), true);
  assert.equal(bedKeepsLawnAt(0, 0, 0.3), false, 'the centre is bed, not lawn');
});

test('the mask scales with the bed radius', () => {
  const point = [BED_RADIUS * 0.9, 0];
  assert.equal(bedKeepsLawnAt(point[0], point[1], 0, BED_RADIUS * 2), false);
});
