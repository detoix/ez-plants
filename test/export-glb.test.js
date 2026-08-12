import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { createGLBExportSnapshot, exportGLB } from '../src/lib/export-glb.js';
import * as PublicApi from '../src/lib/index.js';
import TreeOptions from '../src/lib/options.js';
import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';
import { Tree } from '../src/lib/tree.js';

const nativeFileReader = globalThis.FileReader;

class NodeFileReader {
  result = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(
      (result) => {
        this.result = result;
        this.onloadend?.({ target: this });
      },
      (error) => this.onerror?.(error),
    );
  }
}

test.before(() => {
  globalThis.FileReader = NodeFileReader;
});

test.after(() => {
  if (nativeFileReader === undefined) delete globalThis.FileReader;
  else globalThis.FileReader = nativeFileReader;
});

function parseGLB(buffer) {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'GLB magic');
  assert.equal(view.getUint32(4, true), 2, 'GLB version');
  assert.equal(view.getUint32(8, true), buffer.byteLength, 'GLB byte length');
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk type');
  const jsonBytes = new Uint8Array(buffer, 20, jsonLength);
  return JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd());
}

function findNode(json, name) {
  return json.nodes?.find((node) => node.name === name);
}

function captureMeshState(mesh) {
  return {
    parent: mesh.parent,
    visible: mesh.visible,
    geometry: mesh.geometry,
    material: mesh.material,
    matrix: [...mesh.matrix.elements],
    instanceMatrix: mesh.isInstancedMesh
      ? Array.from(mesh.instanceMatrix.array)
      : null,
    instanceColor: mesh.instanceColor
      ? Array.from(mesh.instanceColor.array)
      : null,
  };
}

function assertMeshState(mesh, expected) {
  assert.strictEqual(mesh.parent, expected.parent);
  assert.equal(mesh.visible, expected.visible);
  assert.strictEqual(mesh.geometry, expected.geometry);
  assert.strictEqual(mesh.material, expected.material);
  assert.deepEqual(mesh.matrix.elements, expected.matrix);
  if (mesh.isInstancedMesh) {
    assert.deepEqual(
      Array.from(mesh.instanceMatrix.array),
      expected.instanceMatrix,
    );
    assert.deepEqual(
      mesh.instanceColor ? Array.from(mesh.instanceColor.array) : null,
      expected.instanceColor,
    );
  }
}

function createInstanceFixture() {
  const root = new THREE.Group();
  root.name = 'CurrentPlant';
  root.position.set(2, 3, 4);
  root.userData.species = 'Test plant';
  root.userData.sculptRuntime = { maps: new Map([['private', {}]]) };

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData.branchTube = { radialSegments: 4, textureWraps: 1 };
  const missingTexture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    color: 0x456789,
    roughness: 0.72,
    vertexColors: true,
  });
  material.name = 'ExportMaterial';
  material.map = missingTexture;
  material.userData.keep = 'material-extra';
  const shader = { uniforms: {} };
  shader.self = shader;
  material.userData.shader = shader;

  const instances = new THREE.InstancedMesh(geometry, material, 4);
  instances.name = 'ActiveInstances';
  instances.count = 2;
  instances.userData.keep = 'node-extra';
  instances.userData.organCount = 41;
  instances.userData.capacity = 4;
  instances.userData.activeOrganCount = 2;
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 2, 3));
  instances.setMatrixAt(1, new THREE.Matrix4().makeScale(2, 3, 4));
  instances.setMatrixAt(2, new THREE.Matrix4().makeTranslation(99, 99, 99));
  instances.setColorAt(0, new THREE.Color(0xff0000));
  instances.setColorAt(1, new THREE.Color(0x00ff00));
  instances.setColorAt(2, new THREE.Color(0x0000ff));
  root.add(instances);

  const empty = new THREE.InstancedMesh(geometry, material, 1);
  empty.name = 'EmptyInstances';
  empty.count = 0;
  root.add(empty);

  const hidden = new THREE.Mesh(geometry, material);
  hidden.name = 'HiddenMesh';
  hidden.visible = false;
  root.add(hidden);

  return {
    root,
    geometry,
    material,
    missingTexture,
    instances,
    empty,
    hidden,
    dispose() {
      instances.dispose();
      empty.dispose();
      geometry.dispose();
      material.dispose();
      missingTexture.dispose();
    },
  };
}

