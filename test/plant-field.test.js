import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as THREE from 'three';

import {
  createPlantPrototype,
  createPrototypePool,
  PlantField,
} from '../src/lib/field/index.js';

const REPO = new URL('..', import.meta.url).pathname;
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function createPlant(name, options = {}) {
  const module = await import(
    new URL(`../src/lib/plants/${name}/${name}.js`, import.meta.url).href
  );
  const Plant = module[name[0].toUpperCase() + name.slice(1)];
  return new Plant({ ageYears: 5, dayOfYear: 200, ...options });
}

function grid(count, spacing = 2) {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => ({
    position: [(index % side) * spacing, 0, Math.floor(index / side) * spacing],
    rotationY: index * 0.7,
  }));
}

/** Build a field, run `body`, and tear the whole thing down in order. */
async function withField(name, { seeds = [1, 2], count = 60, ...rest }, body) {
  const plants = await Promise.all(
    seeds.map((seed) => createPlant(name, { seed })),
  );
  const prototypes = createPrototypePool(plants);
  const field = new PlantField({
    prototypes,
    placements: grid(count),
    ...rest,
  });
  try {
    return await body(field, prototypes, plants);
  } finally {
    field.dispose();
    for (const prototype of prototypes) prototype.dispose();
    for (const plant of plants) plant.dispose();
  }
}

/* -------------------------------------------------------------------- *
 * Prototypes
 * -------------------------------------------------------------------- */

test('a prototype bakes every band and reads its organ kinds off the bake', async () => {
  for (const name of PLANTS) {
    const plant = await createPlant(name, { seed: 'proto' });
    const prototype = createPlantPrototype(plant);
    try {
      assert.equal(prototype.bands.length, plant.lodLevels.length);
      assert.ok(prototype.organKinds.length > 0);

      // Coarser bands cost less. That is the whole reason bands exist, and the
      // field's budget maths depends on it being true.
      const counts = prototype.bands.map((_band, index) =>
        prototype.instanceCount(index),
      );
      assert.ok(
        counts.at(-1) < counts[0],
        `${name}: coarsest band is not cheaper (${counts.join(' -> ')})`,
      );
      assert.ok(prototype.bounds.max.y > prototype.bounds.min.y);
    } finally {
      prototype.dispose();
      plant.dispose();
    }
  }
});

/* -------------------------------------------------------------------- *
 * The field, and rule 5's budget
 * -------------------------------------------------------------------- */

test('draw calls do not grow with the number of plants', async () => {
  for (const name of PLANTS) {
    const measured = [];
    for (const count of [10, 100, 400]) {
      await withField(name, { count }, (field) => {
        measured.push(field.stats().drawCalls);
      });
    }

    assert.equal(
      new Set(measured).size,
      1,
      `${name}: draw calls moved with plant count (${measured.join(', ')})`,
    );
    // The bound rule 5 actually asks for: one draw per organ kind plus one per
    // prototype's wood, and nothing else.
    assert.ok(
      measured[0] <= 16,
      `${name}: ${measured[0]} draw calls for a whole field`,
    );
  }
});

test('a field of many plants costs fewer draws than the plants would alone', async () => {
  const count = 100;
  for (const name of PLANTS) {
    const solo = await createPlant(name, { seed: 1 });
    const perPlant = solo.stats().drawCalls;
    solo.dispose();

    await withField(name, { count }, (field) => {
      const fieldDraws = field.stats().drawCalls;
      assert.ok(
        fieldDraws < perPlant * count,
        `${name}: field ${fieldDraws} vs ${perPlant * count} placed separately`,
      );
      // Not marginally cheaper — an order of magnitude at this size.
      assert.ok(fieldDraws * 10 < perPlant * count, `${name}: ${fieldDraws}`);
    });
  }
});

test('the caller sets levels, and a coarser one costs less', async () => {
  for (const name of PLANTS) {
    await withField(name, { count: 80 }, (field, prototypes) => {
      const coarsest = prototypes[0].bands.length - 1;

      field.setLevels(new Array(80).fill(0));
      const fine = field.stats();

      field.setLevels(new Array(80).fill(coarsest));
      const coarse = field.stats();

      assert.ok(
        coarse.organInstances < fine.organInstances,
        `${name}: ${coarse.organInstances} coarse vs ${fine.organInstances} fine`,
      );
      // Never more. Equal was the old invariant; library rule 9 lets a band
      // retire an organ kind, so a coarser level may legitimately draw fewer.
      assert.ok(
        coarse.drawCalls <= fine.drawCalls,
        `${name}: ${coarse.drawCalls} coarse draws vs ${fine.drawCalls} fine`,
      );
      assert.equal(coarse.levelCounts.at(-1), 80);
      assert.deepEqual(field.levels, new Array(80).fill(coarsest));
    });
  }
});

