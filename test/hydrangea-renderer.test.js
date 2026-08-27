import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { PlantRenderer } from '../src/lib/plant-renderer.js';
import { Hydrangea } from '../src/lib/plants/hydrangea/hydrangea.js';
import {
  createLimelightModel,
  evaluateLimelightModel,
} from '../src/lib/plants/hydrangea/model.js';
import { LIMELIGHT_CALENDAR } from '../src/lib/plants/hydrangea/phenology.js';
import { isSharedResource } from '../src/lib/shared-resources.js';

const MESH_NAMES = Object.freeze({
  wood: 'Hydrangea_Wood',
  leaves: 'Hydrangea_Leaves_Opposite_Ovate',
  petioles: 'Hydrangea_Petioles',
  buds: 'Hydrangea_VegetativeBuds',
  currentShoots: 'Hydrangea_CurrentSeasonShoots',
  peduncles: 'Hydrangea_PaniclePeduncles',
  panicleStems: 'Hydrangea_PanicleRachises',
  fertilePanicles: 'Hydrangea_Panicles_FertileInterior',
  sterileLower: 'Hydrangea_Panicles_SterileLower',
  sterileUpper: 'Hydrangea_Panicles_SterileUpper',
});

const HEAD_MESH_NAMES = Object.freeze([
  MESH_NAMES.peduncles,
  MESH_NAMES.panicleStems,
  MESH_NAMES.fertilePanicles,
  MESH_NAMES.sterileLower,
  MESH_NAMES.sterileUpper,
]);

// At the app's alphaTest 0.5 threshold, the baked 1024 px square plate has a
// 562 x 1022 px visible blade. The square GPU card must not apply that aspect
// a second time; the alpha silhouette supplies the visible ovate proportions.
const LIMELIGHT_LEAF_ALPHA_FOOTPRINT = Object.freeze({
  platePx: 1024,
  widthPx: 562,
  lengthPx: 1022,
});

function meshes(plant) {
  const result = [];
  plant.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

function meshNamed(plant, name) {
  const found = meshes(plant).find((mesh) => mesh.name === name);
  assert.ok(found, `missing scene mesh ${name}`);
  return found;
}

function makePlant(options = {}) {
  return new Hydrangea({ seed: 4242, maxYears: 30, ...options });
}

function activeMatrixBytes(mesh) {
  const byteLength = mesh.count * 16 * Float32Array.BYTES_PER_ELEMENT;
  return new Uint8Array(
    mesh.instanceMatrix.array.buffer,
    mesh.instanceMatrix.array.byteOffset,
    byteLength,
  ).slice();
}

function captureInstances(plant) {
  return Object.fromEntries(
    Object.values(MESH_NAMES)
      .filter((name) => name !== MESH_NAMES.wood)
      .map((name) => {
        const mesh = meshNamed(plant, name);
        return [name, { count: mesh.count, matrices: activeMatrixBytes(mesh) }];
      }),
  );
}

function instanceScales(plant, meshName) {
  const mesh = meshNamed(plant, meshName);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const result = [];
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale);
    result.push(scale.clone());
  }
  return result;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function firstInstanceColour(plant, meshName) {
  const mesh = meshNamed(plant, meshName);
  assert.ok(mesh.count > 0, `${meshName} needs an active instance`);
  assert.ok(mesh.instanceColor, `${meshName} needs instance colours`);
  const colour = new THREE.Color();
  mesh.getColorAt(0, colour);
  return colour.toArray();
}

function instancesByOrganId(plant, meshName) {
  const mesh = meshNamed(plant, meshName);
  const result = new Map();
  for (let index = 0; index < mesh.count; index += 1) {
    const identity = plant._instancePool.identityFor(mesh, index);
    assert.ok(identity?.organId, `${meshName}[${index}] needs an organ id`);
    assert.ok(
      !result.has(identity.organId),
      `${meshName} duplicated ${identity.organId}`,
    );
    result.set(identity.organId, {
      matrix: mesh.instanceMatrix.array.slice(index * 16, index * 16 + 16),
      colour: mesh.instanceColor?.array.slice(index * 3, index * 3 + 3),
    });
  }
  return result;
}

