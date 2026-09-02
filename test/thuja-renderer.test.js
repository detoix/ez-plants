import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { Thuja } from '../src/lib/plants/thuja/thuja.js';
import {
  readThujaWindMetadataFromMatrix,
  THUJA_WIND_LOD_PROFILES,
  ThujaWind,
} from '../src/lib/plants/thuja/wind.js';

function organ(plant) {
  return plant._instancePool.mesh('sprays');
}

function state(plant) {
  const mesh = organ(plant);
  const shell = plant._instancePool.mesh('shell');
  return {
    count: mesh.count,
    matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
    colors: Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3)),
    shellMatrices: Array.from(
      shell.instanceMatrix.array.slice(0, shell.count * 16),
    ),
    wood: Array.from(plant._woodMesh.geometry.attributes.position.array),
  };
}

const RASTER_SIZE = 160;
const RASTER_X_MIN = -1.25;
const RASTER_X_MAX = 1.25;
const RASTER_Y_MIN = -0.05;
const RASTER_Y_MAX = 1.1;
const REVIEW_AZIMUTHS = Object.freeze([
  0,
  Math.PI / 8,
  Math.PI / 4,
  (Math.PI * 3) / 8,
  Math.PI / 2,
]);

function crownEnvelope(fraction) {
  const amount = THREE.MathUtils.clamp(fraction, 0, 1);
  const shoulder = 0.88 + 0.12 * THREE.MathUtils.clamp(amount / 0.2, 0, 1);
  const taper = Math.pow(Math.max(0, 1 - Math.pow(amount, 1.72)), 0.54);
  return Math.max(0.06, shoulder * taper);
}

function rasterCoordinate(value, minimum, maximum) {
  return ((value - minimum) / (maximum - minimum)) * RASTER_SIZE;
}

/**
 * Rasterise the real transformed triangles, not their opaque bounding boxes.
 * The canvas deliberately extends beyond the declared crown so false-positive
 * oversizing cannot masquerade as density.
 */
function rasterizedCoverage(plant, viewAngle) {
  const matrix = new THREE.Matrix4();
  const vertices = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const mask = new Uint8Array(RASTER_SIZE * RASTER_SIZE);
  const { heightM, radiusM } = plant.stats().dimensions;
  const sine = Math.sin(viewAngle);
  const cosine = Math.cos(viewAngle);
  const projectX = (point) => -sine * point.x + cosine * point.z;

  for (const kind of plant._organKinds) {
    const mesh = plant._instancePool.mesh(kind);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    for (let instance = 0; instance < mesh.count; instance += 1) {
      mesh.getMatrixAt(instance, matrix);
      for (let offset = 0; offset < index.count; offset += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          vertices[corner]
            .fromBufferAttribute(position, index.getX(offset + corner))
            .applyMatrix4(matrix);
        }
        const [a, b, c] = vertices;
        const ax = rasterCoordinate(
          projectX(a) / radiusM,
          RASTER_X_MIN,
          RASTER_X_MAX,
        );
        const ay = rasterCoordinate(a.y / heightM, RASTER_Y_MIN, RASTER_Y_MAX);
        const bx = rasterCoordinate(
          projectX(b) / radiusM,
          RASTER_X_MIN,
          RASTER_X_MAX,
        );
        const by = rasterCoordinate(b.y / heightM, RASTER_Y_MIN, RASTER_Y_MAX);
        const cx = rasterCoordinate(
          projectX(c) / radiusM,
          RASTER_X_MIN,
          RASTER_X_MAX,
        );
        const cy = rasterCoordinate(c.y / heightM, RASTER_Y_MIN, RASTER_Y_MAX);
        const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denominator) < 1e-8) continue;
        const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const maxX = Math.min(RASTER_SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
        const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const maxY = Math.min(RASTER_SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let row = minY; row <= maxY; row += 1) {
          for (let column = minX; column <= maxX; column += 1) {
            const x = column + 0.5;
            const y = row + 0.5;
            const first =
              ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
            const second =
              ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
            if (first >= 0 && second >= 0 && first + second <= 1) {
              mask[row * RASTER_SIZE + column] = 1;
            }
          }
        }
      }
    }
  }

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (let row = 0; row < RASTER_SIZE; row += 1) {
    const heightFraction = THREE.MathUtils.lerp(
      RASTER_Y_MIN,
      RASTER_Y_MAX,
      (row + 0.5) / RASTER_SIZE,
    );
    const envelope =
      heightFraction >= 0 && heightFraction <= 1
        ? crownEnvelope(heightFraction)
        : 0;
    for (let column = 0; column < RASTER_SIZE; column += 1) {
      const horizontal = THREE.MathUtils.lerp(
        RASTER_X_MIN,
        RASTER_X_MAX,
        (column + 0.5) / RASTER_SIZE,
      );
      const expected = Math.abs(horizontal) <= envelope;
      const actual = mask[row * RASTER_SIZE + column] === 1;
      if (expected && actual) truePositive += 1;
      else if (expected) falseNegative += 1;
      else if (actual) falsePositive += 1;
    }
  }
  const recall = truePositive / (truePositive + falseNegative);
  const precision = truePositive / (truePositive + falsePositive);
  const intersectionOverUnion =
    truePositive / (truePositive + falsePositive + falseNegative);
  return Object.freeze({
    recall,
    precision,
    intersectionOverUnion,
    leakage: 1 - precision,
  });
}

