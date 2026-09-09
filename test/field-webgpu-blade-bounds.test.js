import assert from 'node:assert/strict';
import test from 'node:test';

import { LAWN } from '../src/app/grass-webgpu/preset.js';

/**
 * A blade's shape and its culling sphere are one contract.
 *
 * `grass.js` shapes each blade in the vertex stage -- it bends by its own
 * hashed amount, and widens when it would otherwise fall under a pixel on
 * screen -- and culls it in a compute pass against a sphere that learns
 * neither. Nothing connects the two but arithmetic, and getting it wrong does
 * not throw: a blade that leaves its sphere is culled while still on screen,
 * which reads as blades winking out at the frame edge on a hard turn. That is
 * a fault you need a moving camera and a wide view to notice at all, so it is
 * held here instead.
 *
 * These are both halves, written the way the shader writes them.
 */

/** Sphere centre, up the ground normal, as a fraction of blade height. */
const CULL_CENTRE = 0.5;
/** Sphere radius, before the width term, as the same fraction. */
const CULL_RADIUS = 0.58;

/** A blade's half-width at `along`, as a fraction of its base width. */
function bladeHalfWidth(along) {
  return (1 - along) ** LAWN.taper * 0.5;
}

/** The sphere the cull pass builds, in metres. It is centred on the crown. */
function cullRadius(height, width) {
  return (
    CULL_RADIUS * height +
    0.5 * LAWN.maxThicken * width +
    0.5 * LAWN.tillerSpread
  );
}

function range(from, to, steps) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) out.push(from + (to - from) * (i / steps));
  return out;
}

/**
 * A blade's centreline at `along` (0 root, 1 tip), as fractions of its height.
 * A constant-curvature arc to second order -- the same expansion the vertex
 * stage evaluates.
 */
function bladeArc(bend, along) {
  return {
    rise: along - (bend * bend * along ** 3) / 6,
    reach: (bend * along * along) / 2,
  };
}

function bendSamples() {
  return range(LAWN.minBend, LAWN.maxBend, 64);
}

test('every resting bend stays inside the culling sphere', () => {
  for (const bend of bendSamples()) {
    for (let i = 0; i <= 256; i += 1) {
      const along = i / 256;
      const { rise, reach } = bladeArc(bend, along);
      const distance = Math.hypot(reach, rise - CULL_CENTRE);
      assert.ok(
        distance <= CULL_RADIUS,
        `bend ${bend.toFixed(3)} at ${along.toFixed(3)} reaches ` +
          `${distance.toFixed(4)} of blade height from the sphere centre, ` +
          `past the ${CULL_RADIUS} the cull allows`,
      );
    }
  }
});

test('leaning bends a blade over rather than stretching it', () => {
  for (const bend of bendSamples()) {
    const upright = bladeArc(0, 1);
    const leaning = bladeArc(bend, 1);
    assert.ok(
      leaning.rise <= upright.rise,
      `bend ${bend.toFixed(3)} raised the tip to ${leaning.rise.toFixed(4)}`,
    );
    assert.ok(
      Math.hypot(leaning.reach, leaning.rise) <= 1,
      `bend ${bend.toFixed(3)} put the tip ` +
        `${Math.hypot(leaning.reach, leaning.rise).toFixed(4)} of a blade ` +
        `height from the root, so the blade grew by leaning`,
    );
  }
});

test('a blade is planted, whatever it draws', () => {
  for (const bend of bendSamples()) {
    const root = bladeArc(bend, 0);
    assert.equal(root.rise, 0);
    assert.equal(root.reach, 0);
  }
});

test('the preset keeps the bend range ordered and upright-ish', () => {
  assert.ok(LAWN.minBend >= 0, 'a blade cannot lean backwards at rest');
  assert.ok(LAWN.minBend < LAWN.maxBend, 'bend range is ordered');
  assert.ok(LAWN.maxBend < Math.PI / 4, 'past 45 degrees this is not a lawn');
});

