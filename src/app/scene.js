import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { plantReviewViews } from './plants';

/**
 * Ground, bed and scale markers sized to whichever plant is on stage, so a
 * 1.3 m currant and a 2.3 m forsythia are both readable against a one-metre
 * reference without per-species tuning.
 */
function addGardenGround(scene, descriptor) {
  const { heightM } = descriptor.size;
  const groundRadius = Math.max(5.5, heightM * 3.4);
  const group = new THREE.Group();
  group.name = 'Diagnostic garden ground';

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(groundRadius, 96),
    new THREE.MeshStandardMaterial({
      color: 0x76866d,
      roughness: 0.98,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.012;
  ground.receiveShadow = true;
  group.add(ground);

  const plantingBed = new THREE.Mesh(
    new THREE.CircleGeometry(descriptor.bedRadiusM, 64),
    new THREE.MeshStandardMaterial({
      color: 0x40382d,
      roughness: 1,
      metalness: 0,
    }),
  );
  plantingBed.name = `${descriptor.label} planting bed`;
  plantingBed.rotation.x = -Math.PI / 2;
  plantingBed.position.y = -0.004;
  plantingBed.receiveShadow = true;
  group.add(plantingBed);

  const gridSize = Math.max(4, Math.ceil(heightM * 2) * 2);
  const grid = new THREE.GridHelper(gridSize, gridSize * 2, 0x33453a, 0x526558);
  grid.name = 'Half-metre diagnostic grid';
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.26;
  grid.material.depthWrite = false;
  group.add(grid);

  const metreRing = new THREE.Mesh(
    new THREE.RingGeometry(0.495, 0.505, 96),
    new THREE.MeshBasicMaterial({
      color: 0xe8eee5,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  metreRing.name = 'One-metre diameter marker';
  metreRing.rotation.x = -Math.PI / 2;
  metreRing.position.y = 0.006;
  group.add(metreRing);

  scene.add(group);
  return group;
}

function addNeutralLighting(scene, descriptor) {
  const { heightM } = descriptor.size;
  const extent = Math.max(2.2, heightM * 1.6);

  const hemisphere = new THREE.HemisphereLight(0xeaf2ff, 0x4b493d, 1.25);
  hemisphere.name = 'Neutral ambient fill';
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff2dc, 3.1);
  key.name = 'Warm-neutral key';
  key.position.set(extent * 1.15, extent * 1.9, extent);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = extent * 6;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.018;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xc9ddff, 1.05);
  fill.name = 'Cool fill';
  fill.position.set(-extent * 1.45, extent, extent * 1.27);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xfff7e8, 1.45);
  rim.name = 'Neutral rim';
  rim.position.set(extent * 0.36, extent * 1.27, -extent * 1.55);
  scene.add(rim);
}

/**
 * Creates the metre-scale review scene for one plant in the library.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} descriptor - a plant descriptor from ./plants
 * @param {{age:number, day:number, view?:string}} initialState
 */
export async function createScene(renderer, descriptor, initialState) {
  const scene = new THREE.Scene();
  scene.name = `${descriptor.cultivar} digital twin review scene`;
  scene.background = new THREE.Color(0xcbd8ca);
  const { heightM } = descriptor.size;
  scene.fog = new THREE.Fog(0xcbd8ca, heightM * 5, heightM * 11);

  addGardenGround(scene, descriptor);
  addNeutralLighting(scene, descriptor);

  const plant = descriptor.create(initialState);
  plant.name = `${descriptor.label} '${descriptor.cultivar}'`;
  plant.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(plant);

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.02,
    Math.max(30, heightM * 20),
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = heightM * 0.8;
  controls.maxDistance = heightM * 6;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.025;

  const views = plantReviewViews(descriptor);
  let currentView = 'three-quarter';
  function setReviewView(requestedView = 'three-quarter') {
    const view = views[requestedView] ? requestedView : 'three-quarter';
    const pose = views[view];
    currentView = view;
    camera.up.fromArray(pose.up ?? [0, 1, 0]);
    camera.position.fromArray(pose.position);
    controls.target.fromArray(pose.target);
    camera.lookAt(controls.target);
    controls.update();
    return view;
  }

  setReviewView(initialState.view);

  /** Release every GPU resource this scene owns, including the plant. */
  function dispose() {
    plant.dispose();
    scene.traverse((object) => {
      if (object === plant || plant.getObjectById(object.id)) return;
      object.geometry?.dispose?.();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((one) => one.dispose?.());
      else material?.dispose?.();
    });
    controls.dispose();
    scene.clear();
  }

  return {
    scene,
    plant,
    camera,
    controls,
    setReviewView,
    getReviewView: () => currentView,
    dispose,
  };
}