function physicalPanicles(terminalPanicle) {
  if (!terminalPanicle) return [];
  return [
    terminalPanicle.previousPanicle,
    terminalPanicle.currentPanicle,
  ].filter(Boolean);
}

function snapshotInstanceCounts(snapshot) {
  const counts = Object.fromEntries(
    Object.values(MESH_NAMES)
      .filter((name) => name !== MESH_NAMES.wood)
      .map((name) => [name, 0]),
  );
  const showBuds = snapshot.phenology.leafProgress < 0.12;

  for (const cane of snapshot.canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        for (const leaf of node.leaves) {
          if (leaf.visible) {
            counts[MESH_NAMES.leaves] += 1;
            counts[MESH_NAMES.petioles] += 1;
          }
          if (!leaf.visible || showBuds) counts[MESH_NAMES.buds] += 1;
        }
      }

      const terminalPanicle = axis.terminalPanicle;
      const currentShoot = terminalPanicle?.currentShoot;
      if (currentShoot?.visible && currentShoot.lengthM > 1e-6) {
        counts[MESH_NAMES.currentShoots] += 1;
      }

      for (const head of physicalPanicles(terminalPanicle)) {
        if (!head.visible || head.headVisibility <= 0.015) continue;
        counts[MESH_NAMES.peduncles] += 1;
        counts[MESH_NAMES.panicleStems] += 1;
        if (head.fertileVisibility > 0.015) {
          counts[MESH_NAMES.fertilePanicles] += 1;
        }
        if (head.sterileVisibility > 0.015) {
          counts[MESH_NAMES.sterileLower] += 1;
          counts[MESH_NAMES.sterileUpper] += 1;
        }
      }
    }
  }

  return counts;
}

test('Hydrangea is a PlantRenderer Group with every organ pool and one wood mesh', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230 });
  try {
    assert.ok(plant instanceof Hydrangea);
    assert.ok(plant instanceof PlantRenderer);
    assert.ok(plant instanceof THREE.Group);
    for (const name of Object.values(MESH_NAMES)) meshNamed(plant, name);

    assert.equal(plant.name, 'Hydrangea_Limelight');
    assert.equal(plant.userData.species, 'Hydrangea paniculata');
    assert.equal(plant.userData.cultivar, 'Limelight');
    assert.equal(plant.userData.units, 'metre');
    assert.equal(
      meshes(plant).filter((mesh) => mesh.name === MESH_NAMES.wood).length,
      1,
    );
    assert.equal(
      meshes(plant).filter(
        (mesh) => mesh.userData.kind === 'woody-architecture-batch',
      ).length,
      1,
    );
  } finally {
    plant.dispose();
  }
});

test('the renderer rejects cultivars outside its Limelight profile', () => {
  assert.throws(() => makePlant({ cultivar: 'Limelight Prime' }), RangeError);
  assert.throws(() => makePlant({ cultivar: 'Pinky Winky' }), /Limelight/);

  const plant = makePlant({ cultivar: 'Limelight' });
  try {
    assert.equal(plant.cultivar, 'Limelight');
  } finally {
    plant.dispose();
  }
});

test('summer draws opposite leaves and every biological layer of each panicle', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230 });
  try {
    const stats = plant.stats();
    const leaves = meshNamed(plant, MESH_NAMES.leaves);
    const petioles = meshNamed(plant, MESH_NAMES.petioles);
    const panicleCount = meshNamed(plant, MESH_NAMES.panicleStems).count;

    assert.ok(leaves.count > 1_000);
    assert.equal(petioles.count, leaves.count);
    assert.equal(stats.visibleLeaves, leaves.count);
    assert.ok(panicleCount > 30);
    assert.ok(meshNamed(plant, MESH_NAMES.currentShoots).count > 30);
    assert.equal(stats.visiblePanicles, panicleCount);
    assert.equal(stats.freshPanicles, panicleCount);
    assert.equal(stats.visibleDryPanicles, 0);
    assert.equal(stats.phenology.phase, 'cream-flowering');

    for (const name of HEAD_MESH_NAMES) {
      assert.equal(
        meshNamed(plant, name).count,
        panicleCount,
        `${name} must contribute once to every open head`,
      );
    }
    for (const id of instancesByOrganId(
      plant,
      MESH_NAMES.currentShoots,
    ).keys()) {
      assert.match(id, /:current-shoot$/);
    }
  } finally {
    plant.dispose();
  }
});

