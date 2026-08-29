import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * How far up the frame the plant sits on a portrait screen, as a fraction of
 * the frustum's own half-height. Enough to clear the bottom sheet when it is
 * open; not so much that the plant looks like it is falling out of the top.
 */
const PORTRAIT_LIFT = 0.09;
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
  // The plant sets its own shadow flags, per organ kind and per LOD band, and
  // it knows things this scene does not: a hydrangea head is a shell of
  // cards standing in for hundreds of florets, and letting them shadow each other
  // blotches one soft cream mass into grey facets. Casting stays on -- the
  // heads shadow the leaves below them, which is real. Overriding the lot on
  // the way in silently threw all of that away.
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
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();

  /** Distance from a pose's eye to what it is looking at. */
  function poseDistance(pose) {
    return offset
      .fromArray(pose.position)
      .sub(target.fromArray(pose.target))
      .length();
  }

  /**
   * How much further back this viewport needs every pose than it was authored.
   *
   * The review poses are distances that frame the plant's HEIGHT in a vertical
   * field of view. On anything wider than about 4:5 height is also the tighter
   * of the two fits, so the poses were right and this returns 1. Turn the same
   * page upright on a phone and it is not: at 390 x 844 the horizontal field of
   * view is 20 degrees, and a shrub as wide as it is tall has its outer canes
   * cut off at both edges. That was the state of the review page on every
   * phone -- a page whose entire job is to show one plant, showing most of one.
   *
   * The shortfall is measured against `front`, the pose that means "the whole
   * shrub", and then applied to all of them. Scaling rather than refitting each
   * pose is what keeps `close-up` a close-up: it stays the same fraction of the
   * way in, and goes on cropping deliberately, instead of being quietly
   * promoted to the same shot as `front` because a phone is narrow.
   */
  function aspectFit() {
    const half = THREE.MathUtils.degToRad(camera.fov) / 2;
    const { radiusM } = descriptor.size;
    const targetY = views.front.target[1];
    const halfHeight = Math.max(targetY, heightM - targetY);
    const forHeight = halfHeight / Math.tan(half);
    const forWidth = radiusM / (Math.tan(half) * camera.aspect);
    // A little air, so the outermost twig is not sitting on the frame edge.
    const required = Math.max(forHeight, forWidth) * 1.04;
    return Math.max(1, required / poseDistance(views.front));
  }

  let currentView = 'three-quarter';
  let currentPortrait = camera.aspect < 1;
  function setReviewView(requestedView = 'three-quarter') {
    const view = views[requestedView] ? requestedView : 'three-quarter';
    const pose = views[view];
    const fit = aspectFit();
    currentView = view;
    currentPortrait = camera.aspect < 1;
    camera.up.fromArray(pose.up ?? [0, 1, 0]);
    target.fromArray(pose.target);
    offset.fromArray(pose.position).sub(target).multiplyScalar(fit);
    camera.position.copy(target).add(offset);
    controls.target.copy(target);
    // A pose that had to be pushed back to fit must be allowed to stay there.
    controls.maxDistance = Math.max(heightM * 6, offset.length() * 1.15);
    // Upright, the controls are a sheet along the bottom edge and the plant is
    // sitting dead centre behind it. Shearing the frustum lifts the plant into
    // the upper part of the frame, so it stays watchable while the sheet is
    // open and the day is being scrubbed -- which is the whole point of the
    // page. This shifts the view without touching the pose, so orbiting still
    // turns around the plant rather than around a point off to one side.
    if (currentPortrait) camera.setViewOffset(1, 1, 0, PORTRAIT_LIFT, 1, 1);
    else camera.clearViewOffset();
    camera.lookAt(controls.target);
    controls.update();
    return view;
  }

  /**
   * Reframe after a turn of the phone, and only then.
   *
   * Re-running the pose throws away wherever the visitor had orbited to, so it
   * has to fire on the one change that genuinely invalidates the framing and
   * not on the ones that do not. A rotation does; a mobile address bar sliding
   * in and out, which fires `resize` several times a second and moves the
   * aspect by a tenth, does not.
   */
  function refitOnRotation() {
    const portrait = camera.aspect < 1;
    if (portrait === currentPortrait) return false;
    setReviewView(currentView);
    return true;
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
    refitOnRotation,
    getReviewView: () => currentView,
    dispose,
  };
}