test("the budget is reported, never enforced behind the caller's back", async () => {
  await withField('forsythia', { count: 60, budget: 1000 }, (field) => {
    field.setLevels(new Array(60).fill(0));
    const stats = field.stats();

    // The caller asked for the finest level on sixty plants against a budget
    // that cannot possibly hold them. The field draws them anyway and says so.
    assert.ok(stats.organInstances > stats.budget);
    assert.equal(stats.overBudget, true);
    assert.equal(stats.levelCounts[0], 60, 'nothing may be coarsened silently');
    assert.ok(stats.drawCalls > 0);
    assert.deepEqual(field.levels, new Array(60).fill(0));
  });

  await withField('forsythia', { count: 60, budget: 10_000_000 }, (field) => {
    assert.equal(field.stats().overBudget, false);
  });
});

test('setting the same levels again does not repack', async () => {
  await withField('forsythia', { count: 40 }, (field) => {
    const levels = field.levels;
    const before = field.stats().repacks;

    field.setLevels(levels);
    field.setLevelAt(0, levels[0]);
    for (let frame = 0; frame < 5; frame += 1) field.update(0.016, frame);

    assert.equal(
      field.stats().repacks,
      before,
      'an unchanged level set must not rebuild the buffers',
    );
  });
});

test('a level change costs one plant, not the whole field', async () => {
  // The property that makes a walkaround possible. Before this was true, one
  // plant crossing a band boundary rewrote every organ instance in the field:
  // 155 ms at 120 plants, 312 ms at 240, growing without limit. A plant that
  // changes band must cost its own organs and nothing else.
  const measured = [];
  const expected = [];

  for (const count of [20, 200]) {
    await withField('hydrangea', { count }, (field, prototypes) => {
      field.setLevels(new Array(count).fill(2));

      const before = field.stats().instanceWrites;
      field.setLevelAt(0, 0);
      measured.push(field.stats().instanceWrites - before);
      expected.push(prototypes[0].instanceCount(0));
    });
  }

  assert.equal(
    measured[0],
    expected[0],
    'a level change wrote something other than that plant’s own organs',
  );
  assert.equal(
    measured[0],
    measured[1],
    `a ten-fold larger field changed the cost of one plant: ${measured.join(' vs ')}`,
  );
});

test('levels can be walked up and down without losing or leaking instances', async () => {
  // Instances are allocated from a free list now, so a field that keeps
  // changing its mind must still hold exactly what its levels say it holds --
  // no slots stranded by a demotion, none double-counted by a promotion.
  await withField('forsythia', { count: 40 }, (field, prototypes) => {
    const analytic = (levels) =>
      levels.reduce(
        (total, level, index) =>
          total + prototypes[index % prototypes.length].instanceCount(level),
        0,
      );

    for (const pass of [0, 1, 2, 1, 0, 2, 0]) {
      const levels = Array.from({ length: 40 }, (_, index) =>
        index % 3 === 0 ? pass : (index + pass) % 3,
      );
      field.setLevels(levels);

      assert.equal(
        field.stats().organInstances,
        analytic(levels),
        `pass ${pass}: the field holds a different number of organs than its levels ask for`,
      );
    }

    // And back to where it started, by the other entry point.
    for (let index = 0; index < 40; index += 1) field.setLevelAt(index, 0);
    assert.equal(field.stats().organInstances, analytic(new Array(40).fill(0)));
  });
});