test('proxy snapshots trim instance capacity, sanitize extras and own cleanup', () => {
  assert.strictEqual(PublicApi.exportGLB, exportGLB);
  const fixture = createInstanceFixture();
  const sourceState = captureMeshState(fixture.instances);
  const sourceDisposals = { geometry: 0, material: 0, mesh: 0 };
  fixture.geometry.addEventListener(
    'dispose',
    () => sourceDisposals.geometry++,
  );
  fixture.material.addEventListener(
    'dispose',
    () => sourceDisposals.material++,
  );
  fixture.instances.addEventListener('dispose', () => sourceDisposals.mesh++);

  const snapshot = createGLBExportSnapshot(fixture.root, {
    metadata: { type: 'Fixture', season: 'summer' },
  });
  const proxy = snapshot.scene.getObjectByName('ActiveInstances');
  assert.ok(proxy?.isInstancedMesh);
  assert.equal(proxy.count, 2);
  assert.equal(proxy.instanceMatrix.count, 2);
  assert.equal(proxy.instanceColor.count, 2);
  assert.notStrictEqual(proxy.geometry, fixture.geometry);
  assert.strictEqual(
    proxy.geometry.getAttribute('position'),
    fixture.geometry.getAttribute('position'),
  );
  assert.notStrictEqual(proxy.material, fixture.material);
  assert.equal(proxy.material.map, null);
  assert.strictEqual(
    proxy.material.onBeforeCompile,
    THREE.Material.prototype.onBeforeCompile,
  );
  assert.deepEqual(proxy.userData, { keep: 'node-extra' });
  assert.deepEqual(proxy.material.userData, { keep: 'material-extra' });
  assert.equal(snapshot.scene.getObjectByName('EmptyInstances'), undefined);
  assert.equal(snapshot.scene.getObjectByName('HiddenMesh'), undefined);
  assert.deepEqual(snapshot.scene.userData.ezTree, {
    schemaVersion: 1,
    exportMode: 'current-state',
    generator: '@dgreenheck/ez-tree',
    source: { type: 'Fixture', name: 'CurrentPlant' },
    snapshot: { season: 'summer', type: 'Fixture' },
  });

  const proxyDisposals = { geometry: 0, material: 0, mesh: 0 };
  proxy.geometry.addEventListener('dispose', () => proxyDisposals.geometry++);
  proxy.material.addEventListener('dispose', () => proxyDisposals.material++);
  proxy.addEventListener('dispose', () => proxyDisposals.mesh++);
  snapshot.dispose();
  snapshot.dispose();

  assert.deepEqual(proxyDisposals, { geometry: 1, material: 1, mesh: 1 });
  assert.deepEqual(sourceDisposals, { geometry: 0, material: 0, mesh: 0 });
  assertMeshState(fixture.instances, sourceState);
  assert.strictEqual(fixture.material.map, fixture.missingTexture);
  fixture.dispose();
});

