import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  createFertilePanicleGeometry,
  createPanicleStemGeometry,
  createSterilePanicleGeometry,
  createVegetativeBudGeometry,
} from '../src/lib/plants/hydrangea/geometry.js';

function assertFiniteGeometry(geometry, label) {
  assert.ok(geometry.isBufferGeometry, `${label} must be a BufferGeometry`);
  assert.ok(geometry.index, `${label} must be indexed`);
  assert.ok(geometry.index.count > 0, `${label} must contain triangles`);

  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const color = geometry.getAttribute('color');
  assert.ok(position, `${label} needs positions`);
  assert.ok(normal, `${label} needs normals`);
  assert.ok(color, `${label} needs vertex colours`);
  assert.equal(normal.count, position.count, `${label} normal count`);
  assert.equal(color.count, position.count, `${label} colour count`);

  for (const [name, attribute] of [
    ['position', position],
    ['normal', normal],
    ['color', color],
  ]) {
    assert.ok(
      attribute.array.every(Number.isFinite),
      `${label} ${name} values must all be finite`,
    );
  }
  assert.ok(
    geometry.index.array.every(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < position.count,
    ),
    `${label} indices must address existing vertices`,
  );

  assert.ok(geometry.boundingBox, `${label} needs a bounding box`);
  assert.ok(geometry.boundingSphere, `${label} needs a bounding sphere`);
  for (const component of [
    ...geometry.boundingBox.min.toArray(),
    ...geometry.boundingBox.max.toArray(),
    ...geometry.boundingSphere.center.toArray(),
    geometry.boundingSphere.radius,
  ]) {
    assert.ok(Number.isFinite(component), `${label} bounds must be finite`);
  }
  assert.ok(geometry.boundingSphere.radius > 0, `${label} must have volume`);
}

function byteView(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function assertGeometryBytesEqual(actual, expected, label) {
  for (const attributeName of ['position', 'normal', 'color']) {
    assert.deepEqual(
      byteView(actual.getAttribute(attributeName).array),
      byteView(expected.getAttribute(attributeName).array),
      `${label} ${attributeName} bytes`,
    );
  }
  assert.deepEqual(
    byteView(actual.index.array),
    byteView(expected.index.array),
    `${label} index bytes`,
  );
  assert.deepEqual(actual.userData, expected.userData, `${label} metadata`);
}

test('all Limelight unit organ geometries are finite, indexed, and bounded', () => {
  const geometries = [
    ['sterile panicle', createSterilePanicleGeometry()],
    ['fertile panicle', createFertilePanicleGeometry()],
    ['panicle stem', createPanicleStemGeometry()],
    ['vegetative bud', createVegetativeBudGeometry()],
  ];

  for (const [label, geometry] of geometries) {
    assertFiniteGeometry(geometry, label);
    geometry.dispose();
  }
});

test('sterile panicle topology encodes exactly four ovate sepals per floret', () => {
  const geometry = createSterilePanicleGeometry();
  const { floretCount, sepalsPerFloret } = geometry.userData;

  assert.equal(geometry.userData.organ, 'sterile-panicle');
  assert.equal(sepalsPerFloret, 4);
  assert.ok(floretCount >= 80, 'the showy shell should remain densely sterile');
  // Each separate shallow-cupped sepal has one centre, six rim vertices, and
  // six triangles. This checks the actual topology, not metadata alone.
  assert.equal(geometry.getAttribute('position').count, floretCount * 4 * 7);
  assert.equal(geometry.index.count / 3, floretCount * 4 * 6);

  geometry.dispose();
});

test('lower and upper sterile regions exactly partition the full layout', () => {
  const all = createSterilePanicleGeometry();
  const lower = createSterilePanicleGeometry({ region: 'lower' });
  const upper = createSterilePanicleGeometry({ region: 'upper' });

  assert.equal(lower.userData.region, 'lower');
  assert.equal(upper.userData.region, 'upper');
  assert.equal(lower.userData.regionSplit, upper.userData.regionSplit);
  assert.equal(
    lower.userData.floretCount + upper.userData.floretCount,
    all.userData.floretCount,
  );
  assert.equal(
    lower.getAttribute('position').count + upper.getAttribute('position').count,
    all.getAttribute('position').count,
  );
  assert.equal(lower.index.count + upper.index.count, all.index.count);

  all.dispose();
  lower.dispose();
  upper.dispose();
});

test('sterile flowers form a broad panicle rooted along positive Y', () => {
  const geometry = createSterilePanicleGeometry();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());

  assert.ok(
    geometry.boundingBox.min.y >= 0,
    'panicle cannot extend below root',
  );
  assert.ok(
    geometry.boundingBox.max.y <= 1,
    'unit panicle cannot pass its tip',
  );
  assert.ok(
    geometry.boundingBox.max.y > 0.9,
    'panicle must reach its unit tip',
  );
  assert.ok(size.x > size.y * 0.8, 'Limelight panicle should be broad in X');
  assert.ok(size.z > size.y * 0.8, 'Limelight panicle should be broad in Z');
  assert.ok(
    size.x < size.y * 1.1,
    'panicle remains tapered rather than globose',
  );
  assert.ok(
    size.z < size.y * 1.1,
    'panicle remains tapered rather than globose',
  );
  assert.ok(
    Math.abs(size.x - size.z) < size.y * 0.12,
    'panicle should be approximately radial around its rachis',
  );

  geometry.dispose();
});

