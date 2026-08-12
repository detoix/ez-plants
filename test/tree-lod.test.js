import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Branch } from '../src/lib/branch.js';
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

test('Tree restores the committed public generation API without LOD residue', () => {
  const tree = new Tree(createSmallOptions());
  for (const method of [
    'generateBranch',
    'generateChildBranches',
    'generateLeaves',
    'generateLeaf',
    'shuffledIndices',
    'generateBranchIndices',
  ]) {
    assert.equal(typeof tree[method], 'function', method);
  }

  assert.equal('generateLODs' in tree, false);
  assert.equal('createGeometry' in tree, false);
  assert.equal('defaultLODLevels' in Tree, false);
  assert.equal('lod' in tree, false);
  assert.equal('skeleton' in tree, false);
});

test('generate uses shared Uint32-safe buffers with committed Tree topology', () => {
  const tree = new Tree(createSmallOptions());
  assert.equal(tree.generate(), undefined);

  assert.equal(tree.branchesMesh.geometry.getAttribute('position').count, 63);
  assert.equal(tree.branchesMesh.geometry.index.count / 3, 96);
  assert.equal(tree.leavesMesh.geometry.getAttribute('position').count, 40);
  assert.equal(tree.vertexCount, 103);
  assert.equal(tree.triangleCount, 116);
  assertFiniteGeometry(tree.branchesMesh.geometry);
  assertFiniteGeometry(tree.leavesMesh.geometry);
});

test('public generation helpers still mutate caller-visible Tree buffers', () => {
  const options = createSmallOptions();
  options.leaves.billboard = Billboard.Single;
  options.leaves.sizeVariance = 0;
  const tree = new Tree(options);
  tree.branches = { verts: [], normals: [], indices: [], uvs: [] };
  tree.leaves = { verts: [], normals: [], indices: [], uvs: [] };
  tree.rng = { random: (maximum = 1, minimum = 0) => (maximum + minimum) / 2 };

  tree.generateLeaf(new THREE.Vector3(), new THREE.Euler());
  assert.equal(tree.leaves.verts.length, 12);
  assert.equal(tree.leaves.indices.length, 6);

  const branch = new Branch(
    new THREE.Vector3(),
    new THREE.Euler(),
    2,
    0.5,
    0,
    2,
    4,
  );
  tree.generateBranch(branch);
  assert.equal(tree.branches.verts.length, 45);
  assert.equal(tree.branches.indices.length, 48);
});

test('Tree retains original Phong bark and shared Phong wind-shadow leaves', () => {
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
  tree.generate();

  assert.ok(tree.branchesMesh.material.isMeshPhongMaterial);
  assert.equal(tree.branchesMesh.material.isMeshStandardMaterial, undefined);
  assert.strictEqual(tree.branchesMesh.material.map, maps.color);
  assert.strictEqual(tree.branchesMesh.material.aoMap, maps.ao);
  assert.strictEqual(tree.branchesMesh.material.normalMap, maps.normal);
  assert.strictEqual(tree.branchesMesh.material.roughnessMap, maps.roughness);
  assert.deepEqual(maps.color.repeat.toArray(), [1, 0.2]);

  assert.ok(tree.leavesMesh.material.isMeshPhongMaterial);
  assert.ok(tree.leavesMesh.customDepthMaterial?.isMeshDepthMaterial);
  assert.ok(tree.leavesMesh.customDistanceMaterial?.isMeshDistanceMaterial);
  const before = tree._leafWind.time;
  tree.update(7.5);
  assert.notEqual(tree._leafWind.time, before);
  assert.equal(tree._leafWind.time, 7.5);
});

test('committed branch length behavior is explicit and finite at all levels', () => {
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
