import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Billboard, TreeType } from '../src/lib/enums.js';
import TreeOptions from '../src/lib/options.js';
import { Tree } from '../src/lib/tree.js';

function createSmallOptions({ levels = 0 } = {}) {
  const options = new TreeOptions();
  options.seed = 8675309;
  options.type = TreeType.Deciduous;
  options.bark.textured = false;
  options.branch.levels = levels;
  options.branch.force.strength = 0;
  options.branch.length[0] = 6;
  options.branch.radius[0] = 1;
  options.branch.sections[0] = 6;
  options.branch.segments[0] = 8;
  options.branch.gnarliness[0] = 0.08;
  options.branch.twist[0] = 0;
  options.branch.taper[0] = 0.7;

  options.branch.length[1] = 2;
  options.branch.radius[1] = 0.35;
  options.branch.sections[1] = 3;
  options.branch.segments[1] = 5;
  options.branch.gnarliness[1] = 0.04;
  options.branch.twist[1] = 0;
  options.branch.taper[1] = 0.75;
  options.branch.children[0] = 1;
  options.branch.start[1] = 0.45;
  options.branch.angle[1] = 50;

  options.leaves.count = 4;
  options.leaves.size = 1;
  options.leaves.sizeVariance = 0.2;
  options.leaves.billboard = Billboard.Double;
  return options;
}

function assertFiniteGeometry(geometry) {
  for (const attributeName of ['position', 'normal', 'uv']) {
    const values = geometry.getAttribute(attributeName).array;
    assert.ok(
      values.every(Number.isFinite),
      `${attributeName} must contain only finite values`,
    );
  }
}

function compile(material, template) {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(template.uniforms),
    vertexShader: template.vertexShader,
    fragmentShader: template.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}

test('Tree exposes the v2 skeleton and LOD API', () => {
  const tree = new Tree(createSmallOptions());

  for (const method of [
    'generate',
    'generateLODs',
    'createGeometry',
    'generateChildBranches',
    'generateLeaves',
    'shuffledIndices',
  ]) {
    assert.equal(typeof tree[method], 'function', method);
  }
  for (const removed of [
    'generateBranch',
    'generateLeaf',
    'generateBranchIndices',
  ]) {
    assert.equal(removed in tree, false, removed);
  }

  assert.deepEqual(Tree.defaultLODLevels, [
    { distance: 0, detail: {} },
    {
      distance: 100,
      hysteresis: 0.05,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.75,
        leafStride: 2,
        leafScale: 1.25,
      },
    },
    {
      distance: 250,
      hysteresis: 0.05,
      detail: {
        sectionStride: 6,
        segmentFactor: 0.4,
        leafStride: 2,
        leafScale: 1.3,
        billboard: Billboard.Single,
      },
    },
  ]);
  assert.equal(tree.lod, null);
  assert.equal(tree.skeleton, null);
});

test('generate builds one deterministic v2 skeleton and mesh pair', () => {
  const tree = new Tree(createSmallOptions());
  assert.equal(tree.generate(), undefined);

  assert.ok(tree.skeleton);
  assert.equal(tree.children.length, 2);
  assert.strictEqual(tree.children[0], tree.branchesMesh);
  assert.strictEqual(tree.children[1], tree.leavesMesh);
  assert.equal(tree.branchesMesh.geometry.getAttribute('position').count, 63);
  assert.equal(tree.branchesMesh.geometry.index.count / 3, 96);
  assert.equal(tree.leavesMesh.geometry.getAttribute('position').count, 40);
  assert.equal(tree.vertexCount, 103);
  assert.equal(tree.triangleCount, 116);
  assertFiniteGeometry(tree.branchesMesh.geometry);
  assertFiniteGeometry(tree.leavesMesh.geometry);

  const positions = Array.from(
    tree.branchesMesh.geometry.getAttribute('position').array,
  );
  tree.generate();
  assert.deepEqual(
    Array.from(tree.branchesMesh.geometry.getAttribute('position').array),
    positions,
  );
});

