import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
  createCurveBranchSections,
  sampleBranchSection,
} from '../src/lib/woody-geometry.js';

function legacyAppendBranchTube(data, sections, radialSegments, textureWraps) {
  const indexOffset = data.verts.length / 3;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    let first;
    for (let j = 0; j < radialSegments; j++) {
      const angle = (2 * Math.PI * j) / radialSegments;
      const vertex = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
        .multiplyScalar(section.radius)
        .applyEuler(section.orientation)
        .add(section.origin);
      const normal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
        .applyEuler(section.orientation)
        .normalize();
      const uv = new THREE.Vector2(
        (j / radialSegments) * textureWraps,
        i % 2 === 0 ? 0 : 1,
      );
      data.verts.push(...Object.values(vertex));
      data.normals.push(...Object.values(normal));
      data.uvs.push(...Object.values(uv));
      if (j === 0) first = { vertex, normal, uv };
    }
    data.verts.push(...Object.values(first.vertex));
    data.normals.push(...Object.values(first.normal));
    data.uvs.push(textureWraps, first.uv.y);
  }

  const ringStride = radialSegments + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const v1 = indexOffset + i * ringStride + j;
      const v2 = v1 + 1;
      const v3 = v1 + ringStride;
      const v4 = v2 + ringStride;
      data.indices.push(v1, v3, v2, v2, v3, v4);
    }
  }
}

const sections = [
  {
    origin: new THREE.Vector3(0, 0, 0),
    orientation: new THREE.Euler(0.1, 0.2, -0.1),
    radius: 1.2,
  },
  {
    origin: new THREE.Vector3(0.2, 1.5, -0.1),
    orientation: new THREE.Euler(-0.15, 0.25, 0.2),
    radius: 0.8,
  },
  {
    origin: new THREE.Vector3(0.5, 2.8, 0.1),
    orientation: new THREE.Euler(0.05, -0.1, 0.35),
    radius: 0.3,
  },
];

test('shared open tube is byte-for-byte equivalent to EZ-Tree branch output', () => {
  const expected = createBranchGeometryData();
  const actual = createBranchGeometryData();
  legacyAppendBranchTube(expected, sections, 7, 3);
  appendBranchTube(actual, sections, {
    radialSegments: 7,
    textureWraps: 3,
  });
  assert.deepEqual(actual, expected);
});

test('every branch ring preserves EZ-Tree UV seam continuity', () => {
  const data = createBranchGeometryData();
  appendBranchTube(data, sections, {
    radialSegments: 5,
    textureWraps: 4,
  });
  const stride = 6;
  for (let ring = 0; ring < sections.length; ring++) {
    const first = ring * stride * 3;
    const seam = (ring * stride + 5) * 3;
    assert.deepEqual(
      data.verts.slice(seam, seam + 3),
      data.verts.slice(first, first + 3),
    );
    assert.deepEqual(
      data.normals.slice(seam, seam + 3),
      data.normals.slice(first, first + 3),
    );
    assert.equal(data.uvs[(ring * stride + 5) * 2], 4);
    assert.equal(data.uvs[ring * stride * 2], 0);
  }
});

test('Three.js Frenet sections use the shared seam and outward side winding', () => {
  const frameSections = [0, 1].map((y) => ({
    origin: new THREE.Vector3(0, y, 0),
    tangent: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(0, 0, -1),
    binormal: new THREE.Vector3(-1, 0, 0),
    radius: 0.5,
  }));
  const data = createBranchGeometryData();
  appendBranchTube(data, frameSections, { radialSegments: 6 });

  const [a, b, c] = data.indices
    .slice(0, 3)
    .map((index) => new THREE.Vector3().fromArray(data.verts, index * 3));
  const faceNormal = new THREE.Vector3()
    .crossVectors(b.clone().sub(a), c.clone().sub(a))
    .normalize();
  assert.ok(faceNormal.dot(frameSections[0].normal) > 0.8);
  assert.deepEqual(data.verts.slice(18, 21), data.verts.slice(0, 3));
});