test('square leaf cards scale by biological length and alpha supplies the ovate footprint', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230 });
  try {
    const mesh = meshNamed(plant, MESH_NAMES.leaves);
    const leaves = instanceScales(plant, MESH_NAMES.leaves);
    const states = new Map(
      plant._snapshot.canes
        .flatMap((cane) => cane.axes)
        .flatMap((axis) => axis.nodes)
        .flatMap((node) => node.leaves)
        .filter((leaf) => leaf.visible)
        .map((leaf) => [leaf.id, leaf]),
    );
    assert.ok(leaves.length > 0);
    assert.equal(leaves.length, states.size);
    for (const [index, scale] of leaves.entries()) {
      assert.ok(Math.abs(scale.x - scale.y) < 1e-6);
      assert.ok(Math.abs(scale.y - scale.z) < 1e-6);
      const identity = plant._instancePool.identityFor(mesh, index);
      assert.ok(identity?.organId, `leaf ${index} needs a stable identity`);
      const state = states.get(identity.organId);
      assert.ok(state, `missing evaluated leaf ${identity.organId}`);
      assert.ok(
        Math.abs(scale.y - state.lengthM * state.scale) < 1e-6,
        `${identity.organId} card scale is not its biological length`,
      );
    }

    const cardScaleM = mean(leaves.map((scale) => scale.y));
    assert.ok(cardScaleM >= 0.085 && cardScaleM <= 0.1);

    const { platePx, widthPx, lengthPx } = LIMELIGHT_LEAF_ALPHA_FOOTPRINT;
    const visibleWidthM = cardScaleM * (widthPx / platePx);
    const visibleLengthM = cardScaleM * (lengthPx / platePx);
    const visibleAspect = visibleWidthM / visibleLengthM;

    // The patent reports an 8.5-10 cm length, a 4-5.5 cm width and a roughly
    // ovate 0.44-0.56 aspect. Those describe alpha, not the square GPU card.
    assert.ok(visibleLengthM >= 0.085 && visibleLengthM <= 0.1);
    assert.ok(visibleWidthM >= 0.04 && visibleWidthM <= 0.055);
    assert.ok(
      visibleAspect >= 0.44 && visibleAspect <= 0.56,
      `visible leaf width:length ${visibleAspect.toFixed(3)} is not Limelight's ovate blade`,
    );
  } finally {
    plant.dispose();
  }
});

test('winter is leafless but retains dry tan panicle skeletons', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 20 });
  try {
    const stats = plant.stats();
    const dryHeads = meshNamed(plant, MESH_NAMES.panicleStems).count;

    assert.equal(meshNamed(plant, MESH_NAMES.leaves).count, 0);
    assert.equal(meshNamed(plant, MESH_NAMES.petioles).count, 0);
    assert.ok(meshNamed(plant, MESH_NAMES.buds).count > 0);
    assert.ok(dryHeads > 0);
    assert.equal(stats.visiblePanicles, dryHeads);
    assert.equal(stats.visibleDryPanicles, dryHeads);
    assert.equal(stats.dryPanicles, dryHeads);
    assert.equal(stats.freshPanicles, 0);
    assert.equal(stats.phenology.panicleColourStage, 'dry-tan');
    for (const name of HEAD_MESH_NAMES) {
      assert.equal(meshNamed(plant, name).count, dryHeads);
    }
  } finally {
    plant.dispose();
  }
});

