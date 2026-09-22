import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTreeLeafWind } from '../src/lib/webgpu/index.js';

/** Stands in for a grown Tree: one leaf material shared by every LOD level. */
function fakeTree() {
  const leaf = new THREE.MeshStandardMaterial({
    name: 'leaves',
    roughness: 1,
    metalness: 0,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
  });
  // Exactly what LeafWind.apply installs, and exactly what WebGPU cannot run.
  leaf.onBeforeCompile = (shader) => {
    shader.vertexShader = `// patched\n${shader.vertexShader}`;
  };
  const bark = new THREE.MeshStandardMaterial({ name: 'bark' });
  const tree = new THREE.Group();
  const leaves = [0, 1, 2].map(() => {
    const level = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), leaf);
    level.add(new THREE.Mesh(new THREE.BufferGeometry(), bark), mesh);
    tree.add(level);
    return mesh;
  });
  tree.leavesMesh = leaves[0];
  return { tree, leaves, bark, leaf };
}

test('leaf materials become node materials carrying the wind', () => {
  const { tree, leaves, bark } = fakeTree();
  const node = createTreeLeafWind().applyTo(tree);
  assert.ok(node.isNodeMaterial, 'the leaf material must become a node material');
  assert.ok(node.positionNode, 'the wind must arrive as a position node');
  for (const mesh of leaves) {
    assert.equal(mesh.material, node, 'every LOD level shares the ported material');
  }
  assert.equal(bark.isNodeMaterial, undefined, 'bark is left alone');
});

test('the dead GLSL hooks do not travel with the ported material', () => {
  const { tree } = fakeTree();
  const node = createTreeLeafWind().applyTo(tree);
  assert.equal(node.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  assert.equal(node.customProgramCacheKey, THREE.Material.prototype.customProgramCacheKey);
});

test('the ported material keeps the surface the library authored', () => {
  const { tree } = fakeTree();
  const node = createTreeLeafWind().applyTo(tree);
  assert.equal(node.name, 'leaves');
  assert.equal(node.alphaTest, 0.3);
  assert.equal(node.side, THREE.DoubleSide);
  assert.equal(node.roughness, 1);
  assert.equal(node.metalness, 0);
});

test('one clock drives every tree', () => {
  const wind = createTreeLeafWind();
  const first = wind.applyTo(fakeTree().tree);
  const second = wind.applyTo(fakeTree().tree);
  assert.notEqual(first, second, 'each tree keeps its own leaf material');
  wind.setTime(12.5);
  assert.equal(wind.uniforms.time.value, 12.5);
  wind.setTime(Number.NaN);
  assert.equal(wind.uniforms.time.value, 0, 'a non-finite clock must not poison the uniform');
});

test('the dials are configurable and default to EZ-Tree values', () => {
  assert.equal(createTreeLeafWind().uniforms.frequency.value, 0.5);
  assert.equal(createTreeLeafWind().uniforms.scale.value, 70);
  const tuned = createTreeLeafWind({ frequency: 2, scale: 12, strength: new THREE.Vector3(1, 0, 0) });
  assert.equal(tuned.uniforms.frequency.value, 2);
  assert.equal(tuned.uniforms.scale.value, 12);
  assert.equal(tuned.uniforms.strength.value.x, 1);
});

test('applying twice is a no-op rather than a second swap', () => {
  const wind = createTreeLeafWind();
  const { tree } = fakeTree();
  const node = wind.applyTo(tree);
  assert.equal(wind.applyTo(tree), undefined, 'nothing left to port');
  assert.equal(tree.leavesMesh.material, node);
});

test('a tree without leaves is ignored rather than throwing', () => {
  const wind = createTreeLeafWind();
  assert.equal(wind.applyTo(new THREE.Group()), undefined);
  assert.equal(wind.applyTo(undefined), undefined);
});
