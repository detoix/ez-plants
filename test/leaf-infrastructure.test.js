import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { Billboard } from '../src/lib/enums.js';
import {
  appendLeafCard,
  createLeafBufferGeometry,
  createLeafCardGeometry,
  createLeafGeometryData,
} from '../src/lib/leaf-geometry.js';
import { createLeafMaterialSet } from '../src/lib/leaf-material.js';
import { LeafWind } from '../src/lib/leaf-wind.js';

function compile(material, template) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

function referenceLeafCard({
  origin,
  orientation,
  width,
  length,
  billboard,
  roundedNormals,
}) {
  const data = createLeafGeometryData();
  let indexOffset = 0;
  const createCard = (rotation) => {
    const vertices = [
      new THREE.Vector3(-width / 2, length, 0),
      new THREE.Vector3(-width / 2, 0, 0),
      new THREE.Vector3(width / 2, 0, 0),
      new THREE.Vector3(width / 2, length, 0),
    ].map((vertex) =>
      vertex
        .applyEuler(new THREE.Euler(0, rotation, 0))
        .applyEuler(orientation)
        .add(origin),
    );
    for (const vertex of vertices) {
      data.verts.push(vertex.x, vertex.y, vertex.z);
    }

    const leafNormal = new THREE.Vector3(0, 0, 1).applyEuler(orientation);
    const normals = roundedNormals
      ? vertices.map((vertex) =>
          leafNormal.clone().add(vertex).sub(origin).normalize(),
        )
      : [leafNormal, leafNormal, leafNormal, leafNormal];
    for (const normal of normals) {
      data.normals.push(normal.x, normal.y, normal.z);
    }

    data.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
    data.indices.push(
      indexOffset,
      indexOffset + 1,
      indexOffset + 2,
      indexOffset,
      indexOffset + 2,
      indexOffset + 3,
    );
    indexOffset += 4;
  };

  createCard(0);
  if (billboard === Billboard.Double) createCard(Math.PI / 2);
  return data;
}

test('one unit leaf card retains EZ-Tree topology, UVs and wind anchor', () => {
  const geometry = createLeafCardGeometry({ roundedNormals: false });

  assert.deepEqual(
    Array.from(geometry.getAttribute('position').array),
    [-0.5, 1, 0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0],
  );
  assert.deepEqual(
    Array.from(geometry.getAttribute('normal').array),
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  );
  assert.deepEqual(
    Array.from(geometry.getAttribute('uv').array),
    [0, 1, 0, 0, 1, 0, 1, 1],
  );
  assert.deepEqual(Array.from(geometry.index.array), [0, 1, 2, 0, 2, 3]);
  assert.equal(geometry.getAttribute('position').count, 4);
  assert.equal(geometry.getAttribute('uv').getY(1), 0);
  assert.equal(geometry.getAttribute('uv').getY(0), 1);

  geometry.dispose();
});

test('combined leaf emission is byte-for-byte equivalent to Tree leaf cards', () => {
  const options = {
    origin: new THREE.Vector3(3, -2, 7),
    orientation: new THREE.Euler(0.31, -0.74, 0.18),
    width: 2.25,
    length: 3.5,
    billboard: Billboard.Double,
    roundedNormals: true,
  };
  const actual = createLeafGeometryData();
  const range = appendLeafCard(actual, options);
  const expected = referenceLeafCard(options);

  assert.deepEqual(actual, expected);
  assert.deepEqual(range, {
    vertexOffset: 0,
    vertexCount: 8,
    indexOffset: 0,
    indexCount: 12,
  });

  const geometry = createLeafBufferGeometry(actual);
  assert.equal(geometry.getAttribute('position').count, 8);
  assert.equal(geometry.index.count / 3, 4);
  geometry.dispose();
});

test('the unit card is directly reusable by one InstancedMesh leaf pool', () => {
  const geometry = createLeafCardGeometry();
  const material = new THREE.MeshStandardMaterial();
  const leaves = new THREE.InstancedMesh(geometry, material, 3);

  leaves.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 2, 3));
  leaves.setMatrixAt(1, new THREE.Matrix4().makeScale(2, 3, 2));
  leaves.count = 2;

  assert.strictEqual(leaves.geometry, geometry);
  assert.strictEqual(leaves.material, material);
  assert.equal(leaves.geometry.getAttribute('position').count, 4);
  assert.equal(leaves.count, 2);

  leaves.dispose();
  geometry.dispose();
  material.dispose();
});

test('leaf surfaces retain the original EZ-Tree MeshPhong contract', () => {
  const map = new THREE.Texture();
  const wind = new LeafWind({ time: 4.25 });
  const materials = createLeafMaterialSet({
    name: 'leaves',
    map,
    tint: 0x6f913f,
    alphaTest: 0.42,
    roundedNormals: true,
    wind,
    windVariant: 'test-leaves',
  });
  const original = new THREE.MeshPhongMaterial({
    name: 'leaves',
    map,
    color: new THREE.Color(0x6f913f),
    side: THREE.DoubleSide,
    alphaTest: 0.42,
    dithering: true,
  });

  assert.ok(materials.surface.isMeshPhongMaterial);
  assert.equal(materials.surface.isMeshStandardMaterial, undefined);
  assert.strictEqual(materials.surface.map, map);
  for (const property of [
    'type',
    'name',
    'side',
    'alphaTest',
    'dithering',
    'vertexColors',
    'shininess',
  ]) {
    assert.equal(materials.surface[property], original[property]);
  }
  assert.equal(materials.surface.color.getHex(), original.color.getHex());
  assert.equal(materials.surface.specular.getHex(), original.specular.getHex());
  assert.equal('metalness' in materials.surface, false);
  assert.equal('roughness' in materials.surface, false);
  assert.equal(materials.depth.name, 'test-leaves-wind-depth');
  assert.equal(materials.distance.name, 'test-leaves-wind-distance');
  assert.strictEqual(materials.depth.map, map);
  assert.strictEqual(materials.distance.map, map);
  assert.equal(materials.depth.alphaTest, 0.42);
  assert.equal(materials.distance.alphaTest, 0.42);
  assert.equal(materials.depth.side, THREE.DoubleSide);
  assert.equal(materials.distance.side, THREE.DoubleSide);

  const surface = compile(materials.surface, THREE.ShaderLib.phong);
  const depth = compile(materials.depth, THREE.ShaderLib.depth);
  const distance = compile(materials.distance, THREE.ShaderLib.distanceRGBA);
  for (const shader of [surface, depth, distance]) {
    assert.match(shader.vertexShader, /leafWindSimplex3/);
    assert.match(shader.vertexShader, /#ifdef USE_INSTANCING/);
    assert.match(
      shader.vertexShader,
      /leafWindPhasePosition = instanceMatrix \* leafWindPhasePosition/,
    );
    assert.strictEqual(shader.uniforms.uTime, wind.uniforms.uTime);
    assert.strictEqual(
      shader.uniforms.uWindStrength,
      wind.uniforms.uWindStrength,
    );
  }
  assert.equal(surface.uniforms.uCustomNormals.value, true);
  assert.match(surface.fragmentShader, /if \(!uCustomNormals\)/);
  assert.equal(wind.time, 4.25);

  materials.surface.dispose();
  materials.depth.dispose();
  materials.distance.dispose();
  original.dispose();
  map.dispose();
});