test('retained heads stay parchment-coloured while spring pruning removes them', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 20 });
  const colourPools = [
    MESH_NAMES.peduncles,
    MESH_NAMES.panicleStems,
    MESH_NAMES.fertilePanicles,
    MESH_NAMES.sterileLower,
    MESH_NAMES.sterileUpper,
  ];
  try {
    const winterColours = Object.fromEntries(
      colourPools.map((name) => [name, firstInstanceColour(plant, name)]),
    );

    for (const dayOfYear of [45, 60, 75]) {
      plant.setTime({ dayOfYear });
      assert.ok(plant.stats().phenology.oldPanicleVisibility > 0);
      for (const name of colourPools) {
        assert.deepEqual(
          firstInstanceColour(plant, name),
          winterColours[name],
          `${name} changed dry colour on pruning day ${dayOfYear}`,
        );
      }
    }

    // Fertile points fall below their visibility threshold first, but the
    // last visible showy sepals and their support remain just as dry-coloured.
    plant.setTime({ dayOfYear: 89 });
    for (const name of [
      MESH_NAMES.peduncles,
      MESH_NAMES.panicleStems,
      MESH_NAMES.sterileLower,
      MESH_NAMES.sterileUpper,
    ]) {
      assert.deepEqual(firstInstanceColour(plant, name), winterColours[name]);
    }
  } finally {
    plant.dispose();
  }
});

test('maintained spring growth has no heads after the pruning window', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 112 });
  try {
    assert.ok(112 > LIMELIGHT_CALENDAR.previousPaniclePruneEnd);
    assert.ok(112 < LIMELIGHT_CALENDAR.panicleInitiationStart);
    assert.ok(meshNamed(plant, MESH_NAMES.leaves).count > 0);
    for (const name of HEAD_MESH_NAMES) {
      assert.equal(meshNamed(plant, name).count, 0, `${name} survived pruning`);
    }
    assert.equal(plant.stats().visiblePanicles, 0);
    assert.equal(plant.stats().visibleDryPanicles, 0);
  } finally {
    plant.dispose();
  }
});

test('fresh florets remain rendered throughout the dry-head colour handoff', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230 });
  try {
    for (const seasonProfile of ['typical', 'early', 'late']) {
      plant.setPhenologyProfile({ seasonProfile });
      const { freshDisplayEnd, dryPanicleFull } =
        plant.stats().phenology.calendar;

      for (let day = freshDisplayEnd; day <= dryPanicleFull; day += 1) {
        plant.setTime({ dayOfYear: day });
        const headCount = meshNamed(plant, MESH_NAMES.panicleStems).count;
        assert.ok(headCount > 0, `${seasonProfile} lost heads on day ${day}`);
        assert.equal(
          meshNamed(plant, MESH_NAMES.sterileLower).count,
          headCount,
          `${seasonProfile} lost lower sepals on day ${day}`,
        );
        assert.equal(
          meshNamed(plant, MESH_NAMES.sterileUpper).count,
          headCount,
          `${seasonProfile} lost upper sepals on day ${day}`,
        );
        assert.ok(
          meshNamed(plant, MESH_NAMES.fertilePanicles).count > 0,
          `${seasonProfile} lost fertile flowers on day ${day}`,
        );
      }
    }
  } finally {
    plant.dispose();
  }
});

test('a one-year plant can flower sparsely on its current-season shoots', () => {
  const plant = makePlant({ ageYears: 1, dayOfYear: 230 });
  try {
    const stats = plant.stats();
    const heads = plant._snapshot.canes
      .flatMap((cane) => cane.axes)
      .map((axis) => axis.terminalPanicle.currentPanicle)
      .filter((head) => head.visible);

    assert.ok(heads.length > 0);
    assert.ok(heads.length < 20, 'year-one flowering should remain sparse');
    assert.equal(stats.visiblePanicles, heads.length);
    assert.equal(stats.freshPanicles, heads.length);
    assert.equal(stats.flowersOnCurrentSeasonWood, true);
    assert.equal(stats.phenology.flowersOnCurrentSeasonWood, true);
    for (const head of heads) {
      assert.ok(head.currentVisibility > 0);
      assert.ok(head.freshVisibility > 0);
      assert.equal(head.retainedFromPreviousYear, false);
      assert.equal(head.dryVisibility, 0);
    }
  } finally {
    plant.dispose();
  }
});

