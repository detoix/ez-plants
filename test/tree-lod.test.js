import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Tree } from '../src/lib/tree.js';
import { Billboard, TreeType } from '../src/lib/enums.js';
import TreeOptions from '../src/lib/options.js';

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

function geometryState(geometry) {
  return {
    position: Array.from(geometry.getAttribute('position').array),
    normal: Array.from(geometry.getAttribute('normal').array),
    uv: Array.from(geometry.getAttribute('uv').array),
    index: Array.from(geometry.index.array),
  };
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

function ringCenter(position, offset, radialSegments) {
  const center = new THREE.Vector3();
  for (let index = 0; index < radialSegments; index++) {
    center.x += position.getX(offset + index);
    center.y += position.getY(offset + index);
    center.z += position.getZ(offset + index);
  }
  return center.multiplyScalar(1 / radialSegments);
}

test('createGeometry reuses one skeleton and consumes no RNG', () => {
  const tree = new Tree(createSmallOptions());
  tree.generate();
  const skeleton = tree.skeleton;
  const rngState = [tree.rng.m_w, tree.rng.m_z];
  const detail = {
    sectionStride: 3,
    segmentFactor: 0.5,
    leafStride: 2,
    leafScale: 1.15,
    billboard: Billboard.Single,
  };

  const first = tree.createGeometry(detail);
  const intervening = tree.createGeometry({ sectionStride: 2, leafStride: 1 });
  const repeated = tree.createGeometry(detail);

  assert.equal(tree.skeleton, skeleton);
  assert.deepEqual([tree.rng.m_w, tree.rng.m_z], rngState);
  assert.deepEqual(
    geometryState(repeated.branches),
    geometryState(first.branches),
  );
  assert.deepEqual(geometryState(repeated.leaves), geometryState(first.leaves));

  first.branches.dispose();
  first.leaves.dispose();
  intervening.branches.dispose();
  intervening.leaves.dispose();
  repeated.branches.dispose();
  repeated.leaves.dispose();
});

test('LOD meshing keeps branch endpoints while reducing counts', () => {
  const tree = new Tree(createSmallOptions());
  tree.generate();
  const full = tree.createGeometry();
  const coarse = tree.createGeometry({
    sectionStride: 3,
    segmentFactor: 0.5,
    leafStride: 2,
    leafScale: 1,
    billboard: Billboard.Single,
  });

  assert.equal(full.branches.getAttribute('position').count, 63);
  assert.equal(full.branches.index.count / 3, 96);
  assert.equal(coarse.branches.getAttribute('position').count, 15);
  assert.equal(coarse.branches.index.count / 3, 16);
  assert.equal(full.leaves.getAttribute('position').count, 40);
  assert.equal(coarse.leaves.getAttribute('position').count, 12);

  const sections = tree.skeleton.branches[0].sections;
  const coarsePosition = coarse.branches.getAttribute('position');
  const baseCenter = ringCenter(coarsePosition, 0, 4);
  const tipCenter = ringCenter(coarsePosition, 10, 4);
  assert.ok(baseCenter.distanceTo(sections[0].origin) < 1e-6);
  assert.ok(tipCenter.distanceTo(sections.at(-1).origin) < 1e-6);

  full.branches.dispose();
  full.leaves.dispose();
  coarse.branches.dispose();
  coarse.leaves.dispose();
});

test('generateLODs shares bark and Phong wind-shadow materials across levels', () => {
  const tree = new Tree(createSmallOptions());
  tree.generateLODs([
    {
      distance: 20,
      hysteresis: 0.1,
      detail: { sectionStride: 3, leafStride: 2 },
    },
    { distance: 0, detail: {} },
  ]);

  assert.ok(tree.lod?.isLOD);
  assert.deepEqual(
    tree.lod.levels.map((level) => level.distance),
    [0, 20],
  );
  const [nearBranches, nearLeaves] = tree.lod.levels[0].object.children;
  const [farBranches, farLeaves] = tree.lod.levels[1].object.children;
  assert.ok(nearBranches.material.isMeshStandardMaterial);
  assert.ok(nearLeaves.material.isMeshPhongMaterial);
  assert.equal(nearBranches.material, farBranches.material);
  assert.equal(nearLeaves.material, farLeaves.material);
  assert.equal(nearLeaves.customDepthMaterial, farLeaves.customDepthMaterial);
  assert.equal(
    nearLeaves.customDistanceMaterial,
    farLeaves.customDistanceMaterial,
  );
  assert.ok(
    farBranches.geometry.index.count < nearBranches.geometry.index.count,
  );

  tree.generate();
  assert.equal(tree.lod, null);
  assert.equal(tree.branchesMesh.parent, tree);
  assert.equal(tree.leavesMesh.parent, tree);
});

test('deciduous level-one trees never divide section length by zero', () => {
  const tree = new Tree(createSmallOptions({ levels: 1 }));
  tree.generate();
  assert.ok(tree.skeleton.branches.length > 1);
  assertFiniteGeometry(tree.branchesMesh.geometry);
  assertFiniteGeometry(tree.leavesMesh.geometry);
});

test('normal deciduous presets remain finite after the enum-condition fix', () => {
  const tree = new Tree();
  tree.loadPreset('Bush 1');
  assert.equal(tree.options.type, TreeType.Deciduous);
  assert.ok(tree.skeleton.branches.length > 1);
  assertFiniteGeometry(tree.branchesMesh.geometry);
  assertFiniteGeometry(tree.leavesMesh.geometry);
});
