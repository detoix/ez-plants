import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { createLeafMaterialSet } from '../src/lib/leaf-material.js';
import {
  assertThujaWindPlanarGeometry,
  createThujaWindMetadata,
  decodeThujaWindMetadata,
  packThujaWindMetadata,
  readThujaWindMetadataFromMatrix,
  THUJA_WIND_LOD_PROFILES,
  ThujaWind,
  thujaWindDepthScale,
} from '../src/lib/plants/thuja/wind.js';

function compile(material, template) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

test('wind metadata is deterministic and coherent by scaffold family', () => {
  const input = {
    seed: 'wind-seed',
    familyId: 'scaffold:12',
    crownFraction: 0.73,
    shellFraction: 0.84,
    lodLevel: 2,
  };
  const first = createThujaWindMetadata(input);
  const second = createThujaWindMetadata({ ...input });
  const sibling = createThujaWindMetadata({
    ...input,
    crownFraction: 0.51,
    shellFraction: 0.35,
  });

  assert.deepEqual(second, first);
  assert.equal(sibling.familyCode, first.familyCode);
  assert.equal(sibling.phase, first.phase);
  assert.ok(first.familyCode >= 1 && first.familyCode <= 63);
  assert.ok(Math.abs(first.crownFraction - 0.73) <= 1 / 31);
  assert.ok(first.exposure > sibling.exposure);
  assert.equal(first.lodLevel, 2);

  const codes = new Set(
    Array.from(
      { length: 12 },
      (_, index) =>
        createThujaWindMetadata({
          seed: 'wind-seed',
          familyId: `scaffold:${index}`,
        }).familyCode,
    ),
  );
  assert.ok(codes.size >= 9, 'independent families need varied phases');
});

test('packed metadata survives Float32 matrices and uniform field transforms', () => {
  const metadata = createThujaWindMetadata({
    seed: 77,
    familyId: 'north-east-bough',
    crownFraction: 0.81,
    exposure: 0.92,
    lodLevel: 1,
  });
  const scale = new THREE.Vector3(
    0.18,
    0.27,
    thujaWindDepthScale(0.18, metadata),
  );
  assert.ok(
    scale.z / scale.x < 0.875,
    'metadata must stay below the visible width used by culling',
  );
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(0.21, 1.66, -0.08),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.1, -0.15)),
    scale,
  );

  // InstancedMesh stores matrices as Float32. Mirror that round trip before
  // checking the CPU decoder used by integration tests and diagnostics.
  const roundTrip = new THREE.Matrix4().fromArray(
    new Float32Array(local.elements),
  );
  const decoded = readThujaWindMetadataFromMatrix(roundTrip);
  assert.equal(decoded.familyCode, metadata.familyCode);
  assert.equal(decoded.crownFraction, metadata.crownFraction);
  assert.equal(decoded.exposure, metadata.exposure);
  assert.equal(decoded.lodLevel, 1);

  const fieldPlacement = new THREE.Matrix4().compose(
    new THREE.Vector3(8, 0, -3),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.17),
    new THREE.Vector3(1.34, 1.34, 1.34),
  );
  const placed = fieldPlacement.multiply(roundTrip);
  const fieldDecoded = readThujaWindMetadataFromMatrix(placed);
  assert.equal(fieldDecoded.familyCode, metadata.familyCode);
  assert.equal(fieldDecoded.crownFraction, metadata.crownFraction);
  assert.equal(fieldDecoded.exposure, metadata.exposure);
  assert.equal(fieldDecoded.lodLevel, 1);
});

test('pack and decode clamp biological channels but reject invalid families', () => {
  const packed = packThujaWindMetadata({
    familyCode: 14,
    crownFraction: 4,
    exposure: -2,
  });
  assert.deepEqual(decodeThujaWindMetadata(packed), {
    familyCode: 14,
    crownFraction: 1,
    exposure: 0,
    lodLevel: 0,
    phase: (14 * 0.61803398875) % 1,
    packed,
  });
  assert.throws(() => packThujaWindMetadata({ familyCode: 0 }), /familyCode/);
  assert.throws(() => packThujaWindMetadata({ familyCode: 64 }), /familyCode/);
  assert.throws(
    () => packThujaWindMetadata({ familyCode: 1, lodLevel: -1 }),
    /lodLevel/,
  );
  assert.throws(
    () => packThujaWindMetadata({ familyCode: 1, lodLevel: 3 }),
    /lodLevel/,
  );

  const lastFamily = packThujaWindMetadata({
    familyCode: 63,
    crownFraction: 1,
    exposure: 1,
    lodLevel: 2,
  });
  assert.ok(lastFamily >= 0.25 && lastFamily < 0.875);
  assert.equal(decodeThujaWindMetadata(lastFamily).familyCode, 63);
  assert.deepEqual(decodeThujaWindMetadata(1), {
    familyCode: 1,
    crownFraction: 0,
    exposure: 0,
    lodLevel: 0,
    phase: 0.61803398875,
    packed: 1,
  });
});