test('Catmull-Rom adapter emits only reusable Frenet sections and sampled radii', () => {
  const curveSections = createCurveBranchSections(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.1, 0.5, 0),
      new THREE.Vector3(0.2, 1, 0.1),
    ],
    [0.2, 0.1, 0.02],
    { tubularSegments: 4 },
  );
  assert.equal(curveSections.length, 5);
  assert.equal(curveSections[0].radius, 0.2);
  assert.equal(curveSections[2].radius, 0.1);
  assert.equal(curveSections[4].radius, 0.02);
  for (const section of curveSections) {
    assert.ok(section.origin.isVector3);
    assert.ok(section.tangent.isVector3);
    assert.ok(section.normal.isVector3);
    assert.ok(section.binormal.isVector3);
    assert.ok(Math.abs(section.tangent.length() - 1) < 1e-12);
    assert.ok(Math.abs(section.normal.length() - 1) < 1e-12);
    assert.ok(Math.abs(section.binormal.length() - 1) < 1e-12);
  }
  assert.equal('geometry' in curveSections, false);
});

test('branch BufferGeometry promotes large indices to Uint32', () => {
  const data = createBranchGeometryData();
  const vertexCount = 65_537;
  data.verts = new Array(vertexCount * 3).fill(0);
  data.normals = new Array(vertexCount * 3).fill(0);
  data.uvs = new Array(vertexCount * 2).fill(0);
  data.indices = [0, 65_536, 1];
  const geometry = createBranchBufferGeometry(data);
  assert.ok(geometry.index.array instanceof Uint32Array);
  geometry.dispose();
});

test('cap policy adds independently shaded outward-facing end caps', () => {
  const data = createBranchGeometryData();
  const result = appendBranchTube(data, sections.slice(0, 2), {
    radialSegments: 6,
    caps: BranchCap.Both,
  });
  const sideVertices = 2 * 7;
  const capVertices = 2 * 8;
  const sideIndices = 6 * 6;
  const capIndices = 2 * 6 * 3;
  assert.equal(result.vertexCount, sideVertices + capVertices);
  assert.equal(result.indexCount, sideIndices + capIndices);

  const startTriangle = data.indices.slice(sideIndices, sideIndices + 3);
  const [a, b, c] = startTriangle.map((index) =>
    new THREE.Vector3().fromArray(data.verts, index * 3),
  );
  const faceNormal = new THREE.Vector3()
    .crossVectors(b.clone().sub(a), c.clone().sub(a))
    .normalize();
  const expectedNormal = new THREE.Vector3(0, -1, 0)
    .applyEuler(sections[0].orientation)
    .normalize();
  assert.ok(faceNormal.dot(expectedNormal) > 0.999999);
});

test('parent sampling interpolates origin, radius and orientation from A to B', () => {
  const parent = [
    {
      origin: new THREE.Vector3(0, 0, 0),
      orientation: new THREE.Euler(0, 0, 0),
      radius: 2,
    },
    {
      origin: new THREE.Vector3(4, 8, 12),
      orientation: new THREE.Euler(0, 0, Math.PI / 2),
      radius: 1,
    },
  ];
  const sample = sampleBranchSection(parent, 0.25, 0.5);
  assert.deepEqual(sample.origin.toArray(), [1, 2, 3]);
  assert.equal(sample.radius, 0.875);

  const expected = new THREE.Quaternion()
    .setFromEuler(parent[0].orientation)
    .slerp(new THREE.Quaternion().setFromEuler(parent[1].orientation), 0.25);
  const actual = new THREE.Quaternion().setFromEuler(sample.orientation);
  assert.ok(1 - Math.abs(actual.dot(expected)) < 1e-12);

  const atStart = sampleBranchSection(parent, 0).orientation;
  const atEnd = sampleBranchSection(parent, 1).orientation;
  assert.ok(
    1 -
      Math.abs(
        new THREE.Quaternion()
          .setFromEuler(atStart)
          .dot(new THREE.Quaternion().setFromEuler(parent[0].orientation)),
      ) <
      1e-12,
  );
  assert.ok(
    1 -
      Math.abs(
        new THREE.Quaternion()
          .setFromEuler(atEnd)
          .dot(new THREE.Quaternion().setFromEuler(parent[1].orientation)),
      ) <
      1e-12,
  );
});
