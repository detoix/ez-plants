import assert from 'node:assert/strict';
import test from 'node:test';

import {
  terrainHeightAt,
  terrainHeightBounds,
} from '../src/app/field-terrain-height.js';
import { LAWN } from '../src/app/grass-webgpu/preset.js';
import {
  GRASS_RINGS,
  TOTAL_GRASS_CANDIDATES,
} from '../src/app/grass-webgpu/grid.js';
import {
  GRASS_RECORD_BYTES,
  GRASS_RECORD_WORDS,
  GRASS_VISIBLE_ID_BYTES,
  grassStorageFootprint,
} from '../src/app/grass-webgpu/record-layout.js';

const UNORM16_MAX = 65_535;
const UNORM8_MAX = 255;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function unormRoundTrip(value, steps) {
  return Math.round(clamp(value, 0, 1) * steps) / steps;
}

function snorm16RoundTrip(value) {
  return Math.round(clamp(value, -1, 1) * 32_767) / 32_767;
}

function retentionRoundTrip(value) {
  const word = Math.min(Math.floor(clamp(value, 0, 1) * 65_536), UNORM16_MAX);
  return (word + 0.5) / 65_536;
}

function degreesBetween(a, b) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

test('packed grass records have the promised fixed storage budget', () => {
  assert.equal(GRASS_RECORD_WORDS, 6);
  assert.equal(GRASS_RECORD_BYTES, 24);
  assert.equal(GRASS_VISIBLE_ID_BYTES, 4);

  const total = grassStorageFootprint(TOTAL_GRASS_CANDIDATES);
  assert.deepEqual(total, {
    recordBytes: 26_323_488,
    visibleIdBytes: 4_387_248,
    totalBytes: 30_710_736,
  });
  assert.deepEqual(
    GRASS_RINGS.map((ring) => grassStorageFootprint(ring.capacity).totalBytes),
    [11_540_592, 11_540_592, 7_629_552],
  );
  assert.throws(() => grassStorageFootprint(-1), RangeError);
  assert.throws(() => grassStorageFootprint(1.5), RangeError);
});

test('world X/Z float bits survive the uint storage representation exactly', () => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  for (const value of [-123.456, -0, 0, 0.025, 52.125, 1_024.75]) {
    view.setFloat32(0, value, true);
    const expected = view.getFloat32(0, true);
    const bits = view.getUint32(0, true);
    view.setUint32(0, bits, true);
    assert.ok(Object.is(view.getFloat32(0, true), expected));
  }
});

test('height, blade, yaw and appearance quantization stay below lawn-scale error budgets', () => {
  const bounds = terrainHeightBounds(4);
  assert.deepEqual(bounds, { minimum: -4.84, maximum: 4.84, span: 9.68 });

  const groundUnit = 0.438_271;
  const decodedGround =
    bounds.minimum + unormRoundTrip(groundUnit, UNORM16_MAX) * bounds.span;
  const exactGround = bounds.minimum + groundUnit * bounds.span;
  assert.ok(Math.abs(decodedGround - exactGround) <= bounds.span / 131_070);

  const bladeUnit = 0.728_319;
  const exactBlade =
    LAWN.minHeight + bladeUnit * (LAWN.maxHeight - LAWN.minHeight);
  const decodedBlade =
    LAWN.minHeight +
    unormRoundTrip(bladeUnit, UNORM16_MAX) * (LAWN.maxHeight - LAWN.minHeight);
  assert.ok(Math.abs(decodedBlade - exactBlade) <= 0.000_000_31);

  const yawUnit = 0.318_271;
  const yawError =
    Math.abs(unormRoundTrip(yawUnit, UNORM16_MAX) - yawUnit) * 360;
  assert.ok(yawError <= 0.002_75);

  for (const value of [0, 0.137, 0.5, 0.918, 1]) {
    assert.ok(Math.abs(unormRoundTrip(value, UNORM8_MAX) - value) <= 1 / 510);
  }
});

test('packed normals remain unit length and retention cannot survive zero density', () => {
  const original = [0.31, 0.9, -0.3];
  const originalLength = Math.hypot(...original);
  for (let index = 0; index < original.length; index += 1) {
    original[index] /= originalLength;
  }
  const x = snorm16RoundTrip(original[0]);
  const z = snorm16RoundTrip(original[2]);
  const y = Math.sqrt(Math.max(0, 1 - x * x - z * z));
  const decoded = [x, y, z];
  assert.ok(Math.abs(Math.hypot(...decoded) - 1) < 1e-12);
  assert.ok(degreesBetween(original, decoded) < 0.003);

  assert.ok(retentionRoundTrip(0) > 0);
  assert.ok(retentionRoundTrip(1) < 1);
  for (const value of [0, 0.001, 0.5, 0.999, 1]) {
    assert.ok(Math.abs(retentionRoundTrip(value) - value) <= 1 / 131_072);
  }
});

test('the analytic height packing bounds contain the complete field function', () => {
  for (const amplitude of [0, 1.15, 4]) {
    const bounds = terrainHeightBounds(amplitude);
    for (let z = -130; z <= 130; z += 5) {
      for (let x = -130; x <= 130; x += 5) {
        const height = terrainHeightAt(x, z, { amplitude });
        assert.ok(height >= bounds.minimum && height <= bounds.maximum);
      }
    }
  }
});