test('slack from demotions is reported, and compact() reclaims it', async () => {
  // Freeing an interior subset leaves holes in the active geometry rung. A
  // whole-field demotion may instead empty that rung completely and reclaim
  // its tail, so exercise the actual fragmented case here.
  await withField('hydrangea', { count: 40 }, (field) => {
    const built = field.stats();
    assert.equal(built.unusedSlots, 0, 'a fresh field should have no slack');

    field.setLevels(
      Array.from({ length: 40 }, (_, index) => (index < 20 ? 2 : 0)),
    );
    const demoted = field.stats();
    assert.ok(
      demoted.unusedSlots > 0,
      'demoting an interior subset freed slots but reported none',
    );
    for (const [kind, { variants }] of field._organMeshes) {
      const span = variants.reduce(
        (total, { mesh }) => total + mesh._instancesArrayCount,
        0,
      );
      const active = variants.reduce(
        (total, { mesh }) => total + mesh.instancesCount,
        0,
      );
      assert.equal(span, demoted.slotsByKind[kind]);
      assert.ok(span >= active, `${kind}: active instances exceed its slots`);
    }
    assert.equal(demoted.slots - demoted.organInstances, demoted.unusedSlots);

    field.compact();
    const compacted = field.stats();
    assert.equal(compacted.unusedSlots, 0, 'compact() left slack behind');
    assert.equal(
      compacted.organInstances,
      demoted.organInstances,
      'compact() changed what the field draws',
    );
    assert.deepEqual(
      compacted.levelCounts,
      demoted.levelCounts,
      'compact() changed the levels',
    );
  });
});

