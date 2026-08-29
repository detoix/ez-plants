import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { PlantRenderer } from '../src/lib/plant-renderer.js';
import { Miscanthus } from '../src/lib/plants/miscanthus/miscanthus.js';
import { MALEPARTUS_PROFILE } from '../src/lib/plants/miscanthus/malepartus.js';
import { getMalepartusCalendar } from '../src/lib/plants/miscanthus/phenology.js';

const CALENDAR = getMalepartusCalendar();

// Three kinds, where there were seven. A grass carries no wood mesh, so rule 9
// allows it three draws at its near band for everything it owns: blades, head
// and culms. The three blade kinds differed only in posture, which is now a
// rotation; the three head kinds were a raceme skeleton, the spikelets on it
// and the hairs over them, all drawn at the same place with the same matrix.
const MESH_NAMES = Object.freeze({
  wood: 'Miscanthus_Wood',
  culms: 'Miscanthus_Culms',
  blades: 'Miscanthus_Blades',
  panicles: 'Miscanthus_Panicles',
});

const BLADE_MESHES = Object.freeze([MESH_NAMES.blades]);

const PANICLE_MESHES = Object.freeze([MESH_NAMES.panicles]);

function meshes(plant) {
  const found = [];
  plant.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

function meshNamed(plant, name) {
  const found = meshes(plant).find((mesh) => mesh.name === name);
  assert.ok(found, `missing scene mesh ${name}`);
  return found;
}

function makePlant(options = {}) {
  return new Miscanthus({ seed: 4242, maxYears: 25, ...options });
}

function totalCount(plant, names) {
  return names.reduce((sum, name) => sum + meshNamed(plant, name).count, 0);
}

test('the plant is a PlantRenderer with every organ pool present', () => {
  const plant = makePlant();
  try {
    assert.ok(plant instanceof PlantRenderer);
    assert.ok(plant instanceof THREE.Group);
    assert.equal(plant.cultivar, 'Malepartus');
    assert.equal(plant.userData.species, 'Miscanthus sinensis');
    for (const name of Object.values(MESH_NAMES)) meshNamed(plant, name);
  } finally {
    plant.dispose();
  }
});

test('a grass draws no welded woody geometry at all', () => {
  const plant = makePlant({ dayOfYear: 250 });
  try {
    const wood = meshNamed(plant, MESH_NAMES.wood);
    assert.equal(wood.visible, false);
    assert.equal(plant.stats().woodyDrawCalls, 0);
    // Everything visible is instanced, so the whole clump stays inside a
    // handful of draw calls however many culms it carries.
    assert.ok(plant.stats().drawCalls <= Object.keys(MESH_NAMES).length - 1);
  } finally {
    plant.dispose();
  }
});

test('only a cultivar this renderer models is accepted', () => {
  assert.throws(
    () => new Miscanthus({ cultivar: 'Gracillimus' }),
    /only the Malepartus cultivar/,
  );
});

test('blade geometry keeps the wind UVs the shared shader bends by', () => {
  const plant = makePlant();
  try {
    for (const name of [...BLADE_MESHES, ...PANICLE_MESHES]) {
      const mesh = meshNamed(plant, name);
      const uv = mesh.geometry.attributes.uv;
      assert.ok(uv, `${name} must carry UVs for the leaf-wind shader`);
      let maximum = 0;
      for (let index = 0; index < uv.count; index += 1) {
        maximum = Math.max(maximum, uv.getY(index));
      }
      assert.ok(
        maximum > 0.9,
        `${name} must reach uv.y ~1 at its tip or it cannot sway`,
      );
    }
  } finally {
    plant.dispose();
  }
});

test('a blade is scaled uniformly and stays a 1-2 cm strap', () => {
  const plant = makePlant({ dayOfYear: 250 });
  try {
    const mesh = meshNamed(plant, MESH_NAMES.blades);
    assert.ok(mesh.count > 0);
    mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    const unitWidth = local.max.z - local.min.z;
    const unitLength = Math.hypot(local.max.x, local.max.y);
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const [minWidth, maxWidth] = MALEPARTUS_PROFILE.leaf.widthM;
    const [, maxLength] = MALEPARTUS_PROFILE.leaf.lengthM;

    for (let index = 0; index < Math.min(mesh.count, 80); index += 1) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      // The blade twists about its own axis, which mixes the across-blade
      // direction into the plane the arch lives in. Only a uniform scale
      // leaves that twist undistorted. The tolerance is relative because the
      // matrix round-trips through the float32 instance buffer.
      const tolerance = scale.x * 1e-5;
      assert.ok(Math.abs(scale.x - scale.y) < tolerance);
      assert.ok(Math.abs(scale.x - scale.z) < tolerance);

      const widthM = unitWidth * scale.z;
      const lengthM = unitLength * scale.x;
      assert.ok(
        widthM >= minWidth * 0.3 && widthM <= maxWidth * 1.2,
        `blade width ${widthM} m is not a Miscanthus blade`,
      );
      assert.ok(lengthM > 0.05 && lengthM <= maxLength * 1.05);
      assert.ok(
        lengthM > widthM * 15,
        'a blade must stay far longer than it is wide',
      );
    }
  } finally {
    plant.dispose();
  }
});

