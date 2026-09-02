import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  createThujaDepthShellGeometry,
  createThujaSprayGeometry,
} from '../src/lib/plants/thuja/geometry.js';

const EXPECTED_TRIANGLES = Object.freeze([6, 4, 2]);
const EXPECTED_SEGMENTS = Object.freeze([3, 2, 1]);
const FRONT = new THREE.Vector3(0, 0, 1);

function values(attribute) {
  return Array.from(attribute.array);
}

function triangleNormal(geometry, offset) {
  const positions = geometry.getAttribute('position');
  const a = new THREE.Vector3().fromBufferAttribute(
    positions,
    geometry.index.getX(offset),
  );
  const b = new THREE.Vector3().fromBufferAttribute(
    positions,
    geometry.index.getX(offset + 1),
  );
  const c = new THREE.Vector3().fromBufferAttribute(
    positions,
    geometry.index.getX(offset + 2),
  );
  return new THREE.Vector3().crossVectors(b.sub(a), c.sub(a));
}

test('Thuja spray cards keep the bent 6-4-2 triangle ladder', () => {
  const observed = [];
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaSprayGeometry({ level });
    try {
      const triangles = geometry.index.count / 3;
      observed.push(triangles);
      assert.equal(geometry.userData.triangleCount, triangles);
      assert.equal(geometry.userData.kind, 'thuja-photographic-spray-card');
      assert.equal(geometry.userData.level, level);
    } finally {
      geometry.dispose();
    }
  }
  assert.deepEqual(observed, EXPECTED_TRIANGLES);
  assert.ok(observed[0] > observed[1] && observed[1] > observed[2]);
});

test('every LOD is one true plane, never a crossed-card starburst', () => {
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaSprayGeometry({ level });
    try {
      const positions = geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1) {
        assert.equal(positions.getZ(index), 0);
      }
      for (let offset = 0; offset < geometry.index.count; offset += 3) {
        const normal = triangleNormal(geometry, offset);
        assert.ok(normal.lengthSq() > 1e-10);
        assert.ok(normal.normalize().dot(FRONT) > 0.999999);
      }

      const topology = geometry.userData.topology;
      assert.deepEqual(topology.principalPlaneNormal, [0, 0, 1]);
      assert.equal(topology.principalPlane, 'xy');
      assert.equal(topology.internalPlaneCount, 1);
      assert.equal(topology.crossedPlanes, false);
      assert.equal(topology.planeThickness, 0);
      assert.equal(topology.planeThicknessLimit, 0);
    } finally {
      geometry.dispose();
    }
  }
});

test('the full card UV carries the photographed alpha silhouette', () => {
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaSprayGeometry({ level });
    try {
      const topology = geometry.userData.topology;
      const position = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');

      assert.equal(topology.form, 'segmented-alpha-card');
      assert.equal(topology.connectedSurface, true);
      assert.equal(topology.negativeSpace, 'photographic-alpha');
      assert.equal(topology.sourcePlate, 'leaf.webp');
      assert.equal(topology.longitudinalSegments, EXPECTED_SEGMENTS[level]);
      assert.equal(position.count, (EXPECTED_SEGMENTS[level] + 1) * 2);
      assert.equal(geometry.boundingBox.min.x, -0.5);
      assert.equal(geometry.boundingBox.max.x, 0.5);
      assert.equal(geometry.boundingBox.min.y, 0);
      assert.equal(geometry.boundingBox.max.y, 1);
      assert.deepEqual(
        new Set(values(uv).filter((_, index) => index % 2 === 0)),
        new Set([0, 1]),
      );
    } finally {
      geometry.dispose();
    }
  }
});

test('authored normals suggest a shallow cup without moving the plane', () => {
  const geometry = createThujaSprayGeometry({ level: 0 });
  try {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    let leftTilt = 0;
    let rightTilt = 0;
    let leftCount = 0;
    let rightCount = 0;

    for (let index = 0; index < positions.count; index += 1) {
      const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
      assert.ok(Math.abs(normal.length() - 1) < 1e-6);
      assert.ok(normal.z > 0.99);
      if (positions.getX(index) < 0) {
        leftTilt += normal.x;
        leftCount += 1;
      } else {
        rightTilt += normal.x;
        rightCount += 1;
      }
    }

    assert.ok(leftTilt / leftCount > 0.08);
    assert.ok(rightTilt / rightCount < -0.08);
    assert.equal(
      geometry.userData.topology.cupRepresentation,
      'authored-normals',
    );
  } finally {
    geometry.dispose();
  }
});

test('card attributes are finite and wind UVs pin root while freeing tip', () => {
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaSprayGeometry({ level });
    try {
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const color = geometry.getAttribute('color');
      const uv = geometry.getAttribute('uv');
      assert.equal(normal.count, position.count);
      assert.equal(color.count, position.count);
      assert.equal(uv.count, position.count);

      for (const attribute of [position, normal, color, uv]) {
        assert.ok(values(attribute).every(Number.isFinite));
      }
      assert.ok(values(color).every((component) => component === 1));
      assert.ok(
        Array.from(geometry.index.array).every(
          (index) => Number.isInteger(index) && index < position.count,
        ),
      );

      for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index);
        assert.ok(uv.getX(index) === 0 || uv.getX(index) === 1);
        assert.ok(Math.abs(uv.getY(index) - y) < 1e-7);
        if (y === 0) assert.equal(uv.getY(index), 0);
        if (y === 1) assert.equal(uv.getY(index), 1);
      }
      assert.ok(geometry.boundingSphere.radius > 0);
      assert.ok(Number.isFinite(geometry.boundingSphere.radius));
    } finally {
      geometry.dispose();
    }
  }
});

test('card topology removes bend rows with distance', () => {
  const segmentCounts = [];
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaSprayGeometry({ level });
    try {
      const topology = geometry.userData.topology;
      segmentCounts.push(topology.longitudinalSegments);
      assert.equal(topology.sourcePlate, 'leaf.webp');
      assert.equal(
        topology.silhouetteStyle,
        'real-thuja-occidentalis-scale-spray',
      );
    } finally {
      geometry.dispose();
    }
  }
  assert.deepEqual(segmentCounts, EXPECTED_SEGMENTS);
});

test('the recessed depth shell simplifies aggressively and stays inside the sprays', () => {
  const expected = [324, 144, 64];
  for (let level = 0; level < 3; level += 1) {
    const geometry = createThujaDepthShellGeometry({ level });
    try {
      assert.equal(geometry.userData.kind, 'thuja-recessed-foliage-shell');
      assert.equal(geometry.userData.outerSilhouette, false);
      assert.equal(geometry.index.count / 3, expected[level]);
      assert.equal(geometry.userData.triangleCount, expected[level]);
      assert.ok(geometry.boundingBox.max.x < 0.82);
      assert.ok(geometry.boundingBox.min.x > -0.82);
      assert.equal(geometry.boundingBox.min.y, 0);
      assert.equal(geometry.boundingBox.max.y, 1);
    } finally {
      geometry.dispose();
    }
  }
});

test('invalid Thuja spray-card LODs fail before geometry allocation', () => {
  for (const level of [-1, 0.5, 3, Number.NaN]) {
    assert.throws(
      () => createThujaSprayGeometry({ level }),
      /level must be 0, 1 or 2/,
    );
  }
});