test('time scrubbing A-B-A restores exact active counts and matrices', () => {
  const plant = makePlant({ ageYears: 6, dayOfYear: 230 });
  try {
    const before = captureInstances(plant);
    plant.setState({
      ageYears: 17,
      dayOfYear: 20,
      seasonProfile: 'late',
    });
    plant.setState({
      ageYears: 2,
      dayOfYear: 112,
      seasonProfile: 'early',
    });
    plant.setState({
      ageYears: 6,
      dayOfYear: 230,
      seasonProfile: 'typical',
    });
    assert.deepEqual(captureInstances(plant), before);
  } finally {
    plant.dispose();
  }
});

test('early and late profiles shift opening without changing plant age', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 196 });
  try {
    plant.setPhenologyProfile({ seasonProfile: 'early' });
    const early = plant.stats().phenology;
    const earlyOpen = meshNamed(plant, MESH_NAMES.sterileLower).count;

    plant.setPhenologyProfile({ seasonProfile: 'late' });
    const late = plant.stats().phenology;
    const lateOpen = meshNamed(plant, MESH_NAMES.sterileLower).count;

    assert.equal(plant.ageYears, 8);
    assert.equal(plant.dayOfYear, 196);
    assert.equal(early.phase, 'lime-flowering');
    assert.equal(late.phase, 'panicle-bud');
    assert.ok(early.calendar.floweringStart < late.calendar.floweringStart);
    assert.ok(earlyOpen > 0);
    assert.equal(lateOpen, 0);
  } finally {
    plant.dispose();
  }
});

test('absolute ages 20 and 21 remain on the mature plateau without a cycle reset', () => {
  const plant = makePlant({ ageYears: 20, dayOfYear: 230 });
  try {
    const ageOnePlant = makePlant({ ageYears: 1, dayOfYear: 230 });
    const ageOne = ageOnePlant.stats();
    ageOnePlant.dispose();

    const ageTwenty = plant.stats();
    const twentyInstances = captureInstances(plant);
    const matureWoodGeometry = meshNamed(plant, MESH_NAMES.wood).geometry;
    plant.setState({ ageYears: 21 });
    const ageTwentyOne = plant.stats();

    assert.ok(ageTwenty.visibleLeaves > ageOne.visibleLeaves * 2);
    assert.ok(ageTwenty.visiblePanicles > ageOne.visiblePanicles * 2);
    assert.equal(ageTwentyOne.visibleAxes, ageTwenty.visibleAxes);
    assert.equal(ageTwentyOne.visibleLeaves, ageTwenty.visibleLeaves);
    assert.equal(ageTwentyOne.visiblePanicles, ageTwenty.visiblePanicles);
    assert.deepEqual(ageTwentyOne.dimensions, ageTwenty.dimensions);
    assert.deepEqual(captureInstances(plant), twentyInstances);
    assert.strictEqual(
      meshNamed(plant, MESH_NAMES.wood).geometry,
      matureWoodGeometry,
    );
  } finally {
    plant.dispose();
  }
});