test('createGeometry remeshes the existing skeleton without mutating Tree meshes', () => {
  const tree = new Tree(createSmallOptions());
  tree.generate();
  const originalBranches = tree.branchesMesh.geometry;
  const originalLeaves = tree.leavesMesh.geometry;
  const skeleton = tree.skeleton;

  const geometry = tree.createGeometry({
    sectionStride: 3,
    segmentFactor: 0.5,
    leafStride: 2,
    leafScale: 1.2,
    billboard: Billboard.Single,
  });

  assert.strictEqual(tree.skeleton, skeleton);
  assert.strictEqual(tree.branchesMesh.geometry, originalBranches);
  assert.strictEqual(tree.leavesMesh.geometry, originalLeaves);
  assert.equal(geometry.branches.getAttribute('position').count, 15);
  assert.equal(geometry.leaves.getAttribute('position').count, 12);
  assert.ok(geometry.branches.index.count < originalBranches.index.count);
  assert.ok(geometry.leaves.index.count < originalLeaves.index.count);
  assertFiniteGeometry(geometry.branches);
  assertFiniteGeometry(geometry.leaves);
  geometry.branches.dispose();
  geometry.leaves.dispose();

  assert.throws(
    () => tree.createGeometry({ segmentFactor: 0 }),
    /segmentFactor must be a positive finite number/,
  );
  assert.throws(
    () => tree.createGeometry({ billboard: 'triple' }),
    /Unknown leaf billboard mode/,
  );
});

test('generateLODs shares v2 PBR surfaces and synchronized wind shadows', () => {
  const options = createSmallOptions();
  const maps = {
    color: new THREE.Texture(),
    ao: new THREE.Texture(),
    normal: new THREE.Texture(),
    roughness: new THREE.Texture(),
  };
  options.bark.textured = true;
  options.bark.maps = maps;
  options.bark.textureScale.x = 2;
  options.bark.textureScale.y = 5;
  const tree = new Tree(options);
  tree.generateLODs();

  assert.ok(tree.lod.isLOD);
  assert.equal(tree.lod.levels.length, 3);
  const branchMeshes = tree.lod.levels.map(({ object }) => object.children[0]);
  const leafMeshes = tree.lod.levels.map(({ object }) => object.children[1]);
  assert.ok(branchMeshes[0].material.isMeshStandardMaterial);
  assert.ok(leafMeshes[0].material.isMeshStandardMaterial);
  for (const mesh of branchMeshes) {
    assert.strictEqual(mesh.material, branchMeshes[0].material);
  }
  for (const mesh of leafMeshes) {
    assert.strictEqual(mesh.material, leafMeshes[0].material);
    assert.strictEqual(
      mesh.customDepthMaterial,
      leafMeshes[0].customDepthMaterial,
    );
    assert.strictEqual(
      mesh.customDistanceMaterial,
      leafMeshes[0].customDistanceMaterial,
    );
  }
  assert.strictEqual(branchMeshes[0].material.map, maps.color);
  assert.strictEqual(branchMeshes[0].material.aoMap, maps.ao);
  assert.strictEqual(branchMeshes[0].material.normalMap, maps.normal);
  assert.strictEqual(branchMeshes[0].material.roughnessMap, maps.roughness);
  assert.deepEqual(maps.color.repeat.toArray(), [1, 0.2]);
  assert.equal(
    Math.max(...branchMeshes[0].geometry.getAttribute('uv').array),
    2,
  );
  assert.ok(leafMeshes[0].customDepthMaterial.isMeshDepthMaterial);
  assert.ok(leafMeshes[0].customDistanceMaterial.isMeshDistanceMaterial);

  const surfaceShader = compile(
    leafMeshes[0].material,
    THREE.ShaderLib.standard,
  );
  const depthShader = compile(
    leafMeshes[0].customDepthMaterial,
    THREE.ShaderLib.depth,
  );
  const distanceShader = compile(
    leafMeshes[0].customDistanceMaterial,
    THREE.ShaderLib.distance,
  );
  tree.update(7.5);
  for (const shader of [surfaceShader, depthShader, distanceShader]) {
    assert.equal(shader.uniforms.uTime.value, 7.5);
    assert.match(shader.vertexShader, /leafWindSimplex3/);
  }

  tree.generate();
  assert.equal(tree.lod, null);
  assert.equal(tree.children.length, 2);
  assert.strictEqual(tree.children[0], tree.branchesMesh);
  assert.strictEqual(tree.children[1], tree.leavesMesh);
});

test('branch growth remains finite at every level and for a preset', () => {
  const levelZero = new Tree(createSmallOptions({ levels: 0 }));
  levelZero.generate();
  assertFiniteGeometry(levelZero.branchesMesh.geometry);

  const levelOne = new Tree(createSmallOptions({ levels: 1 }));
  levelOne.generate();
  assertFiniteGeometry(levelOne.branchesMesh.geometry);
  assertFiniteGeometry(levelOne.leavesMesh.geometry);

  const preset = new Tree();
  preset.loadPreset('Bush 1');
  assert.equal(preset.options.type, TreeType.Deciduous);
  assertFiniteGeometry(preset.branchesMesh.geometry);
  assertFiniteGeometry(preset.leavesMesh.geometry);
});
