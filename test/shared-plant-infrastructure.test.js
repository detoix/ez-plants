import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';

import {
  createLeafWindShadowMaterials,
  LeafWind,
} from '../src/lib/leaf-wind.js';
import {
  createLimelightModel,
  createLynwoodModel,
  createMalepartusModel,
  evaluateLimelightModel,
  evaluateLynwoodModel,
  evaluateMalepartusModel,
} from '../src/lib/index.js';
import {
  keyedInteger,
  keyedRandom,
  keyedRange,
} from '../src/lib/keyed-random.js';
import {
  samplePlantDetailSections,
  stablePlantOrganDetailScale,
} from '../src/lib/plant-detail.js';
import { PlantInstancePool } from '../src/lib/plant-instance-pool.js';
import {
  composeSegmentMatrix,
  createUnitStemGeometry,
  makeBasisQuaternion,
  vector,
} from '../src/lib/plant-transforms.js';
import { ResourceTracker } from '../src/lib/resource-tracker.js';
import { Blackcurrant } from '../src/lib/plants/blackcurrant/blackcurrant.js';
import { Forsythia } from '../src/lib/plants/forsythia/forsythia.js';
import { Hydrangea } from '../src/lib/plants/hydrangea/hydrangea.js';
import { Miscanthus } from '../src/lib/plants/miscanthus/miscanthus.js';

test('shared detail sampling preserves endpoints and explicit landmarks', () => {
  const sections = Array.from({ length: 7 }, (_, index) => ({
    origin: new THREE.Vector3(index, index * index, 0),
    tangent: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(1, 0, 0),
    binormal: new THREE.Vector3(0, 0, -1),
    radius: 1 - index / 7,
  }));

  const strided = samplePlantDetailSections(sections, 4);
  assert.deepEqual(strided.positions, [0, 4 / 6, 1]);
  assert.strictEqual(strided.sections[0], sections[0]);
  assert.strictEqual(strided.sections[1], sections[4]);
  assert.strictEqual(strided.sections[2], sections[6]);

  const landmarkSection = {
    origin: new THREE.Vector3(9, 8, 7),
    tangent: new THREE.Vector3(0, 1, 0),
    normal: new THREE.Vector3(1, 0, 0),
    binormal: new THREE.Vector3(0, 0, -1),
    radius: 0.25,
  };
  const landmarked = samplePlantDetailSections(sections, 4, [
    { position: 0.25, section: landmarkSection },
  ]);
  assert.deepEqual(landmarked.positions, [0, 0.25, 4 / 6, 1]);
  assert.strictEqual(landmarked.sections[1].origin, landmarkSection.origin);
  assert.notStrictEqual(landmarked.sections[0], sections[0]);
  assert.deepEqual(landmarked.sections[0].origin.toArray(), [0, 0, 0]);
  assert.deepEqual(landmarked.sections.at(-1).origin.toArray(), [6, 36, 0]);
});

test('shared organ detail culling is stable by ID and returns its scale', () => {
  const ids = ['leaf:1', 'leaf:2', 'leaf:3', 'leaf:4', 'leaf:5', 'leaf:6'];
  const scales = ids.map((id) =>
    stablePlantOrganDetailScale('stable-detail', id, 3, 1.4, 'leaf-channel'),
  );

  assert.deepEqual(scales, [0, 0, 0, 1.4, 0, 0]);
  assert.equal(
    stablePlantOrganDetailScale('stable-detail', 'leaf:1', 1, 1.25),
    1.25,
  );
  assert.equal(
    stablePlantOrganDetailScale(
      'stable-detail',
      'leaf:4',
      3,
      1.4,
      'leaf-channel',
    ),
    1.4,
  );
});

test('leaf wind does not add diagnostics to material userData', () => {
  const material = new THREE.MeshStandardMaterial();
  const wind = new LeafWind();
  wind.apply(material);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };

  material.onBeforeCompile(shader, null);

  assert.deepEqual(material.userData, {});
  material.dispose();
});