test('the widest thickened tiller still fits its crown sphere', () => {
  // A crown is culled as one sphere, and every blade it grows has to be in it:
  // widened to the cap, bent as far as it may bend, and standing as far off
  // the crown centre as the tuft spreads.
  const offset = 0.5 * LAWN.tillerSpread;
  for (const height of range(LAWN.minHeight, LAWN.maxHeight, 8)) {
    for (const width of range(LAWN.minWidth, LAWN.maxWidth, 8)) {
      const radius = cullRadius(height, width);
      // Both shortenings compound, so the shortest blade the shader can
      // build is the product of the two.
      for (const shorten of range(
        LAWN.tillerShortest * LAWN.clumpShortest,
        1,
        5,
      )) {
        for (const bend of range(LAWN.minBend, LAWN.maxBend, 8)) {
          for (const along of range(0, 1, 64)) {
            const { rise, reach } = bladeArc(bend, along);
            // The far edge of the blade, widened as far as the shader may go,
            // on the tiller standing furthest from the crown.
            const across =
              bladeHalfWidth(along) * width * LAWN.maxThicken + offset;
            const distance = Math.hypot(
              across,
              rise * height * shorten - CULL_CENTRE * height,
              reach * height * shorten,
            );
            assert.ok(
              distance <= radius,
              `a ${(height * 100).toFixed(1)} cm crown's tiller at bend ` +
                `${bend.toFixed(2)}, shortened to ${shorten.toFixed(2)} and ` +
                `thickened ${LAWN.maxThicken}x, reaches ` +
                `${(distance * 1000).toFixed(2)} mm from the crown centre, ` +
                `past the ${(radius * 1000).toFixed(2)} mm the cull allows`,
            );
          }
        }
      }
    }
  }
});

test('a tiller only ever shortens, so its crown still bounds it', () => {
  assert.ok(LAWN.tillerShortest > 0, 'a tiller with no height is not drawn');
  assert.ok(
    LAWN.tillerShortest <= 1,
    'a tiller taller than its crown outgrows the sphere measured for it',
  );
  assert.ok(LAWN.tillers >= 1, 'a crown grows at least one blade');
  assert.ok(Number.isInteger(LAWN.tillers), 'tillers are whole blades');
});

test('tillering multiplies every ring alike', () => {
  // The rings hand over at matched densities. Tillering is a flat multiplier
  // on all of them, so those boundaries still match -- if this ever becomes
  // per-ring, the 8 m and 24 m handovers need re-deriving, not just retesting.
  assert.equal(typeof LAWN.tillers, 'number');
  assert.ok(LAWN.tillerFan >= 0, 'a negative fan is a mirrored blade');
  assert.ok(LAWN.tillerSpread >= 0, 'a crown cannot have negative width');
});

test('thickening only ever widens, and only to the cap', () => {
  assert.ok(LAWN.maxThicken >= 1, 'a cap under 1 would narrow a blade');
  assert.ok(LAWN.minBladePixels > 0, 'a floor of zero pixels floors nothing');
  // The width a blade is allowed to reach has to stay a blade, not a ribbon.
  const widest = LAWN.maxWidth * LAWN.maxThicken;
  assert.ok(
    widest < LAWN.minHeight,
    `a fully thickened blade is ${(widest * 1000).toFixed(1)} mm across, ` +
      `wider than the shortest blade is tall`,
  );
});

test('the blade is modelled at the width real turf grass is', () => {
  // The point of minBladePixels: stability is bought on screen, so the model
  // no longer has to be drawn oversized to survive walking distance.
  assert.ok(LAWN.minWidth >= 0.002, 'thinner than turf grass gets');
  assert.ok(LAWN.maxWidth <= 0.005, 'wider than turf grass gets');
});

test('a clump only ever shortens its crowns', () => {
  // Same contract as tillerShortest, one scale up. The cull pass measures a
  // crown at its full height and never learns which clump it fell in, so a
  // clump that could make grass taller would put it outside its own sphere.
  assert.ok(LAWN.clumpShortest > 0, 'a clump with no height is not drawn');
  assert.ok(
    LAWN.clumpShortest <= 1,
    'a clump taller than its crowns outgrows the sphere measured for them',
  );
});

test('a clump heading can never cancel to nothing', () => {
  // The crown heading is a unit vector plus the clump heading times clumpPull.
  // Opposed, those sum to |clumpPull - 1|, and normalizing a zero vector has
  // no answer -- so this margin is what stops a NaN blade.
  assert.notEqual(
    LAWN.clumpPull,
    1,
    'at a pull of exactly 1 an opposed clump cancels its crown to zero',
  );
  assert.ok(
    Math.abs(LAWN.clumpPull - 1) >= 0.1,
    `a pull of ${LAWN.clumpPull} leaves only ` +
      `${Math.abs(LAWN.clumpPull - 1).toFixed(3)} of heading to normalize`,
  );
});

test('clumps are a lawn scale, not a meadow one', () => {
  assert.ok(LAWN.clumpSize > LAWN.tillerSpread, 'a clump holds many crowns');
  assert.ok(LAWN.clumpSize <= 2, 'past a couple of metres this is terrain');
});
