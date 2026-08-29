import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  createPanicleGeometry,
  createVegetativeBudGeometry,
} from '../src/lib/plants/hydrangea/geometry.js';

const LADDER = [
  { cards: 68, cardSize: 0.36, rachis: false },
  { cards: 30, cardSize: 0.5, rachis: false },
  { cards: 14, cardSize: 0.62, rachis: false },
];

/** Every card is four consecutive vertices; recover its centre. */
function cardCentres(geometry) {
  const position = geometry.getAttribute('position');
  const centres = [];
  for (let card = 0; card * 4 < position.count; card += 1) {
    const centre = new THREE.Vector3();
    for (let corner = 0; corner < 4; corner += 1) {
      centre.add(
        new THREE.Vector3().fromBufferAttribute(position, card * 4 + corner),
      );
    }
    centres.push(centre.multiplyScalar(0.25));
  }
  return centres;
}

function correlation(a, b) {
  const mean = (values) => values.reduce((t, v) => t + v, 0) / values.length;
  const [ma, mb] = [mean(a), mean(b)];
  let top = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i += 1) {
    top += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return top / Math.sqrt(sa * sb);
}

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
    ...LADDER.map((rung, level) => [
      `panicle rung ${level}`,
      createPanicleGeometry(rung),
    ]),
    ['panicle with rachis', createPanicleGeometry({ rachis: true })],
    ['vegetative bud', createVegetativeBudGeometry()],
  ];

  for (const [label, geometry] of geometries) {
    assertFiniteGeometry(geometry, label);
    geometry.dispose();
  }
});

test('every card carries the floret plate, so the head has a silhouette', () => {
  // The head's outline comes from the plate's alpha, not from its quads. A
  // card without UVs samples the texture's transparent corner and vanishes,
  // and the rachis is UV-parked inside the plate's opaque core for the same
  // reason.
  for (const rung of [...LADDER, { rachis: true }]) {
    const geometry = createPanicleGeometry(rung);
    const uv = geometry.getAttribute('uv');
    assert.ok(uv, 'a panicle needs UVs');
    assert.equal(uv.count, geometry.getAttribute('position').count);
    assert.ok(uv.array.every((value) => value >= 0 && value <= 1));
    geometry.dispose();
  }
});

test('cards clothe the whole cone rather than winding round it once', () => {
  // A regression test with a specific bug behind it. Card height and card
  // azimuth are both drawn from `fract(index * stride)`, and the first pass
  // took height from 0.618 while azimuth came from the golden angle, which is
  // 0.382 of a turn. Those sum to one, so height was exactly one minus
  // azimuth: every card landed on a single spiral that wrapped the cone once,
  // and the heads rendered as hooks instead of cones. Independent strides are
  // load-bearing here, and nothing else in the output would show it.
  const geometry = createPanicleGeometry({ cards: 68, rachis: false });
  const centres = cardCentres(geometry);
  const heights = centres.map((centre) => centre.y);
  const azimuths = centres.map(
    (centre) => (Math.atan2(centre.z, centre.x) + Math.PI) / (2 * Math.PI),
  );

  assert.ok(
    Math.abs(correlation(heights, azimuths)) < 0.3,
    'card height and azimuth must be independent, or the shell is a helix',
  );
  // And the cards must actually span the cone. Centres sit inset from the
  // ends by half a card, so this is a span rather than a reach.
  assert.ok(
    Math.max(...heights) - Math.min(...heights) > 0.5,
    'cards must be spread along the cone, not gathered in a band',
  );
  geometry.dispose();
});

test('the head is a broad tapered cone rooted along positive Y', () => {
  // The same shape assertion the meshed panicle carried: 'Limelight' is a
  // broad plump cone, 15-25 x 12-18 cm, not a spike and not a globe.
  const geometry = createPanicleGeometry({ rachis: true });
  const size = geometry.boundingBox.getSize(new THREE.Vector3());

  // A card is placed by its centre and drawn around it, so a shell of them
  // overruns the unit frame a little. It must stay *small*, and stay the same
  // at every rung, or the head changes size when the plant crosses a band.
  assert.ok(geometry.boundingBox.min.y >= -0.05, 'head sank below its root');
  assert.ok(geometry.boundingBox.max.y <= 1.12, 'head overran its tip');
  assert.ok(geometry.boundingBox.max.y > 0.9, 'head must reach its unit tip');
  assert.ok(size.x > size.y * 0.6, 'Limelight head should be broad in X');
  assert.ok(size.z > size.y * 0.6, 'Limelight head should be broad in Z');
  assert.ok(size.x < size.y * 1.2, 'head stays tapered rather than globose');
  assert.ok(
    Math.abs(size.x - size.z) < size.y * 0.2,
    'head should be approximately radial around its rachis',
  );

  geometry.dispose();
});

test('each rung of the head ladder is cheaper than the one above it', () => {
  // The point of the ladder. Instance-count LOD cannot pay for a hydrangea --
  // the heads *are* the cultivar, so they can never be thinned far enough --
  // so the organ has to get simpler instead. Library rule 9, and
  // `test/geometry-budget.test.js` holds the resulting numbers.
  const rungs = LADDER.map((rung) => createPanicleGeometry(rung));
  try {
    for (let level = 1; level < rungs.length; level += 1) {
      assert.ok(
        rungs[level].index.count < rungs[level - 1].index.count,
        `rung ${level} must be cheaper than rung ${level - 1}`,
      );
    }
    // Coarser rungs answer fewer cards with larger ones, so the cone stays
    // clothed instead of thinning into a see-through wire frame.
    const spans = rungs.map((geometry) =>
      geometry.boundingBox.getSize(new THREE.Vector3()),
    );
    for (const span of spans) {
      assert.ok(span.x > 0.7 && span.y > 0.85, 'a rung lost the head');
    }
    // And every rung draws a head the same size, so crossing a band does not
    // visibly grow or shrink the flowers.
    for (const axis of ['x', 'y', 'z']) {
      const extents = spans.map((span) => span[axis]);
      assert.ok(
        Math.max(...extents) - Math.min(...extents) < 0.2,
        `the head changes ${axis} size between rungs`,
      );
    }
  } finally {
    for (const rung of rungs) rung.dispose();
  }
});

test('all Limelight organ geometry generation is byte deterministic', () => {
  const factories = [
    ['panicle', () => createPanicleGeometry(LADDER[0])],
    ['panicle with rachis', () => createPanicleGeometry({ rachis: true })],
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
  assert.throws(() => createPanicleGeometry({ cards: 0 }), /cards/);
  assert.throws(() => createPanicleGeometry({ cards: 2.5 }), /cards/);
  assert.throws(() => createPanicleGeometry({ cardSize: 0 }), /cardSize/);
  assert.throws(() => createPanicleGeometry({ cardSize: 2 }), /cardSize/);
  assert.throws(
    () => createPanicleGeometry({ cardSize: Number.NaN }),
    /cardSize/,
  );
  assert.throws(() => createVegetativeBudGeometry({ segments: 3 }), /segments/);
  assert.throws(() => createVegetativeBudGeometry({ rings: 1 }), /rings/);
});