test('all age, season, management, and timing states fit stable instance pools', () => {
  const plant = makePlant({ ageYears: 30, dayOfYear: 230 });
  const instanced = meshes(plant).filter((mesh) => mesh.isInstancedMesh);
  const initial = new Map(
    instanced.map((mesh) => [
      mesh.name,
      {
        mesh,
        matrix: mesh.instanceMatrix,
        capacity: mesh.instanceMatrix.count,
      },
    ]),
  );
  const maxima = new Map(instanced.map((mesh) => [mesh.name, 0]));
  const stateAtMaximum = new Map();
  const days = [20, 75, 112, 181, 205, 230, 263, 300, 340];
  const model = createLimelightModel({ seed: 4242, maxYears: 30 });

  try {
    // Evaluating snapshots is enough to prove the fixed pool bounds for all
    // 1,674 combinations. Rendering each one would rewrite several million
    // identical mature leaf matrices and turn a capacity test into a minute-
    // long GPU-buffer benchmark. Peak states below are still applied through
    // the real renderer to prove evaluator counts and pool writes agree.
    for (let ageYears = 0; ageYears <= 30; ageYears += 1) {
      for (const dayOfYear of days) {
        for (const scenario of ['maintained', 'neglected']) {
          for (const seasonProfile of ['typical', 'early', 'late']) {
            const state = { ageYears, dayOfYear, scenario, seasonProfile };
            const snapshot = evaluateLimelightModel(model, state);
            const counts = snapshotInstanceCounts(snapshot);
            for (const [name, count] of Object.entries(counts)) {
              const capacity = initial.get(name).capacity;
              assert.ok(
                count <= capacity,
                `${name} needs ${count}/${capacity} at ${ageYears}/${dayOfYear}/${scenario}/${seasonProfile}`,
              );
              if (count > maxima.get(name)) {
                maxima.set(name, count);
                stateAtMaximum.set(name, state);
              }
            }
          }
        }
      }
    }

    for (const [name, maximum] of maxima) {
      assert.ok(maximum > 0, `${name} was never exercised by the full sweep`);
      assert.ok(maximum <= initial.get(name).capacity);
    }

    const peakStates = new Map(
      [...stateAtMaximum.values()].map((state) => [
        JSON.stringify(state),
        state,
      ]),
    );
    for (const state of peakStates.values()) {
      const expected = snapshotInstanceCounts(
        evaluateLimelightModel(model, state),
      );
      plant.setState(state);
      for (const [name, allocation] of initial) {
        const mesh = meshNamed(plant, name);
        assert.strictEqual(mesh, allocation.mesh, `${name} mesh changed`);
        assert.strictEqual(
          mesh.instanceMatrix,
          allocation.matrix,
          `${name} matrix allocation changed`,
        );
        assert.equal(mesh.instanceMatrix.count, allocation.capacity);
        assert.equal(mesh.count, expected[name], `${name} peak write mismatch`);
      }
    }
  } finally {
    plant.dispose();
  }
});

test('a rejected state update rolls back fields and rendered instances', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230 });
  try {
    const beforeState = plant.serialize();
    const beforeInstances = captureInstances(plant);

    assert.throws(
      () =>
        plant.setState({
          ageYears: 12,
          seasonProfile: 'monsoon',
        }),
      /seasonProfile/,
    );
    assert.deepEqual(plant.serialize(), beforeState);
    assert.deepEqual(captureInstances(plant), beforeInstances);

    assert.throws(() => plant.setState({ offsetDays: 31 }), /offsetDays/);
    assert.deepEqual(plant.serialize(), beforeState);
    assert.throws(() => plant.setState({ ageYears: 3.5 }), /ageYears/);
    assert.deepEqual(plant.serialize(), beforeState);
  } finally {
    plant.dispose();
  }
});

test('serialize round-trips every state needed to reproduce the renderer', () => {
  const plant = makePlant({
    seed: 'limelight-round-trip',
    plantId: 'garden:limelight:1',
    ageYears: 9,
    dayOfYear: 263,
    seasonProfile: 'early',
    offsetDays: -4,
  });
  try {
    const state = plant.serialize();
    assert.deepEqual(state, {
      schemaVersion: 1,
      type: 'Hydrangea',
      plantId: 'garden:limelight:1',
      species: 'Hydrangea paniculata',
      cultivar: 'Limelight',
      seed: 'limelight-round-trip',
      maxYears: 30,
      ageYears: 9,
      dayOfYear: 263,
      seasonProfile: 'early',
      offsetDays: -4,
      events: [],
    });

    const restored = new Hydrangea(state);
    try {
      assert.deepEqual(restored.serialize(), state);
      assert.deepEqual(captureInstances(restored), captureInstances(plant));
      assert.deepEqual(restored.stats().dimensions, plant.stats().dimensions);
    } finally {
      restored.dispose();
    }
  } finally {
    plant.dispose();
  }
});