/** Exact visible-vertex bounds; this avoids stale InstancedMesh bounds. */
function visibleBounds(plant) {
  const box = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const kind of plant._organKinds) {
    const mesh = plant._instancePool.mesh(kind);
    const positions = mesh.geometry.getAttribute('position');
    for (let instance = 0; instance < mesh.count; instance += 1) {
      mesh.getMatrixAt(instance, matrix);
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
        box.expandByPoint(point);
      }
    }
  }
  const woodPositions = plant._woodMesh.geometry.getAttribute('position');
  for (let vertex = 0; vertex < woodPositions.count; vertex += 1) {
    box.expandByPoint(point.fromBufferAttribute(woodPositions, vertex));
  }
  return box;
}

test('Thuja is EZ-Tree wood, one recessed shell, and one spray batch', () => {
  const plant = new Thuja({ seed: 4, ageYears: 5, dayOfYear: 200 });
  try {
    assert.deepEqual(plant._organKinds, ['shell', 'sprays']);
    assert.equal(plant._woodMesh.isMesh, true);
    assert.equal(organ(plant).isInstancedMesh, true);
    assert.equal(plant._instancePool.mesh('shell').count, 1);
    assert.equal(plant.stats().drawCalls, 3);
    assert.equal(plant.stats().visibleLeaves, plant.stats().visibleSprays);
  } finally {
    plant.dispose();
  }
});

test('every LOD rung meets its budget at five, ten, twenty and thirty years', () => {
  const limits = [30_000, 10_000, 5_000];
  for (const ageYears of [5, 10, 20, 30]) {
    const plant = new Thuja({ seed: 'budget', ageYears, dayOfYear: 230 });
    try {
      for (let level = 0; level < 3; level += 1) {
        plant.setLevel(level);
        const baked = plant.bake();
        try {
          const wood = baked.wood?.geometry.index?.count / 3 || 0;
          const organs = baked.organs.reduce(
            (sum, entry) =>
              sum + (entry.geometry.index.count / 3) * entry.count,
            0,
          );
          assert.ok(
            wood + organs <= limits[level],
            `age ${ageYears}, level ${level}: ${wood + organs}`,
          );
          assert.equal(plant.stats().drawCalls, level === 0 ? 3 : 2);
        } finally {
          baked.dispose();
        }
      }
    } finally {
      plant.dispose();
    }
  }
});

test('real spray triangles form a dense, bounded cone from five azimuths', () => {
  const thresholds = new Map([
    [5, { recall: 0.8, precision: 0.82, intersectionOverUnion: 0.7 }],
    [10, { recall: 0.875, precision: 0.88, intersectionOverUnion: 0.8 }],
    [20, { recall: 0.875, precision: 0.88, intersectionOverUnion: 0.8 }],
    [30, { recall: 0.875, precision: 0.88, intersectionOverUnion: 0.8 }],
  ]);
  for (const ageYears of [5, 10, 20, 30]) {
    const plant = new Thuja({ seed: 1950, ageYears, dayOfYear: 200 });
    try {
      plant.setLevel(0);
      for (const [view, angle] of REVIEW_AZIMUTHS.entries()) {
        const metrics = rasterizedCoverage(plant, angle);
        for (const metric of ['recall', 'precision', 'intersectionOverUnion']) {
          assert.ok(
            metrics[metric] >= thresholds.get(ageYears)[metric],
            `age ${ageYears}, view ${view}, ${metric}: ${metrics[metric]}`,
          );
        }
        if (ageYears >= 10) {
          assert.ok(
            metrics.leakage <= 0.12,
            `age ${ageYears}, view ${view}, leakage: ${metrics.leakage}`,
          );
        }
      }
    } finally {
      plant.dispose();
    }
  }
});