test('r167 GLTFExporter emits deterministic valid active-prefix instancing', async () => {
  const fixture = createInstanceFixture();
  const children = [...fixture.root.children];
  const sourceState = captureMeshState(fixture.instances);
  const materialUserData = fixture.material.userData;
  const sourceDisposals = { geometry: 0, material: 0, mesh: 0 };
  fixture.geometry.addEventListener(
    'dispose',
    () => sourceDisposals.geometry++,
  );
  fixture.material.addEventListener(
    'dispose',
    () => sourceDisposals.material++,
  );
  fixture.instances.addEventListener('dispose', () => sourceDisposals.mesh++);

  const options = {
    metadata: { type: 'Fixture', ageYears: 4, phase: 'ripe' },
  };
  const first = await exportGLB(fixture.root, options);
  const repeated = await exportGLB(fixture.root, options);
  assert.deepEqual(new Uint8Array(repeated), new Uint8Array(first));

  const json = parseGLB(first);
  assert.ok(json.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
  assert.ok(json.extensionsRequired.includes('EXT_mesh_gpu_instancing'));
  const node = findNode(json, 'ActiveInstances');
  assert.ok(node);
  const attributes = node.extensions.EXT_mesh_gpu_instancing.attributes;
  for (const semantic of ['TRANSLATION', 'ROTATION', 'SCALE', '_COLOR_0']) {
    assert.equal(json.accessors[attributes[semantic]].count, 2, semantic);
  }
  assert.deepEqual(node.extras, { keep: 'node-extra' });
  assert.equal(findNode(json, 'EmptyInstances'), undefined);
  assert.equal(findNode(json, 'HiddenMesh'), undefined);

  const primitive = json.meshes[node.mesh].primitives[0];
  assert.deepEqual(primitive.extras.branchTube, {
    radialSegments: 4,
    textureWraps: 1,
  });
  assert.deepEqual(json.materials[primitive.material].extras, {
    keep: 'material-extra',
  });
  assert.equal(
    json.materials[primitive.material].pbrMetallicRoughness.baseColorTexture,
    undefined,
  );
  const sceneExtras = json.scenes[json.scene].extras.ezTree;
  assert.deepEqual(sceneExtras, {
    schemaVersion: 1,
    exportMode: 'current-state',
    generator: '@dgreenheck/ez-tree',
    source: { type: 'Fixture', name: 'CurrentPlant' },
    snapshot: { ageYears: 4, phase: 'ripe', type: 'Fixture' },
  });
  assert.doesNotMatch(
    JSON.stringify(json),
    /sculptRuntime|leafWindShader|"shader"|organCount|activeOrganCount|"capacity"/,
  );

  assert.deepEqual(fixture.root.children, children);
  assertMeshState(fixture.instances, sourceState);
  assert.strictEqual(fixture.material.userData, materialUserData);
  assert.strictEqual(fixture.material.map, fixture.missingTexture);
  assert.deepEqual(sourceDisposals, { geometry: 0, material: 0, mesh: 0 });
  fixture.dispose();
});

test('Blackcurrant current-state GLB preserves compact wood and snapshot data', async () => {
  const plant = new Blackcurrant({
    seed: 42,
    maxYears: 3,
    ageYears: 1,
    dayOfYear: 175,
  });
  const serialized = plant.serialize();
  const children = [...plant.children];
  const runtime = plant.userData.sculptRuntime;
  const meshes = [];
  plant.traverse((object) => {
    if (object.isMesh) meshes.push([object, captureMeshState(object)]);
  });

  const sourceDisposals = { geometry: 0, material: 0, mesh: 0 };
  const geometries = new Set(meshes.map(([mesh]) => mesh.geometry));
  const materials = new Set(
    meshes.flatMap(([mesh]) =>
      Array.isArray(mesh.material) ? mesh.material : [mesh.material],
    ),
  );
  for (const geometry of geometries) {
    geometry.addEventListener('dispose', () => sourceDisposals.geometry++);
  }
  for (const material of materials) {
    material.addEventListener('dispose', () => sourceDisposals.material++);
  }
  for (const [mesh] of meshes) {
    if (mesh.isInstancedMesh) {
      mesh.addEventListener('dispose', () => sourceDisposals.mesh++);
    }
  }

  const json = parseGLB(await exportGLB(plant));
  assert.deepEqual(json.scenes[json.scene].extras.ezTree, {
    schemaVersion: 1,
    exportMode: 'current-state',
    generator: '@dgreenheck/ez-tree',
    source: { type: 'Blackcurrant', name: plant.name },
    snapshot: serialized,
  });
  assert.doesNotMatch(
    JSON.stringify(json),
    /sculptRuntime|leafWindShader|"shader"|organCount|activeOrganCount|"capacity"/,
  );

  for (const mesh of Object.values(plant.instances)) {
    const node = findNode(json, mesh.name);
    if (mesh.count === 0) {
      assert.equal(node, undefined, `${mesh.name} should be omitted`);
      continue;
    }
    assert.ok(node, `${mesh.name} should be exported`);
    const attributes = node.extensions.EXT_mesh_gpu_instancing.attributes;
    for (const semantic of ['TRANSLATION', 'ROTATION', 'SCALE']) {
      assert.equal(json.accessors[attributes[semantic]].count, mesh.count);
    }
    if (attributes._COLOR_0 !== undefined) {
      assert.equal(json.accessors[attributes._COLOR_0].count, mesh.count);
    }
  }

  const activeWood = Object.values(plant.woodMeshes).filter(
    (mesh) => mesh.visible,
  );
  assert.ok(activeWood.length <= 3);
  for (const mesh of activeWood) {
    assert.equal(mesh.isBatchedMesh, undefined);
    const node = findNode(json, mesh.name);
    assert.ok(node, `${mesh.name} should be exported`);
    const primitive = json.meshes[node.mesh].primitives[0];
    assert.equal(
      json.accessors[primitive.indices].count,
      mesh.geometry.index.count,
    );
    assert.deepEqual(node.extras.axisRanges, mesh.userData.axisRanges);
    assert.deepEqual(
      primitive.extras.axisRanges,
      mesh.geometry.userData.axisRanges,
    );
  }

  assert.deepEqual(plant.children, children);
  assert.strictEqual(plant.userData.sculptRuntime, runtime);
  assert.equal(
    Object.getOwnPropertyDescriptor(plant.userData, 'sculptRuntime').enumerable,
    false,
  );
  for (const [mesh, state] of meshes) assertMeshState(mesh, state);
  assert.deepEqual(sourceDisposals, { geometry: 0, material: 0, mesh: 0 });
  plant.dispose();
});

test('export failures clean proxies and reject unsupported roots and batches', async () => {
  await assert.rejects(exportGLB({}), /requires a THREE\.Object3D root/);
  await assert.rejects(
    exportGLB(new THREE.Group(), { maxTextureSize: 0 }),
    /maxTextureSize must be positive/,
  );

  const batchedMaterial = new THREE.MeshBasicMaterial();
  const batched = new THREE.BatchedMesh(1, 3, 3, batchedMaterial);
  assert.throws(
    () => createGLBExportSnapshot(batched),
    /does not support THREE\.BatchedMesh/,
  );
  batched.dispose();
  batchedMaterial.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const root = new THREE.Group();
  root.add(mesh);
  const state = captureMeshState(mesh);
  const disposals = { geometry: 0, material: 0 };
  geometry.addEventListener('dispose', () => disposals.geometry++);
  material.addEventListener('dispose', () => disposals.material++);

  await assert.rejects(
    exportGLB(root),
    /Unsupported bufferAttribute component type: Float64Array/,
  );
  assertMeshState(mesh, state);
  assert.deepEqual(disposals, { geometry: 0, material: 0 });
  geometry.dispose();
  material.dispose();
});

test('ordinary EZ Tree meshes export without leaking leaf shader hooks', async () => {
  const options = new TreeOptions();
  options.seed = 8675309;
  options.bark.textured = false;
  options.branch.levels = 0;
  options.branch.length[0] = 3;
  options.branch.sections[0] = 4;
  options.branch.segments[0] = 5;
  options.branch.gnarliness[0] = 0;
  options.leaves.count = 2;
  options.leaves.size = 0.7;
  const tree = new Tree(options);
  tree.generate();

  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.phong.vertexShader,
    fragmentShader: THREE.ShaderLib.phong.fragmentShader,
  };
  tree.leavesMesh.material.onBeforeCompile(shader, null);
  assert.strictEqual(tree.leavesMesh.material.userData.leafWindShader, shader);

  const json = parseGLB(await exportGLB(tree));
  assert.equal(json.scenes[json.scene].extras.ezTree.source.type, 'Tree');
  assert.deepEqual(json.scenes[json.scene].extras.ezTree.snapshot, {
    name: 'Tree',
    type: 'Tree',
  });
  assert.equal(json.meshes.length, 2);
  assert.doesNotMatch(JSON.stringify(json), /leafWindShader|uWindStrength/);

  const materials = new Set([
    tree.branchesMesh.material,
    tree.leavesMesh.material,
    tree.leavesMesh.customDepthMaterial,
    tree.leavesMesh.customDistanceMaterial,
  ]);
  tree.branchesMesh.geometry.dispose();
  tree.leavesMesh.geometry.dispose();
  for (const material of materials) material?.dispose();
});