test('fertile flowers stay sparse, small, and inside the showy shell', () => {
  const sterile = createSterilePanicleGeometry();
  const fertile = createFertilePanicleGeometry();
  const sterileSize = sterile.boundingBox.getSize(new THREE.Vector3());
  const fertileSize = fertile.boundingBox.getSize(new THREE.Vector3());

  assert.equal(fertile.userData.organ, 'fertile-panicle');
  assert.ok(
    fertile.userData.representativeFlowerCount < sterile.userData.floretCount,
  );
  assert.ok(
    fertile.getAttribute('position').count <
      sterile.getAttribute('position').count / 4,
    'fertile mass must not become an opaque cone',
  );
  assert.ok(fertileSize.x < sterileSize.x);
  assert.ok(fertileSize.y < sterileSize.y);
  assert.ok(fertileSize.z < sterileSize.z);

  sterile.dispose();
  fertile.dispose();
});

test('panicle stem is an open, compound, metadata-described framework', () => {
  const stem = createPanicleStemGeometry();
  const sterile = createSterilePanicleGeometry();

  assert.equal(stem.userData.organ, 'panicle-stem');
  assert.equal(stem.userData.branchingLevels, 9);
  assert.ok(stem.userData.branchCount > stem.userData.branchingLevels * 4);
  assert.ok(
    stem.index.count < sterile.index.count / 2,
    'supporting rachis must stay open beneath the flower shell',
  );
  assert.equal(stem.boundingBox.min.y, 0);
  assert.ok(stem.boundingBox.max.y > 0.95);
  assert.ok(stem.boundingBox.max.y <= 1);

  stem.dispose();
  sterile.dispose();
});

test('all Limelight organ geometry generation is byte deterministic', () => {
  const factories = [
    ['sterile', () => createSterilePanicleGeometry()],
    ['fertile', () => createFertilePanicleGeometry()],
    ['stem', () => createPanicleStemGeometry()],
    ['bud', () => createVegetativeBudGeometry()],
  ];

  for (const [label, factory] of factories) {
    const first = factory();
    const second = factory();
    assertGeometryBytesEqual(first, second, label);
    first.dispose();
    second.dispose();
  }
});

test('Limelight geometry options reject invalid topology requests', () => {
  assert.throws(
    () => createSterilePanicleGeometry({ region: 'middle' }),
    /Unknown panicle region/,
  );
  assert.throws(() => createSterilePanicleGeometry({ rings: 0 }), /rings/);
  assert.throws(() => createSterilePanicleGeometry({ rings: 2.5 }), /rings/);
  assert.throws(
    () => createSterilePanicleGeometry({ density: 0.1 }),
    /density/,
  );
  assert.throws(
    () => createSterilePanicleGeometry({ density: Number.NaN }),
    /density/,
  );
  assert.throws(() => createFertilePanicleGeometry({ count: 0 }), /count/);
  assert.throws(() => createPanicleStemGeometry({ levels: 2 }), /levels/);
  assert.throws(() => createPanicleStemGeometry({ sides: 2 }), /sides/);
  assert.throws(() => createVegetativeBudGeometry({ segments: 3 }), /segments/);
  assert.throws(() => createVegetativeBudGeometry({ rings: 1 }), /rings/);
});