test('a placement can be hidden, and stays hidden across a level change', async () => {
  // Frustum culling is the renderer's job now, but hiding a placement is not
  // the same thing: a caller may want a plant gone for reasons no camera test
  // will discover. This is that API, so it has to be exact about what
  // disappears -- organs and trunk together, and across a level change.
  await withField(
    'hydrangea',
    { count: 20, perInstanceCulling: false },
    (field) => {
      for (const mesh of field._woodMeshes.filter(Boolean)) {
        assert.equal(mesh.frustumCulled, false);
      }
      for (const { variants } of field._organMeshes.values()) {
        for (const { mesh } of variants) {
          assert.equal(mesh.frustumCulled, false);
          assert.equal(mesh.perObjectFrustumCulled, false);
        }
      }

      const drawn = () => {
        let organs = 0;
        for (const { variants } of field._organMeshes.values()) {
          for (const { mesh } of variants) {
            for (let id = 0; id < mesh._instancesArrayCount; id += 1) {
              if (mesh.getActiveAndVisibilityAt(id)) organs += 1;
            }
          }
        }
        let wood = 0;
        for (const mesh of field._woodMeshes) {
          if (!mesh) continue;
          for (let id = 0; id < mesh._instancesArrayCount; id += 1) {
            if (mesh.getActiveAndVisibilityAt(id)) wood += 1;
          }
        }
        return { organs, wood };
      };

      const all = drawn();
      assert.ok(all.organs > 0 && all.wood > 0);
      assert.equal(field.stats().visiblePlants, 20);

      field.setVisibility(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
      const half = drawn();
      assert.ok(half.organs < all.organs, 'hiding drew the same organs');
      assert.equal(half.wood, all.wood / 2, 'a hidden plant kept its trunk');
      assert.equal(field.stats().visiblePlants, 10);

      // A hidden plant changing band allocates fresh instances, and instances are
      // born visible -- so without care it would walk back on screen.
      field.setLevelAt(1, 0);
      assert.equal(
        drawn().organs,
        half.organs,
        'a hidden plant reappeared when its level changed',
      );

      field.setVisibility(new Array(20).fill(false));
      assert.deepEqual(drawn(), { organs: 0, wood: 0 });
      assert.equal(field.stats().visiblePlants, 0);

      field.setVisibility(new Array(20).fill(true));
      assert.ok(
        drawn().organs > half.organs,
        'showing again drew nothing back',
      );
    },
  );
});

test('wood is culled against the whole plant, never against its own branches', async () => {
  // Wood may be culled per instance only because its bound was replaced with
  // the prototype's full extent. Its own geometry bound covers the branches
  // alone, and testing that would drop a skeleton while the leaf cards of the
  // same placement stayed on screen.
  await withField(
    'blackcurrant',
    { count: 12, perInstanceCulling: true },
    (field, prototypes) => {
      for (const [index, mesh] of field._woodMeshes.entries()) {
        if (!mesh) continue;
        assert.equal(mesh.frustumCulled, false);
        assert.equal(mesh.perObjectFrustumCulled, true);

        const plant = new THREE.Box3()
          .copy(prototypes[index].bounds)
          .getBoundingSphere(new THREE.Sphere());
        const branches = mesh.geometry.clone();
        branches.computeBoundingSphere();
        assert.ok(
          mesh.geometry.boundingSphere.radius >= plant.radius - 1e-6,
          'the wood culling bound does not cover the whole plant',
        );
        assert.ok(
          mesh.geometry.boundingSphere.radius > branches.boundingSphere.radius,
          'the wood culling bound is still the tight branch bound',
        );
        branches.dispose();
      }
      for (const { mesh } of field._organMeshes.values()) {
        assert.equal(mesh.perObjectFrustumCulled, true);
      }
    },
  );
});

test('wood consumes the same applied band as the placement organs', async () => {
  await withField(
    'blackcurrant',
    { seeds: [1], count: 3, perInstanceCulling: false },
    (field, prototypes) => {
      const placement = field._placements[0];
      const mesh = placement.woodMesh;
      const mainCamera = {};
      const shadowCamera = {};
      const coarsest = prototypes[0].bands.length - 1;

      assert.equal(typeof mesh.resolveLODIndex, 'function');
      assert.equal(
        mesh.resolveLODIndex(
          placement.woodSlot,
          mainCamera,
          mainCamera,
          coarsest,
          false,
        ),
        0,
        'the initial fine organs did not keep fine wood',
      );

      field.setLevelAt(0, coarsest);
      assert.equal(
        mesh.resolveLODIndex(
          placement.woodSlot,
          mainCamera,
          mainCamera,
          0,
          false,
        ),
        coarsest,
        'coarse organs did not select coarse wood',
      );
      assert.equal(
        mesh.resolveLODIndex(
          placement.woodSlot,
          shadowCamera,
          mainCamera,
          0,
          true,
        ),
        1,
        'the coarsest band did not select the coarsest shadow wood',
      );

      field.setLevelAt(0, 1);
      assert.equal(
        mesh.resolveLODIndex(
          placement.woodSlot,
          mainCamera,
          mainCamera,
          0,
          false,
        ),
        1,
      );
      assert.equal(
        mesh.resolveLODIndex(
          placement.woodSlot,
          shadowCamera,
          mainCamera,
          1,
          true,
        ),
        0,
        'an intermediate band should retain the detailed shadow silhouette',
      );
    },
  );
});

test('a placement publishes bounds a caller can cull with', async () => {
  await withField('forsythia', { count: 6 }, (field) => {
    for (let index = 0; index < 6; index += 1) {
      const sphere = field.placementSphere(index);
      assert.ok(sphere.radius > 0, `placement ${index} has no extent`);
      // The sphere has to sit over its own plant, not the field's centre.
      const expected = field._placements[index].transform;
      const origin = new THREE.Vector3().setFromMatrixPosition(expected);
      assert.ok(
        sphere.center.distanceTo(origin) <= sphere.radius,
        `placement ${index} bounds do not cover the plant`,
      );
    }
    assert.throws(() => field.placementSphere(99), /No placement at index/);
    assert.throws(() => field.setVisibility([true]), /Expected 6 flags/);
    assert.throws(() => field.setVisibleAt(99, false), /No placement at index/);
  });
});

test('a field reads no camera and cannot be made to change level by one', async () => {
  await withField('forsythia', { count: 10 }, (field, prototypes, plants) => {
    const plant = plants[0];
    const woodBefore = plant._woodMesh.geometry;
    const detailBefore = plant._detail;
    const levelsBefore = field.levels;

    // Passing a camera is not an error; it is simply ignored, because
    // `update` takes only time.
    field.update(0.016, 1, new THREE.PerspectiveCamera());

    assert.deepEqual(field.levels, levelsBefore);
    assert.strictEqual(plant._detail, detailBefore);
    assert.strictEqual(plant._woodMesh.geometry, woodBefore);
  });
});

test("a level outside the prototype's range is refused", async () => {
  await withField('forsythia', { count: 4 }, (field) => {
    assert.throws(() => field.setLevelAt(0, 99), /it has 3/);
    assert.throws(() => field.setLevelAt(99, 0), /No placement at index/);
    assert.throws(() => field.setLevels([0, 0]), /Expected 4 levels/);
  });
});

test('a field is built from what a plant declares, never from its name', async () => {
  // The roster-independence guarantee, checked the only way that means
  // anything: every plant in the library goes through the same code path with
  // no per-species branch, whatever organ kinds it happens to have.
  for (const name of PLANTS) {
    await withField(name, { count: 12 }, (field, prototypes) => {
      const stats = field.stats();
      assert.ok(stats.drawCalls > 0, name);
      assert.equal(stats.plants, 12);
      assert.equal(stats.prototypes, prototypes.length);
      for (const kind of prototypes[0].organKinds) {
        assert.ok(
          field._organMeshes.has(kind),
          `${name}: no field mesh for declared organ kind ${kind}`,
        );
      }
    });
  }
});

test('field LOD keeps Echinacea leaf-card topology and routes heads through their geometry rung', async () => {
  const plant = await createPlant('echinacea', {
    seed: 'magnus-field-rungs',
    ageYears: 5,
    dayOfYear: 230,
  });
  const prototype = createPlantPrototype(plant);
  const field = new PlantField({
    prototypes: [prototype],
    placements: [{ position: [0, 0, 0] }],
  });
  const triangleLimits = [25_000, 10_000, 5_000];
  const drawLimits = [3, 2, 2];
  let leafCardTopology = null;
  const matrix = new THREE.Matrix4();
  const box = new THREE.Box3();

  try {
    for (let level = 0; level < 3; level += 1) {
      field.setLevelAt(0, level);
      let triangles = 0;
      let draws = 0;
      for (const { variants } of field._organMeshes.values()) {
        for (const { mesh } of variants) {
          if (mesh.instancesCount === 0) continue;
          draws += 1;
          triangles +=
            ((mesh.geometry.index?.count ??
              mesh.geometry.getAttribute('position').count) /
              3) *
            mesh.instancesCount;
        }
      }

      assert.equal(draws, drawLimits[level]);
      assert.equal(field.stats().drawCalls, drawLimits[level]);
      assert.ok(
        triangles <= triangleLimits[level],
        `field LOD${level} uses ${triangles} triangles`,
      );

      const leafSlot = field._slots[0].get('leaves');
      const headSlot = field._slots[0].get('heads');
      assert.equal(leafSlot.variant.mesh.geometry.index.count / 3, 2);
      const topology = {
        positions: Array.from(
          leafSlot.variant.mesh.geometry.getAttribute('position').array,
        ),
        uvs: Array.from(
          leafSlot.variant.mesh.geometry.getAttribute('uv').array,
        ),
      };
      leafCardTopology ??= topology;
      assert.deepEqual(topology, leafCardTopology);
      assert.equal(
        headSlot.variant.mesh.geometry.userData.coarsePeduncle,
        level > 0,
      );

      const bakedHead = prototype.bands[level].baked.organs.find(
        (organ) => organ.kind === 'heads',
      );
      assert.strictEqual(
        headSlot.variant.mesh.customDepthMaterial,
        bakedHead.customDepthMaterial,
      );
      assert.strictEqual(
        headSlot.variant.mesh.customDistanceMaterial,
        bakedHead.customDistanceMaterial,
      );

      if (level === 0) {
        const stemSlot = field._slots[0].get('stems');
        const bakedStem = prototype.bands[level].baked.organs.find(
          (organ) => organ.kind === 'stems',
        );
        assert.equal(Object.hasOwn(bakedStem, 'customDepthMaterial'), false);
        assert.equal(stemSlot.variant.mesh.customDepthMaterial, undefined);
        assert.equal(stemSlot.variant.mesh.customDistanceMaterial, undefined);
      }

      if (level > 0) {
        const mesh = headSlot.variant.mesh;
        mesh.geometry.computeBoundingBox();
        mesh.getMatrixAt(headSlot.ids[0], matrix);
        box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
        assert.ok(box.min.y > -0.02, 'coarse peduncle starts at the crown');
        assert.ok(box.max.y > 0.65, 'coarse head remains at stem height');

        if (level === 2) {
          for (const [material, shaderLib] of [
            [mesh.material, THREE.ShaderLib.standard],
            [mesh.customDepthMaterial, THREE.ShaderLib.depth],
            [mesh.customDistanceMaterial, THREE.ShaderLib.distance],
          ]) {
            const shader = {
              defines: {},
              uniforms: {},
              vertexShader: shaderLib.vertexShader,
              fragmentShader: shaderLib.fragmentShader,
            };
            const priorMaterial = mesh._currentMaterial;
            const priorCompile = mesh._onBeforeCompileBase;
            mesh._currentMaterial = material;
            mesh._onBeforeCompileBase = material.onBeforeCompile;
            try {
              mesh._onBeforeCompile(shader, null);
            } finally {
              mesh._currentMaterial = priorMaterial;
              mesh._onBeforeCompileBase = priorCompile;
            }
            assert.ok(
              Object.hasOwn(shader.defines, 'USE_INSTANCING_COLOR_INDIRECT'),
            );
            assert.strictEqual(
              shader.uniforms.colorsTexture.value,
              mesh.colorsTexture,
            );
            assert.match(shader.vertexShader, /getColorTexture/);
            assert.match(shader.vertexShader, /attribute float magnusHead/);
            assert.match(shader.vertexShader, /magnusRayVisibility/);
            assert.match(shader.vertexShader, /magnusHeadVisibility/);
            if (material !== mesh.material) {
              assert.ok(
                shader.vertexShader.indexOf('#include <batching_pars_vertex>') <
                  shader.vertexShader.indexOf('#include <color_pars_vertex>'),
                'shadow colour lookup must follow instanceIndex declaration',
              );
            }
          }
        }
      }
    }
  } finally {
    field.dispose();
    prototype.dispose();
    plant.dispose();
  }
});

test('field organ meshes own their geometry and instance index', () => {
  const sourceGeometry = new THREE.PlaneGeometry(1, 1);
  const sourceMaterial = new THREE.MeshBasicMaterial();
  const identity = new THREE.Matrix4().toArray();
  const bounds = new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.01),
    new THREE.Vector3(0.5, 0.5, 0.01),
  );
  const prototype = {
    bands: [
      {
        distance: 0,
        hysteresis: 0,
        baked: {
          wood: null,
          organs: [
            {
              kind: 'leaves',
              name: 'Shared leaves',
              geometry: sourceGeometry,
              material: sourceMaterial,
              count: 1,
              matrices: Float32Array.from(identity),
              colors: null,
              castShadow: false,
              receiveShadow: false,
            },
          ],
        },
      },
    ],
    organKinds: ['leaves'],
    bounds,
    plant: { update() {} },
    organCount(kind) {
      return kind === 'leaves' ? 1 : 0;
    },
  };
  const gl = {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    UNSIGNED_INT: 0x1405,
    bindBuffer() {},
    bufferData() {},
    createBuffer() {
      return {};
    },
  };
  const renderer = { getContext: () => gl };
  const first = new PlantField({
    prototypes: [prototype],
    placements: grid(1),
    renderer,
  });
  const second = new PlantField({
    prototypes: [prototype],
    placements: grid(1),
    renderer,
  });
  const firstMesh = first._organMeshes.get('leaves').mesh;
  const secondMesh = second._organMeshes.get('leaves').mesh;
  let firstGeometryDisposed = false;
  let secondGeometryDisposed = false;
  firstMesh.geometry.addEventListener(
    'dispose',
    () => (firstGeometryDisposed = true),
  );
  secondMesh.geometry.addEventListener(
    'dispose',
    () => (secondGeometryDisposed = true),
  );

  try {
    assert.notStrictEqual(firstMesh.geometry, sourceGeometry);
    assert.notStrictEqual(secondMesh.geometry, sourceGeometry);
    assert.notStrictEqual(firstMesh.geometry, secondMesh.geometry);
    assert.equal(sourceGeometry.hasAttribute('instanceIndex'), false);
    assert.strictEqual(
      firstMesh.geometry.getAttribute('instanceIndex'),
      firstMesh.instanceIndex,
    );
    assert.strictEqual(
      secondMesh.geometry.getAttribute('instanceIndex'),
      secondMesh.instanceIndex,
    );
  } finally {
    first.dispose();
    second.dispose();
    sourceGeometry.dispose();
    sourceMaterial.dispose();
  }

  assert.equal(firstGeometryDisposed, true);
  assert.equal(secondGeometryDisposed, true);
});

test('disposing a field leaves the prototypes and their plants alone', async () => {
  const plants = [await createPlant('forsythia', { seed: 1 })];
  const prototypes = createPrototypePool(plants);
  const field = new PlantField({ prototypes, placements: grid(10) });

  field.dispose();

  assert.equal(field.children.length, 0);
  assert.ok(plants[0].stats().drawCalls > 0, 'the source plant still renders');
  assert.ok(prototypes[0].bands[0].baked.organs.length > 0);

  for (const prototype of prototypes) prototype.dispose();
  plants[0].dispose();
});

test('mismatched prototypes are refused rather than rendered wrongly', async () => {
  const plant = await createPlant('forsythia', { seed: 1 });
  try {
    const full = createPlantPrototype(plant);
    const single = createPlantPrototype(plant, {
      levels: [{ distance: 0, hysteresis: 0 }],
    });
    try {
      assert.throws(
        () =>
          new PlantField({
            prototypes: [full, single],
            placements: grid(4),
          }),
        /same LOD bands/,
      );
    } finally {
      full.dispose();
      single.dispose();
    }
  } finally {
    plant.dispose();
  }
});
