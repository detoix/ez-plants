import * as THREE from 'three';
import { selectPlantLODLevel } from '@detoix/ez-plants';
import { createPrototypePool, PlantField } from '@detoix/ez-plants/field';

import { Ground } from './ground';
import { getPlantDescriptor } from './plants';

/**
 * The field-scale demo scene: several hundred plants, one walkable garden.
 *
 * Deliberately thinner than `scene.js`. That page frames one specimen against a
 * diagnostic grid; this one exists to make the cost of a field visible, so it
 * carries only what a field needs and nothing that would distort the numbers in
 * the HUD. In particular it does not use `Skybox`, whose sphere is built at
 * 900x900 segments -- roughly 1.6 million triangles for a backdrop, which would
 * dwarf every plant in the triangle count and tell you nothing.
 */

/** Species in the mixed garden, with the age each is worth looking at. */
const SPECIES = Object.freeze([
  Object.freeze({ id: 'blackcurrant', age: 4 }),
  Object.freeze({ id: 'forsythia', age: 5 }),
  Object.freeze({ id: 'hydrangea', age: 5 }),
  Object.freeze({ id: 'miscanthus', age: 5 }),
]);

/** Deterministic scatter, so a reload gives you the same garden to compare. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Positions on a jittered grid, dealt round-robin to the species.
 *
 * A grid rather than free scatter because a field wants a roughly even density:
 * free scatter clumps, and a clump is where the instance budget goes.
 */
function scatter(count, speciesCount, random) {
  const perSide = Math.ceil(Math.sqrt(count));
  const spacing = 2.4;
  const jitter = 0.75;
  const extent = ((perSide - 1) * spacing) / 2;

  const cells = [];
  for (let index = 0; index < perSide * perSide; index += 1) {
    cells.push(index);
  }
  // Shuffle the cells, not the species, so every species is spread evenly
  // across the whole garden rather than banded into stripes.
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cells[index], cells[swap]] = [cells[swap], cells[index]];
  }

  const perSpecies = Array.from({ length: speciesCount }, () => []);
  for (let index = 0; index < count; index += 1) {
    const cell = cells[index];
    perSpecies[index % speciesCount].push({
      position: [
        (cell % perSide) * spacing - extent + (random() - 0.5) * 2 * jitter,
        0,
        Math.floor(cell / perSide) * spacing -
          extent +
          (random() - 0.5) * 2 * jitter,
      ],
      rotationY: random() * Math.PI * 2,
      scale: 0.85 + random() * 0.3,
    });
  }
  return { perSpecies, extent: extent + spacing };
}

function addLighting(scene, extent) {
  const hemisphere = new THREE.HemisphereLight(0xdcecff, 0x4a5340, 1.15);
  hemisphere.name = 'Sky fill';
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff1d8, 2.9);
  sun.name = 'Sun';
  sun.position.set(extent * 0.7, extent * 1.1, extent * 0.45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = extent * 4;
  // Fitted to the garden, not to the 2 km ground plane. A shadow camera sized
  // to the ground would spend its whole depth range on empty grass.
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  return sun;
}

/**
 * Build the garden.
 *
 * @param {THREE.WebGLRenderer} renderer Passed to every field: without it
 *   instanced-mesh initialises its buffers during the first render and the
 *   opening frame is empty.
 * @param {object} options
 * @param {number} options.count Total plants across every species.
 * @param {number} options.day Day of year, shared by every species so the
 *   garden reads as one moment rather than four.
 * @param {number} options.prototypes Distinct skeletons baked per species.
 * @param {number} options.budget Organ instances the whole garden may draw.
 * @param {number} [options.lodScale] Multiplies every band's suggested
 *   distance. Below 1 coarsens plants sooner, which is the cheapest way to find
 *   out whether a slow frame is bound by how much geometry is on screen.
 * @param {(message: string) => void} [options.onProgress]
 */