test('depth packing explicitly requires a perfectly planar spray', () => {
  const planar = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0.5, 0, 0, 1, 0], 3),
  );
  const cupped = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0.5, 0.001, 0, 1, 0], 3),
  );
  assert.strictEqual(assertThujaWindPlanarGeometry(planar), planar);
  assert.throws(
    () => assertThujaWindPlanarGeometry(cupped),
    /every spray position to have z=0/,
  );
  planar.dispose();
  cupped.dispose();
});

test('surface, depth and distance passes receive the identical hierarchy', () => {
  const wind = new ThujaWind({ time: 3.25, lod: 1 });
  const materials = createLeafMaterialSet({
    name: 'thuja-wind-test',
    roundedNormals: true,
    wind,
    windVariant: 'thuja-wind-test',
  });
  const surface = compile(materials.surface, THREE.ShaderLib.standard);
  const depth = compile(materials.depth, THREE.ShaderLib.depth);
  const distance = compile(materials.distance, THREE.ShaderLib.distance);
  const shaders = [surface, depth, distance];

  for (const shader of shaders) {
    assert.match(shader.vertexShader, /void thujaWindDecode/);
    assert.match(
      shader.vertexShader,
      /length\(instanceMatrix\[2\]\.xyz\) \/ thujaWindWidthScale/,
    );
    assert.match(shader.vertexShader, /float thujaWindStiffness/);
    assert.match(shader.vertexShader, /thujaWindAttachmentWeight/);
    assert.match(
      shader.vertexShader,
      /thujaWindBendWeight \*= thujaWindAttachmentWeight/,
    );
    assert.match(shader.vertexShader, /thujaWindFamilyPhase/);
    assert.match(shader.vertexShader, /smoothstep\(0\.38, 1\.0, uv\.y\)/);
    assert.match(
      shader.vertexShader,
      /vec4 mvPosition = modelViewMatrix \* thujaWindPosition/,
    );
    assert.strictEqual(shader.uniforms.uTime, wind.uniforms.uTime);
    assert.strictEqual(
      shader.uniforms.uWindStrength,
      wind.uniforms.uWindStrength,
    );
    for (const name of ['uThujaLODNear', 'uThujaLODMiddle', 'uThujaLODFar']) {
      assert.strictEqual(shader.uniforms[name], wind.uniforms[name]);
    }
    assert.match(shader.vertexShader, /thujaWindLODLevel/);
    assert.match(shader.vertexShader, /thujaWindLODResponse = uThujaLODNear/);
  }
  for (const shader of [surface, distance]) {
    assert.match(
      shader.vertexShader,
      /vec4 worldPosition = modelMatrix \* thujaWindPosition/,
    );
    assert.doesNotMatch(shader.vertexShader, /#include <worldpos_vertex>/);
  }
  assert.match(
    shaders[0].vertexShader,
    /im\[2\] = im\[2\] \* \(thujaNormalWidth \/ thujaNormalDepth\)/,
  );
  assert.doesNotMatch(
    shaders[0].vertexShader,
    /#include <defaultnormal_vertex>/,
  );

  materials.surface.dispose();
  materials.depth.dispose();
  materials.distance.dispose();
});

test('absolute time and per-instance LOD profiles stay shared without recompiling', () => {
  const wind = new ThujaWind({ time: 1.5 });
  const material = new THREE.MeshStandardMaterial();
  wind.apply(material, { variant: 'test' });
  const cacheKey = material.customProgramCacheKey();
  const responses = [
    wind.uniforms.uThujaLODNear.value,
    wind.uniforms.uThujaLODMiddle.value,
    wind.uniforms.uThujaLODFar.value,
  ];

  wind.advance(0.25);
  assert.equal(wind.time, 1.75);
  wind.advance(10, 8.5);
  assert.equal(wind.time, 8.5);
  assert.deepEqual(
    responses.map((response) => response.toArray()),
    [
      [1, 1],
      [0.82, 0.46],
      [0.62, 0],
    ],
  );
  wind.setLOD(2);
  assert.strictEqual(wind.uniforms.uThujaLODNear.value, responses[0]);
  assert.strictEqual(wind.uniforms.uThujaLODMiddle.value, responses[1]);
  assert.strictEqual(wind.uniforms.uThujaLODFar.value, responses[2]);
  assert.deepEqual(
    responses.map((response) => response.toArray()),
    [
      [1, 1],
      [0.82, 0.46],
      [0.62, 0],
    ],
  );
  assert.equal(material.customProgramCacheKey(), cacheKey);
  assert.equal(wind.lod, 2);
  assert.deepEqual(
    THUJA_WIND_LOD_PROFILES.map((profile) => [profile.crown, profile.flutter]),
    [
      [1, 1],
      [0.82, 0.46],
      [0.62, 0],
    ],
  );
  assert.throws(() => wind.setLOD(3), /LOD/);
  assert.throws(() => wind.setCrownHeight(0), /crown height/);

  material.dispose();
});