test('mid and far LODs retain the mature conical silhouette', () => {
  for (const ageYears of [10, 30]) {
    const plant = new Thuja({ seed: 1950, ageYears, dayOfYear: 200 });
    try {
      for (const level of [1, 2]) {
        plant.setLevel(level);
        for (const [view, angle] of REVIEW_AZIMUTHS.entries()) {
          const metrics = rasterizedCoverage(plant, angle);
          assert.ok(
            metrics.recall >= 0.82,
            `age ${ageYears}, LOD ${level}, view ${view}, recall: ${metrics.recall}`,
          );
          assert.ok(
            metrics.precision >= 0.8,
            `age ${ageYears}, LOD ${level}, view ${view}, precision: ${metrics.precision}`,
          );
          assert.ok(
            metrics.intersectionOverUnion >= 0.7,
            `age ${ageYears}, LOD ${level}, view ${view}, IoU: ${metrics.intersectionOverUnion}`,
          );
        }
      }
    } finally {
      plant.dispose();
    }
  }
});

test('rendered foliage remains inside the declared cultivar profile', () => {
  for (const ageYears of [5, 10, 20, 30]) {
    const plant = new Thuja({ seed: 1950, ageYears, dayOfYear: 200 });
    try {
      const box = visibleBounds(plant);
      const { heightM, radiusM } = plant.stats().dimensions;
      const horizontalRatio =
        Math.max(
          Math.abs(box.min.x),
          Math.abs(box.max.x),
          Math.abs(box.min.z),
          Math.abs(box.max.z),
        ) / radiusM;
      const heightRatio = box.max.y / heightM;
      assert.ok(
        horizontalRatio <= 1.2,
        `age ${ageYears}, radius ratio ${horizontalRatio}`,
      );
      assert.ok(
        heightRatio <= (ageYears === 5 ? 1.13 : 1.1),
        `age ${ageYears}, height ratio ${heightRatio}`,
      );
      assert.ok(
        box.min.y >= -heightM * 0.05,
        `age ${ageYears}, below-ground foliage ${box.min.y}`,
      );
    } finally {
      plant.dispose();
    }
  }
});

test('LOD swaps spray geometry and thins stable IDs without erasing the cone', () => {
  const plant = new Thuja({ seed: 8, ageYears: 10, dayOfYear: 200 });
  try {
    const nearCount = organ(plant).count;
    const nearTriangles = organ(plant).geometry.index.count / 3;
    plant.setLevel(1);
    const middleCount = organ(plant).count;
    const middleTriangles = organ(plant).geometry.index.count / 3;
    plant.setLevel(2);
    const farCount = organ(plant).count;
    const farTriangles = organ(plant).geometry.index.count / 3;
    assert.ok(nearCount > middleCount && middleCount > farCount);
    assert.deepEqual([nearTriangles, middleTriangles, farTriangles], [6, 4, 2]);
    assert.ok(farCount > 0);
  } finally {
    plant.dispose();
  }
});