export async function createFieldScene(
  renderer,
  {
    count,
    day,
    prototypes: prototypeCount,
    budget,
    lodScale = 1,
    culling = 'plant',
    wind = true,
    onProgress = () => {},
  },
) {
  const scene = new THREE.Scene();
  scene.name = 'EZ-Plants field demo';
  const sky = new THREE.Color(0x9fb8d4);
  scene.background = sky;

  const random = mulberry32(20260828);
  const { perSpecies, extent } = scatter(count, SPECIES.length, random);

  scene.fog = new THREE.Fog(sky, extent * 0.9, extent * 3.4);

  const ground = new Ground();
  ground.name = 'Ground';
  scene.add(ground);

  const sun = addLighting(scene, extent);

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.05,
    extent * 6,
  );
  // Start just outside the planting, looking in, so the opening frame shows the
  // field rather than the inside of a shrub.
  camera.position.set(0, 1.7, extent + 6);
  camera.lookAt(0, 1.2, 0);
  camera.updateMatrixWorld();

  const fields = [];
  const plantPosition = new THREE.Vector3();

  for (const [speciesIndex, species] of SPECIES.entries()) {
    const descriptor = getPlantDescriptor(species.id);
    onProgress(`Growing ${descriptor.label.toLowerCase()}…`);
    // Yield to the browser so the loading text actually paints between species.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const plants = Array.from({ length: prototypeCount }, (_, index) =>
      descriptor.create({
        age: species.age,
        day,
        phenologyProfile: descriptor.profileControl.options[0][0],
        seed: 1000 + speciesIndex * 97 + index * 13,
        leafWind: { enabled: wind },
      }),
    );
    const pool = createPrototypePool(plants);
    const placements = perSpecies[speciesIndex];
    // Scaling the distances changes only *when* a plant switches band, never
    // what its bands contain -- the bake is already done. Choosing the moment
    // is the caller's job, which is exactly what the library leaves open.
    const levels =
      lodScale === 1
        ? plants[0].lodLevels
        : plants[0].lodLevels.map((level) => ({
            ...level,
            distance: level.distance * lodScale,
          }));

    // Choose each plant's opening level from where the camera actually starts.
    // Building at level 0 and demoting afterwards would work, but it would also
    // stretch the instance buffers to the finest arrangement the field never
    // draws -- exactly the slack `PlantField.compact()` exists to reclaim.
    for (const placement of placements) {
      plantPosition.fromArray(placement.position);
      placement.level = selectPlantLODLevel(
        camera.position.distanceTo(plantPosition),
        levels,
        null,
      );
    }

    const field = new PlantField({
      prototypes: pool,
      placements,
      renderer,
      budget: Math.round(budget / SPECIES.length),
      name: `${descriptor.label}Field`,
      // This page culls whole plants itself, in the same pass that decides
      // their level. Leaving the renderer to test every organ as well would be
      // paying ~36 ms a frame for an answer we already have.
      perInstanceCulling: culling === 'leaf',
    });
    scene.add(field);

    fields.push({
      id: species.id,
      label: descriptor.label,
      field,
      pool,
      plants,
      levels,
      // World positions, kept flat and typed: this is read once per placement
      // per frame and there is no reason to rebuild vectors for it.
      positions: Float32Array.from(placements.flatMap((p) => p.position)),
      chosen: Int32Array.from(placements.map((p) => p.level)),
    });
  }

  function update(delta, elapsed) {
    for (const entry of fields) entry.field.update(delta, elapsed);
  }

  function dispose() {
    // Order matters and is the library's: the field draws the prototypes'
    // materials, and the prototypes hold the plants' own.
    for (const entry of fields) {
      entry.field.dispose();
      for (const prototype of entry.pool) prototype.dispose();
      for (const plant of entry.plants) plant.dispose();
    }
    fields.length = 0;
    ground.geometry?.dispose();
    ground.material?.dispose();
    scene.clear();
  }

  return { scene, camera, sun, fields, extent, update, dispose };
}