test('shared leaf wind preserves one coherent direction across rotated clones', () => {
  const material = new THREE.MeshStandardMaterial();
  const wind = new LeafWind();
  wind.apply(material);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, null);

  assert.match(
    shader.vertexShader,
    /vec3 leafWindLocalStrength = uWindStrength/,
  );
  assert.match(
    shader.vertexShader,
    /#else\s*\/\/ Keep EZ-Tree's original baked-geometry path literally unchanged\.\s*transformed \+= uv\.y \* uWindStrength \* leafWindSignal;/,
  );
  assert.match(
    shader.vertexShader,
    /leafWindLocalStrength = leafWindCounterRotate\(\s*instanceMatrix/,
  );
  assert.match(
    shader.vertexShader,
    /leafWindLocalStrength = leafWindCounterRotate\(\s*batchingMatrix/,
  );
  assert.ok(
    shader.vertexShader.indexOf('instanceMatrix,') <
      shader.vertexShader.indexOf(
        'batchingMatrix,',
        shader.vertexShader.indexOf('instanceMatrix,'),
      ),
  );

  const counterRotate = (matrix, direction) => {
    const elements = matrix.elements;
    const axisX = new THREE.Vector3(
      elements[0],
      elements[1],
      elements[2],
    ).normalize();
    const axisY = new THREE.Vector3(
      elements[4],
      elements[5],
      elements[6],
    ).normalize();
    const axisZ = new THREE.Vector3(
      elements[8],
      elements[9],
      elements[10],
    ).normalize();
    return new THREE.Vector3(
      axisX.dot(direction),
      axisY.dot(direction),
      axisZ.dot(direction),
    );
  };
  const projectedDirection = (matrix, localDirection) =>
    localDirection
      .clone()
      .applyMatrix3(new THREE.Matrix3().setFromMatrix4(matrix));
  const strength = wind.uniforms.uWindStrength.value;
  const identity = new THREE.Matrix4();

  // Identity clone math is exact, while non-cloned shader builds retain the
  // original source expression in their preprocessor branch above.
  assert.deepEqual(
    counterRotate(identity, strength).toArray(),
    strength.toArray(),
  );

  const scale = 0.17;
  const rotations = [
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, -1.1, 0.35)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, 2.2, -0.8)),
  ];
  const expected = strength.clone().multiplyScalar(scale);
  for (const rotation of rotations) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(3, 4, 5),
      rotation,
      new THREE.Vector3(scale, scale, scale),
    );
    const actual = projectedDirection(matrix, counterRotate(matrix, strength));
    assert.ok(actual.distanceTo(expected) < 1e-12);
  }

  material.dispose();
});

test('surface and animated shadow passes share the corrected leaf wind', () => {
  const wind = new LeafWind({ time: 4.25 });
  const surface = new THREE.MeshStandardMaterial();
  wind.apply(surface, { variant: 'test-surface' });
  const shadows = createLeafWindShadowMaterials(wind, {
    variant: 'test-shadow',
  });
  const compile = (material, template) => {
    const shader = {
      uniforms: THREE.UniformsUtils.clone(template.uniforms),
      vertexShader: template.vertexShader,
      fragmentShader: template.fragmentShader,
    };
    material.onBeforeCompile(shader, null);
    return shader;
  };
  const shaders = [
    compile(surface, THREE.ShaderLib.standard),
    compile(shadows.depth, THREE.ShaderLib.depth),
    compile(shadows.distance, THREE.ShaderLib.distance),
  ];

  for (const shader of shaders) {
    assert.match(shader.vertexShader, /vec3 leafWindCounterRotate/);
    assert.match(shader.vertexShader, /uv\.y \* leafWindLocalStrength/);
    assert.strictEqual(shader.uniforms.uTime, wind.uniforms.uTime);
    assert.strictEqual(
      shader.uniforms.uWindStrength,
      wind.uniforms.uWindStrength,
    );
    assert.equal(shader.uniforms.uTime.value, 4.25);
  }

  surface.dispose();
  shadows.depth.dispose();
  shadows.distance.dispose();
});

test('shared keyed randomness preserves the blackcurrant model hash', () => {
  assert.equal(keyedRandom(20260811, 'cane:1', 'azimuth'), 0.32412012992426753);
  assert.equal(keyedRandom('garden-a', 'leaf:7', 'size'), 0.6873900594655424);
  assert.equal(keyedRandom(0, ''), 0.10165063221938908);
  assert.notEqual(keyedRandom(42, 'a|b', 'c'), keyedRandom(42, 'a', 'b|c'));

  const sample = keyedRandom('range', 'organ');
  assert.equal(keyedRange('range', ['organ'], -2, 6), -2 + sample * 8);
  const integer = keyedInteger('integer', ['organ'], 3, 7);
  assert.ok(integer >= 3 && integer <= 7);
  assert.equal(integer, keyedInteger('integer', ['organ'], 3, 7));
});