test('renderer matrices carry coherent scaffold wind through every pass', () => {
  const plant = new Thuja({
    seed: 'renderer-wind',
    ageYears: 10,
    dayOfYear: 200,
  });
  try {
    const mesh = organ(plant);
    const matrix = new THREE.Matrix4();
    const families = new Set();
    const crownBands = new Set();
    for (let index = 0; index < mesh.count; index += 1) {
      mesh.getMatrixAt(index, matrix);
      const metadata = readThujaWindMetadataFromMatrix(matrix);
      families.add(metadata.familyCode);
      crownBands.add(Math.round(metadata.crownFraction * 4));
      assert.ok(metadata.exposure >= 0 && metadata.exposure <= 1);
      const elements = matrix.elements;
      const width = Math.hypot(elements[0], elements[1], elements[2]);
      const length = Math.hypot(elements[4], elements[5], elements[6]);
      const metadataDepth = Math.hypot(elements[8], elements[9], elements[10]);
      assert.ok(
        metadataDepth < Math.max(width, length),
        'wind metadata inflated the instance culling radius',
      );
    }

    assert.ok(plant._leafWind instanceof ThujaWind);
    assert.ok(families.size >= 15, `only ${families.size} scaffold phases`);
    assert.ok(crownBands.size >= 4, `only ${crownBands.size} crown bands`);
    for (const material of [
      plant._materials.spray,
      plant._materials.sprayDepth,
      plant._materials.sprayDistance,
    ]) {
      assert.match(material.customProgramCacheKey(), /thuja-wind/);
    }
  } finally {
    plant.dispose();
  }
});

test('LOD removes terminal flutter and foliage shadows before crown motion', () => {
  const plant = new Thuja({ seed: 'wind-lod', ageYears: 10, dayOfYear: 200 });
  try {
    assert.equal(organ(plant).castShadow, true);
    assert.equal(organ(plant).receiveShadow, true);
    const profiles = [
      plant._leafWind.uniforms.uThujaLODNear.value,
      plant._leafWind.uniforms.uThujaLODMiddle.value,
      plant._leafWind.uniforms.uThujaLODFar.value,
    ];
    assert.deepEqual(
      profiles.map((profile) => profile.toArray()),
      THUJA_WIND_LOD_PROFILES.map((profile) => [
        profile.crown,
        profile.flutter,
      ]),
    );

    const assertMatrixLOD = (expected) => {
      const mesh = organ(plant);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        assert.equal(
          readThujaWindMetadataFromMatrix(matrix).lodLevel,
          expected,
        );
      }
    };
    assertMatrixLOD(0);

    plant.setLevel(1);
    assert.equal(organ(plant).castShadow, false);
    assert.equal(organ(plant).receiveShadow, true);
    assertMatrixLOD(1);

    plant.setLevel(2);
    assert.equal(organ(plant).castShadow, false);
    assert.equal(organ(plant).receiveShadow, true);
    assertMatrixLOD(2);
    assert.deepEqual(
      profiles.map((profile) => profile.toArray()),
      THUJA_WIND_LOD_PROFILES.map((profile) => [
        profile.crown,
        profile.flutter,
      ]),
    );
  } finally {
    plant.dispose();
  }
});

test('time scrubbing A-B-A restores exact wood, matrices and colours', () => {
  const plant = new Thuja({ seed: 'aba', ageYears: 7, dayOfYear: 140 });
  try {
    const before = state(plant);
    plant.setState({ ageYears: 3, dayOfYear: 20 });
    plant.setState({ ageYears: 7, dayOfYear: 140 });
    assert.deepEqual(state(plant), before);
  } finally {
    plant.dispose();
  }
});

test('scrubbing never replaces the mesh objects', () => {
  const plant = new Thuja({ seed: 5, ageYears: 5, dayOfYear: 200 });
  try {
    const wood = plant._woodMesh;
    const shell = plant._instancePool.mesh('shell');
    const sprays = organ(plant);
    const runtimeEntries = new Map(plant._runtime.sprays);
    for (const day of [1, 120, 160, 260, 340, 200])
      plant.setTime({ dayOfYear: day });
    for (const ageYears of [1, 10, 3, 5]) plant.setState({ ageYears });
    assert.strictEqual(plant._woodMesh, wood);
    assert.strictEqual(plant._instancePool.mesh('shell'), shell);
    assert.strictEqual(organ(plant), sprays);
    assert.equal(plant._runtime.sprays.size, runtimeEntries.size);
    for (const [id, runtime] of runtimeEntries) {
      assert.strictEqual(plant._runtime.sprays.get(id), runtime);
    }
  } finally {
    plant.dispose();
  }
});

test('the renderer accepts cultivar synonyms and rejects another thuja', () => {
  const synonym = new Thuja({ cultivar: 'Emerald Green', maxYears: 2 });
  synonym.dispose();
  assert.throws(() => new Thuja({ cultivar: 'Brabant' }), /only the Smaragd/);
});