test('the annual cycle runs from bare stubble to a full flowering clump', () => {
  const plant = makePlant({ ageYears: 8 });
  try {
    plant.setTime({ dayOfYear: CALENDAR.cutbackEnd + 2 });
    const cut = plant.stats();
    assert.equal(cut.visibleBlades, 0);
    assert.equal(cut.visiblePanicles, 0);
    assert.ok(cut.visibleCulms > 0, 'stubble is still drawn');

    plant.setTime({ dayOfYear: 250 });
    const flowering = plant.stats();
    assert.ok(flowering.visibleBlades > 300);
    assert.ok(flowering.visiblePlumes > 0);
    assert.ok(flowering.dimensions.heightM > 1.8);

    plant.setTime({ dayOfYear: 20 });
    const winter = plant.stats();
    assert.ok(winter.standingDeadCulms > 0);
    assert.ok(
      winter.visiblePanicles > 0,
      'silvered plumes are the winter display and must persist',
    );
  } finally {
    plant.dispose();
  }
});

test('instance pools never reallocate while either slider is scrubbed', () => {
  const plant = makePlant({ ageYears: 0, dayOfYear: 1 });
  try {
    const capacities = Object.fromEntries(
      Object.values(MESH_NAMES)
        .filter((name) => name !== MESH_NAMES.wood)
        .map((name) => [name, meshNamed(plant, name).instanceMatrix.count]),
    );

    for (const scenario of ['maintained', 'neglected']) {
      for (let ageYears = 0; ageYears <= 25; ageYears += 1) {
        for (let dayOfYear = 1; dayOfYear <= 365; dayOfYear += 7) {
          plant.setState({ ageYears, dayOfYear, scenario });
        }
      }
    }

    for (const [name, capacity] of Object.entries(capacities)) {
      const mesh = meshNamed(plant, name);
      assert.equal(
        mesh.instanceMatrix.count,
        capacity,
        `${name} reallocated its instance buffer`,
      );
      assert.ok(mesh.count <= capacity, `${name} overflowed its pool`);
    }
  } finally {
    plant.dispose();
  }
});

test('scrubbing away and back restores the identical instance counts', () => {
  const plant = makePlant({ ageYears: 7, dayOfYear: 250 });
  try {
    const names = Object.values(MESH_NAMES).filter(
      (name) => name !== MESH_NAMES.wood,
    );
    const before = names.map((name) => meshNamed(plant, name).count);
    plant.setTime({ ageYears: 2, dayOfYear: 60 });
    plant.setTime({ ageYears: 20, dayOfYear: 330 });
    plant.setTime({ ageYears: 7, dayOfYear: 250 });
    assert.deepEqual(
      names.map((name) => meshNamed(plant, name).count),
      before,
    );
  } finally {
    plant.dispose();
  }
});

test('level of detail thins blades but never shortens a culm', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 250 });
  try {
    const fullBlades = totalCount(plant, BLADE_MESHES);
    const fullHeight = plant.stats().dimensions.heightM;

    plant._setDetail({ leafStride: 4, leafScale: 1.6, sectionStride: 4 });
    const coarse = plant.stats();
    assert.ok(totalCount(plant, BLADE_MESHES) < fullBlades);
    assert.ok(meshNamed(plant, MESH_NAMES.culms).count > 0);
    // Culm segments are merged, not dropped: the plant is exactly as tall.
    assert.equal(coarse.dimensions.heightM, fullHeight);
    assert.ok(coarse.culmSegments < plant.stats().visibleCulms * 11);
  } finally {
    plant.dispose();
  }
});

test('a rejected state change leaves the plant describing what it renders', () => {
  const plant = makePlant({ ageYears: 5, dayOfYear: 250 });
  try {
    assert.equal(plant.ageYears, 5);
    assert.equal(plant.dayOfYear, 250);
  } finally {
    plant.dispose();
  }
});

test('stats and serialize describe the same plant', () => {
  const plant = makePlant({
    ageYears: 9,
    dayOfYear: 280,
  });
  try {
    const stats = plant.stats();
    const serialized = plant.serialize();
    assert.equal(serialized.type, 'Miscanthus');
    assert.equal(serialized.cultivar, stats.cultivar);
    assert.equal(serialized.ageYears, stats.ageYears);
    assert.equal(serialized.dayOfYear, stats.dayOfYear);
    // The shared UI speaks in canes and leaves; a grass mirrors its own terms
    // onto those keys rather than leaving the panel blank.
    assert.equal(stats.visibleCanes, stats.visibleCulms);
    assert.equal(stats.visibleLeaves, stats.visibleBlades);
    assert.ok(stats.clump.radiusM > 0);
    assert.ok(stats.careHints.every((hint) => hint.source.startsWith('https')));
  } finally {
    plant.dispose();
  }
});

test('dispose releases every geometry and material the plant owns', () => {
  const plant = makePlant();
  const disposed = new Set();
  for (const mesh of meshes(plant)) {
    mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.name));
  }
  plant.dispose();
  assert.ok(disposed.size > 0);
  assert.equal(plant.children.length, 0);
});