test('shared plant transforms preserve ownership, basis and segment endpoints', () => {
  const source = new THREE.Vector3(1, 2, 3);
  const owned = vector(source);
  assert.deepEqual(owned.toArray(), [1, 2, 3]);
  assert.notStrictEqual(owned, source);
  assert.deepEqual(vector([4, 5, 6]).toArray(), [4, 5, 6]);
  assert.deepEqual(vector({ x: 7, y: 8, z: 9 }).toArray(), [7, 8, 9]);

  const forward = new THREE.Vector3(1, 1, 0).normalize();
  const preferredNormal = new THREE.Vector3(0, 0, 1);
  const basis = makeBasisQuaternion(forward, preferredNormal);
  assert.ok(
    new THREE.Vector3(0, 1, 0).applyQuaternion(basis).distanceTo(forward) <
      1e-12,
  );
  assert.ok(
    new THREE.Vector3(0, 0, 1)
      .applyQuaternion(basis)
      .distanceTo(preferredNormal) < 1e-12,
  );

  const start = new THREE.Vector3(2, 3, 4);
  const end = new THREE.Vector3(5, 7, 9);
  const radius = 0.25;
  const target = new THREE.Object3D();
  const matrix = composeSegmentMatrix(target, start, end, radius);
  assert.ok(
    new THREE.Vector3(0, 0, 0).applyMatrix4(matrix).distanceTo(start) < 1e-12,
  );
  assert.ok(
    new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).distanceTo(end) < 1e-12,
  );
  assert.ok(
    Math.abs(
      new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).distanceTo(start) -
        radius,
    ) < 1e-12,
  );

  const collapsed = new THREE.Object3D();
  composeSegmentMatrix(collapsed, start, start, radius);
  assert.deepEqual(collapsed.position.toArray(), start.toArray());
  assert.deepEqual(collapsed.scale.toArray(), [0, 0, 0]);

  const stem = createUnitStemGeometry(5);
  stem.computeBoundingBox();
  assert.ok(Math.abs(stem.boundingBox.min.y) < 1e-12);
  assert.ok(Math.abs(stem.boundingBox.max.y - 1) < 1e-12);
  stem.dispose();
});

test('plant instance pools preserve compact cursors and dirty active prefixes', () => {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const pool = new PlantInstancePool({ capacities: { leaves: 2, empty: 0 } });
  const leaves = pool.add('leaves', {
    name: 'Leaves',
    geometry,
    material,
    group,
  });
  const empty = pool.add('empty', {
    name: 'Empty',
    geometry,
    material,
    group,
  });

  assert.equal(leaves.instanceMatrix.usage, THREE.DynamicDrawUsage);
  assert.equal(leaves.frustumCulled, false);
  assert.equal(leaves.castShadow, true);
  assert.equal(leaves.receiveShadow, true);
  assert.equal(leaves.count, 0);
  assert.equal(leaves.instanceMatrix.array.length, 32);
  assert.equal(empty.instanceMatrix.array.length, 16);
  assert.deepEqual(group.children, [leaves, empty]);

  pool.beginFrame();
  const firstIdentity = Object.freeze({
    plantId: 'plant-a',
    organId: 'leaf-a',
    kind: 'leaf',
  });
  const secondIdentity = Object.freeze({
    plantId: 'plant-b',
    organId: 'leaf-a',
    kind: 'leaf',
  });
  const first = pool.write(
    'leaves',
    firstIdentity,
    new THREE.Matrix4().makeTranslation(1, 2, 3),
    new THREE.Color(0xff0000),
  );
  const second = pool.write(
    'leaves',
    secondIdentity,
    new THREE.Matrix4().makeTranslation(4, 5, 6),
    new THREE.Color(0x00ff00),
  );
  assert.deepEqual([first, second], [0, 1]);
  assert.strictEqual(pool.identityFor(leaves, first), firstIdentity);
  assert.strictEqual(pool.identityFor(leaves, second), secondIdentity);
  assert.equal(pool.identityFor(empty, first), null);
  assert.equal(pool.identityFor(new THREE.Object3D(), first), null);
  assert.throws(
    () => pool.allocate('leaves'),
    /Leaves active instance capacity exceeded \(2\)/,
  );
  assert.throws(
    () => pool.allocate('empty'),
    /Empty active instance capacity exceeded \(0\)/,
  );

  pool.commitFrame();

  assert.equal(leaves.count, 2);
  assert.deepEqual(leaves.instanceMatrix.updateRanges, [
    { start: 0, count: 32 },
  ]);
  assert.deepEqual(leaves.instanceColor.updateRanges, [{ start: 0, count: 6 }]);

  pool.beginFrame();
  assert.equal(pool.identityFor(leaves, first), null);
  const only = pool.write(
    'leaves',
    null,
    new THREE.Matrix4().makeTranslation(7, 8, 9),
    new THREE.Color(0x0000ff),
  );
  pool.commitFrame();
  assert.equal(leaves.count, 1);
  assert.deepEqual(leaves.instanceMatrix.updateRanges, [
    { start: 0, count: 16 },
  ]);
  assert.deepEqual(leaves.instanceColor.updateRanges, [{ start: 0, count: 3 }]);

  leaves.dispose();
  empty.dispose();
  geometry.dispose();
  material.dispose();
});