test('distance LOD thins leaves and heads without erasing the cultivar display', () => {
  const plant = makePlant({ ageYears: 20, dayOfYear: 230, lod: true });
  try {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1, 2);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    const nearLeaves = meshNamed(plant, MESH_NAMES.leaves).count;
    const nearHeads = meshNamed(plant, MESH_NAMES.sterileLower).count;

    camera.position.set(0, 1, 40);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    const farLeaves = meshNamed(plant, MESH_NAMES.leaves).count;
    const farHeads = meshNamed(plant, MESH_NAMES.sterileLower).count;

    assert.ok(farLeaves > 0 && farLeaves < nearLeaves);
    assert.ok(farHeads > 0 && farHeads < nearHeads);
    assert.equal(meshNamed(plant, MESH_NAMES.sterileUpper).count, farHeads);
    assert.equal(meshNamed(plant, MESH_NAMES.panicleStems).count, farHeads);
    assert.ok(meshNamed(plant, MESH_NAMES.wood).visible);
  } finally {
    plant.dispose();
  }
});

test('distance LOD thins the head cohort and restores exact near slots', () => {
  // Previous- and current-season heads never coexist on a pruned plant: last
  // year's are cleared in the spring window well before this year's initiate.
  // So there is one cohort to thin, and it must come back byte-identical.
  const plant = makePlant({
    ageYears: 20,
    dayOfYear: 230,
    lod: true,
  });
  try {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1, 2);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);

    const nearInstances = captureInstances(plant);
    const nearHeads = instancesByOrganId(plant, MESH_NAMES.panicleStems);
    assert.ok(nearHeads.size > 0);
    for (const id of nearHeads.keys()) assert.match(id, /:current$/);

    camera.position.set(0, 1, 40);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    const farHeads = instancesByOrganId(plant, MESH_NAMES.panicleStems);

    assert.ok(farHeads.size > 0);
    assert.ok(farHeads.size < nearHeads.size);
    for (const id of farHeads.keys()) {
      assert.ok(nearHeads.has(id), `${id} is not a near-detail head`);
    }
    assert.equal(plant.stats().visiblePanicles, farHeads.size);

    camera.position.set(0, 1, 2);
    camera.updateMatrixWorld(true);
    plant.update(0, 0, camera);
    assert.deepEqual(captureInstances(plant), nearInstances);
  } finally {
    plant.dispose();
  }
});

test('dispose releases each owned GPU allocation exactly once and is idempotent', () => {
  const plant = makePlant({ ageYears: 8, dayOfYear: 230, lod: true });
  const sceneMeshes = meshes(plant);
  const instancedMeshes = new Set(
    sceneMeshes.filter((mesh) => mesh.isInstancedMesh),
  );
  const geometries = new Set(sceneMeshes.map((mesh) => mesh.geometry));
  const materials = new Set(sceneMeshes.map((mesh) => mesh.material));
  const leaves = meshNamed(plant, MESH_NAMES.leaves);
  materials.add(leaves.customDepthMaterial);
  materials.add(leaves.customDistanceMaterial);

  const counts = new Map();
  const expected = new Map();
  const instrument = (resource, kind) => {
    // Owned resources dispose exactly once no matter how often `dispose()` is
    // called. Shared ones belong to the cache and must not dispose at all, or
    // every other plant in the scene loses them too.
    const shared = isSharedResource(resource);
    const label = `${shared ? 'shared ' : ''}${kind}:${resource.name || resource.uuid}`;
    counts.set(label, 0);
    expected.set(label, shared ? 0 : 1);
    const original = resource.dispose.bind(resource);
    resource.dispose = () => {
      counts.set(label, counts.get(label) + 1);
      original();
    };
  };
  for (const mesh of instancedMeshes) instrument(mesh, 'mesh');
  for (const geometry of geometries) instrument(geometry, 'geometry');
  for (const material of materials) instrument(material, 'material');

  plant.dispose();
  plant.dispose();

  for (const [label, count] of counts) {
    assert.equal(
      count,
      expected.get(label),
      `${label} disposed ${count} times`,
    );
  }
  assert.ok(
    [...expected.values()].some((value) => value === 0),
    'the plant must reuse at least one shared resource',
  );
  assert.equal(plant.children.length, 0);
});
