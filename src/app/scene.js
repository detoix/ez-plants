import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Blackcurrant, TreePreset } from '@dgreenheck/ez-tree';
import { getBarkMaps, getLeafMap, LeafType } from './textures';

const REVIEW_VIEWS = Object.freeze({
  front: {
    position: [0, 1.28, 2.78],
    target: [0, 0.72, 0],
  },
  'three-quarter': {
    position: [2.52, 1.42, 2.52],
    target: [0, 0.72, 0],
  },
  side: {
    position: [2.78, 1.28, 0],
    target: [0, 0.72, 0],
  },
  top: {
    position: [0.01, 3.62, 0.01],
    target: [0, 0.58, 0],
    up: [0, 0, -1],
  },
  'close-up': {
    position: [1.48, 1.13, 1.48],
    target: [0, 0.76, 0],
  },
});

function addGardenGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 96),
    new THREE.MeshStandardMaterial({
      color: 0x76866d,
      roughness: 0.98,
      metalness: 0,
    }),
  );
  ground.name = 'Diagnostic garden ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.012;
  ground.receiveShadow = true;
  scene.add(ground);

  const plantingBed = new THREE.Mesh(
    new THREE.CircleGeometry(0.68, 64),
    new THREE.MeshStandardMaterial({
      color: 0x40382d,
      roughness: 1,
      metalness: 0,
    }),
  );
  plantingBed.name = 'Blackcurrant planting bed';
  plantingBed.rotation.x = -Math.PI / 2;
  plantingBed.position.y = -0.004;
  plantingBed.receiveShadow = true;
  scene.add(plantingBed);

  const grid = new THREE.GridHelper(4, 8, 0x33453a, 0x526558);
  grid.name = 'Half-metre diagnostic grid';
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.26;
  grid.material.depthWrite = false;
  scene.add(grid);

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
  scene.add(metreRing);
}

function addNeutralLighting(scene) {
  const hemisphere = new THREE.HemisphereLight(0xeaf2ff, 0x4b493d, 1.25);
  hemisphere.name = 'Neutral ambient fill';
  scene.add(hemisphere);

  const key = new THREE.DirectionalLight(0xfff2dc, 3.1);
  key.name = 'Warm-neutral key';
  key.position.set(2.5, 4.2, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -2.2;
  key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -2.2;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.018;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xc9ddff, 1.05);
  fill.name = 'Cool fill';
  fill.position.set(-3.2, 2.2, 2.8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xfff7e8, 1.45);
  rim.name = 'Neutral rim';
  rim.position.set(0.8, 2.8, -3.4);
  scene.add(rim);
}

function instantiatePlant(initialState) {
  // Use EZ-Tree's shrub bark contract directly: the Bush 1 preset selects
  // Bark001 and supplies its tint, shading and UV scale.
  const bark = structuredClone(TreePreset['Bush 1'].bark);
  bark.maps = getBarkMaps(bark.type);

  const options = {
    cultivar: 'Tisel',
    seed: 24051987,
    ageYears: initialState.age,
    dayOfYear: initialState.day,
    scenario: initialState.scenario,
    autoLOD: true,
    bark,
    leaf: {
      map: getLeafMap(LeafType.BlackcurrantTisel),
      tint: 0xffffff,
      alphaTest: 0.5,
      roundedNormals: true,
    },
  };

  // The public renderer accepts its initial digital-twin state at construction.
  // Keeping construction isolated here makes future cultivar switching explicit.
  return new Blackcurrant(options);
}

/**
 * Creates the metre-scale blackcurrant review scene used by the digital-twin proof.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{age: number, day: number, scenario: 'maintained'|'neglected', view?: string}} initialState
 */
export async function createScene(renderer, initialState) {
  const scene = new THREE.Scene();
  scene.name = 'Tisel digital twin review scene';
  scene.background = new THREE.Color(0xcbd8ca);
  scene.fog = new THREE.Fog(0xcbd8ca, 6.5, 14);

  addGardenGround(scene);
  addNeutralLighting(scene);

  const plant = instantiatePlant(initialState);
  plant.name = "Blackcurrant 'Tisel'";
  plant.traverse?.((object) => {
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
    30,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 1.05;
  controls.maxDistance = 8;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.025;

  let currentView = 'three-quarter';
  function setReviewView(requestedView = 'three-quarter') {
    const view = REVIEW_VIEWS[requestedView] ? requestedView : 'three-quarter';
    const pose = REVIEW_VIEWS[view];
    currentView = view;
    camera.up.fromArray(pose.up ?? [0, 1, 0]);
    camera.position.fromArray(pose.position);
    controls.target.fromArray(pose.target);
    camera.lookAt(controls.target);
    controls.update();
    return view;
  }

  setReviewView(initialState.view);

  return {
    scene,
    plant,
    camera,
    controls,
    setReviewView,
    getReviewView: () => currentView,
  };
}