test('resource tracker disposes every unique renderer allocation exactly once', () => {
  const tracker = new ResourceTracker();
  const geometry = tracker.trackGeometry(new THREE.BoxGeometry(1, 1, 1));
  const material = tracker.trackMaterial(new THREE.MeshBasicMaterial());
  const shadowMaterial = tracker.trackMaterial(new THREE.MeshDepthMaterial());
  const mesh = tracker.trackInstancedMesh(
    new THREE.InstancedMesh(geometry, material, 2),
  );

  const disposalCounts = { geometry: 0, material: 0, shadow: 0, mesh: 0 };
  geometry.addEventListener('dispose', () => disposalCounts.geometry++);
  material.addEventListener('dispose', () => disposalCounts.material++);
  shadowMaterial.addEventListener('dispose', () => disposalCounts.shadow++);
  mesh.addEventListener('dispose', () => disposalCounts.mesh++);

  tracker.dispose();
  tracker.dispose();
  assert.deepEqual(disposalCounts, {
    geometry: 1,
    material: 1,
    shadow: 1,
    mesh: 1,
  });
  assert.equal(tracker.instancedMeshes.size, 0);
  assert.equal(tracker.geometries.size, 0);
  assert.equal(tracker.materials.size, 0);
  assert.throws(
    () => tracker.trackMaterial(new THREE.MeshBasicMaterial()),
    /after disposal/,
  );
});

test('resource tracker replaces geometry with exact-once ownership', () => {
  const tracker = new ResourceTracker();
  const oldGeometry = tracker.trackGeometry(new THREE.BoxGeometry(1, 1, 1));
  const mesh = new THREE.Mesh(oldGeometry, new THREE.MeshBasicMaterial());
  const replacement = new THREE.SphereGeometry(1, 6, 4);
  let oldDisposals = 0;
  let replacementDisposals = 0;
  oldGeometry.addEventListener('dispose', () => oldDisposals++);
  replacement.addEventListener('dispose', () => replacementDisposals++);

  assert.strictEqual(tracker.replaceGeometry(mesh, replacement), replacement);
  assert.strictEqual(mesh.geometry, replacement);
  assert.equal(oldDisposals, 1);
  assert.equal(tracker.geometries.has(oldGeometry), false);
  assert.equal(tracker.geometries.has(replacement), true);
  assert.equal(tracker.releaseGeometry(oldGeometry), false);
  assert.equal(oldDisposals, 1);

  assert.strictEqual(tracker.replaceGeometry(mesh, replacement), replacement);
  assert.equal(replacementDisposals, 0);
  tracker.dispose();
  tracker.dispose();
  assert.equal(oldDisposals, 1);
  assert.equal(replacementDisposals, 1);
  mesh.material.dispose();
});

test('every plant keeps renderer internals off its public surface', () => {
  const plants = [
    new Blackcurrant({ seed: 'surface', maxYears: 8, ageYears: 5 }),
    new Forsythia({ seed: 'surface', maxYears: 8, ageYears: 5 }),
    new Hydrangea({ seed: 'surface', maxYears: 8, ageYears: 5 }),
    new Miscanthus({ seed: 'surface', maxYears: 8, ageYears: 5 }),
  ];

  for (const plant of plants) {
    const leaked = Object.keys(plant).filter((key) => key.startsWith('_'));
    assert.deepEqual(leaked, [], `${plant.name} leaked ${leaked.join(', ')}`);

    // The protected slots still exist and still work; they are simply not
    // enumerable, so spreading a plant copies its state and not its machinery.
    assert.equal(typeof plant.stats(), 'object');
    assert.deepEqual(Object.keys({ ...plant }), Object.keys(plant));

    plant.dispose();
  }
});

test('the model layer imports no Three.js', () => {
  // Library rule 7: models are plain data, so a snapshot can be serialised,
  // diffed and tested without a renderer. `growWoodyAxis` accepts plain
  // `{x, y, z}` records precisely so a model never has to reach for a
  // Vector3 to describe where an axis starts.
  const models = readdirSync(new URL('../src/lib/plants/', import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(models.length >= 4, 'expected every plant to be scanned');
  for (const plant of models) {
    const source = readFileSync(
      new URL(`../src/lib/plants/${plant}/model.js`, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /from 'three'/,
      `${plant}/model.js must not import Three.js`,
    );
    assert.doesNotMatch(
      source,
      /\bTHREE\./,
      `${plant}/model.js must not construct Three.js objects`,
    );
  }
});

test('an evaluated snapshot survives a JSON round-trip unchanged', () => {
  for (const [create, evaluate] of [
    [createLynwoodModel, evaluateLynwoodModel],
    [createLimelightModel, evaluateLimelightModel],
    [createMalepartusModel, evaluateMalepartusModel],
  ]) {
    const model = create({ seed: 'plain-data', maxYears: 8 });
    const snapshot = evaluate(model, { ageYears: 6, dayOfYear: 210 });
    assert.deepEqual(
      JSON.parse(JSON.stringify(snapshot)),
      snapshot,
      'a snapshot carrying class instances would lose them here',
    );
  }
});
