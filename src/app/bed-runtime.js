import * as THREE from 'three/webgpu';

import { createBedLayout } from './bed-layout.js';
import { createBedOrbit } from './bed-orbit.js';
import { createBedProps } from './bed-props.js';
import {
  BED_DEFAULT_AGE,
  BED_DEFAULT_DAY,
  BED_MAX_AGE,
  clampAge,
  clampDay,
  nearestSeasonMark,
  yearsLabel,
} from './bed-state.js';
import { createBedLawnMask } from './bed-lawn-mask.js';
import { createGPUDrivenGrass } from './grass-webgpu/grass.js';
import { createLawnSurface } from './grass-webgpu/surface.js';
import { createWebGPUHeightTexture } from './grass-webgpu/terrain.js';

const SAMPLE_COUNT = 90;

/**
 * The bed sits on level ground.
 *
 * `/field` offers a terrain dial because uneven ground is one of the things it
 * exists to measure. A designed bed on a hillside is simply a different bed, so
 * this page has no such dial and reads a constant instead of the field's
 * height function.
 */
const groundAt = () => 0;

export function readBedOptions(search = '', devicePixelRatio = 1) {
  const params = new URLSearchParams(search);
  const number = (key, fallback, minimum, maximum) => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value)
      ? Math.min(maximum, Math.max(minimum, value))
      : fallback;
  };

  return {
    age: clampAge(params.get('age'), BED_DEFAULT_AGE),
    day: clampDay(params.get('day'), BED_DEFAULT_DAY),
    prototypes: number('prototypes', 3, 1, 6),
    lodScale: number('lod', 4, 0.1, 12),
    budget: number('budget', 900_000, 10_000, 8_000_000),
    wind: params.get('wind') !== 'off',
    shadows: params.get('shadows') !== 'off',
    backlight: params.get('backlight') !== 'off',
    orbit: params.get('orbit') !== 'off',
    ui: params.get('ui') !== '0',
    pixelRatio: number(
      'pixelratio',
      Math.min(devicePixelRatio || 1, 2),
      0.5,
      3,
    ),
  };
}

function createScene({ shadows, surface }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c3d3d8');
  scene.fog = new THREE.Fog('#c3d3d8', 34, 108);

  const skyLight = new THREE.HemisphereLight('#eaf4ef', '#2f3a26', 1.55);
  scene.add(skyLight);

  const sun = new THREE.DirectionalLight('#fff2d6', 3.1);
  sun.position.set(9, 13, 7);
  sun.castShadow = shadows;
  // A bed is eight metres across, so the whole subject fits in one tight
  // shadow camera. The field cannot do this; it is why its shadows are softer.
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(170, 170, 40, 40),
    surface.material,
  );
  lawn.name = 'Bed lawn';
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = shadows;
  scene.add(lawn);

  return { scene, sun, lawn };
}

function createHUD(renderer) {
  const values = new Map(
    [...document.querySelectorAll('[data-bed]')].map((node) => [
      node.dataset.bed,
      node,
    ]),
  );
  const samples = new Float32Array(SAMPLE_COUNT);
  let cursor = 0;
  let filled = 0;

  const set = (key, value) => {
    const node = values.get(key);
    if (node && node.textContent !== value) node.textContent = value;
  };

  return {
    set,
    update(delta, stats) {
      samples[cursor] = delta;
      cursor = (cursor + 1) % SAMPLE_COUNT;
      filled = Math.min(SAMPLE_COUNT, filled + 1);
      let total = 0;
      for (let index = 0; index < filled; index += 1) total += samples[index];
      const mean = total / Math.max(1, filled);
      set('fps', mean > 0 ? `${(1 / mean).toFixed(0)} fps` : '—');
      set('draws', String(renderer.info.render.drawCalls));
      set('organs', stats.organInstances.toLocaleString('pl-PL'));
    },
  };
}

export async function startBed({ adapter }) {
  const options = readBedOptions(
    window.location.search,
    window.devicePixelRatio || 1,
  );
  const container = document.getElementById('app');
  const loading = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');
  const panel = document.getElementById('bed-panel');
  if (!container) throw new Error('The bed canvas host is missing.');
  if (!options.ui) panel?.setAttribute('hidden', '');

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = options.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(options.pixelRatio);
  renderer.setSize(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight),
  );
  container.append(renderer.domElement);

  let surface;
  let heightMap;
  let stage;
  let grass;
  let props;
  let planting;
  let orbit;
  let resize;
  let controls;
  let beforeUnloadInstalled = false;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    if (resize) window.removeEventListener('resize', resize);
    if (beforeUnloadInstalled)
      window.removeEventListener('beforeunload', dispose);
    controls?.dispose();
    orbit?.dispose();
    if (planting) stage?.scene.remove(planting.group);
    planting?.dispose();
    if (props) stage?.scene.remove(props.group);
    props?.dispose();
    grass?.dispose();
    heightMap?.texture.dispose();
    stage?.lawn.geometry.dispose();
    surface?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  try {
    if (loadingText) loadingText.textContent = 'Otwieram urządzenie WebGPU…';
    await renderer.init();
    if (renderer.backend.isWebGPUBackend !== true) {
      throw new Error(
        'Three.js fell back to WebGL2; this page needs the WebGPU backend.',
      );
    }

    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 220);
    camera.coordinateSystem = renderer.coordinateSystem;
    camera.position.set(6, 4, 9);
    camera.lookAt(0, 0.7, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    if (loadingText) loadingText.textContent = 'Ładuję trawnik CC0…';
    surface = await createLawnSurface({ renderer, underlay: 'lawn' });
    stage = createScene({ shadows: options.shadows, surface });

    if (loadingText) loadingText.textContent = 'Sieję trawę…';
    // The bed is flat, so the shared height bake is flat too; the grass reads
    // the same zero the layout and the props do.
    heightMap = createWebGPUHeightTexture({ amplitude: 0 });
    grass = createGPUDrivenGrass({
      renderer,
      heightMap,
      surface,
      shadows: options.shadows,
      backlight: options.backlight,
      // Without this the blades are placed from a world-space hash that knows
      // nothing about the planting, and grow straight up through the mulch and
      // the cobbles.
      keepAt: createBedLawnMask(),
    });
    stage.scene.add(grass.group);

    if (loadingText) loadingText.textContent = 'Wytyczam grządkę…';
    const layout = createBedLayout({ groundAt });
    props = createBedProps({
      outline: layout.outline,
      groundAt,
      shadows: options.shadows,
    });
    stage.scene.add(props.group);

    const { createBedPlanting } = await import('./bed-plants.js');
    planting = await createBedPlanting({
      renderer,
      camera,
      layout,
      shadows: options.shadows,
      prototypeCount: options.prototypes,
      budget: options.budget,
      age: options.age,
      day: options.day,
      lodScale: options.lodScale,
      wind: options.wind,
      onProgress(message) {
        if (loadingText && message) loadingText.textContent = message;
      },
    });
    stage.scene.add(planting.group);

    // Framed for a 3.85 m bed carrying a hydrangea's 1.85 m. The distance is
    // the bed's own scale, not a fixed number: at the 13.2 m this page opened
    // with, a domestic bed is a smudge in the middle of a lawn.
    orbit = createBedOrbit(camera, renderer.domElement, {
      target: new THREE.Vector3(0, 0.7, -0.15),
      radius: 5.4,
    });
    orbit.setAuto(options.orbit);

    const hud = createHUD(renderer);
    controls = bindPlantingControls({ planting, hud, options });

    const clock = new THREE.Clock();
    let firstFrame = true;

    resize = function resizeRenderer() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      renderer.setPixelRatio(options.pixelRatio);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    function animate() {
      const rawDelta = clock.getDelta();
      const delta = Math.min(rawDelta, 0.05);
      orbit.update(delta);
      grass.update(camera);
      const stats = planting.update(camera, delta, clock.elapsedTime);
      renderer.render(stage.scene, camera);
      hud.update(rawDelta, stats);

      if (firstFrame) {
        firstFrame = false;
        loading?.setAttribute('hidden', '');
        window.__ready = true;
      }
    }

    await renderer.setAnimationLoop(animate);
    window.addEventListener('beforeunload', dispose, { once: true });
    beforeUnloadInstalled = true;

    window.__bed = {
      renderer,
      camera,
      grass,
      layout,
      planting,
      orbit,
      options,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/**
 * Wire the age and day sliders.
 *
 * Both commit on `change`, not on `input`: a range input fires `change` when
 * the handle is released or moved by keyboard, which is exactly one rebuild
 * per drag. Reading back on `input` keeps the labels live while the handle
 * moves, so the slider still feels continuous even though the planting only
 * regrows once.
 */
function bindPlantingControls({ planting, hud, options }) {
  const ageInput = document.querySelector('[data-bed-age]');
  const dayInput = document.querySelector('[data-bed-day]');
  const status = document.querySelector('[data-bed="status"]');
  let busy = false;

  function paintLabels(age, day) {
    hud.set('age-out', `${age} ${yearsLabel(age)}`);
    const mark = nearestSeasonMark(day);
    const near = Math.abs(mark.day - day) <= 6 ? ` · ${mark.label}` : '';
    hud.set('day-out', `dzień ${day}${near}`);
  }

  async function commit() {
    if (busy) return;
    const age = clampAge(ageInput.value);
    const day = clampDay(dayInput.value);
    if (age === planting.state.age && day === planting.state.day) return;
    busy = true;
    const instant = planting.isReady({ age, day });
    if (!instant && status) status.textContent = 'Zapuszczam korzenie…';
    try {
      const applied = await planting.setState({ age, day });
      ageInput.value = String(applied.age);
      dayInput.value = String(applied.day);
      paintLabels(applied.age, applied.day);
      const url = new URL(window.location.href);
      url.searchParams.set('age', String(applied.age));
      url.searchParams.set('day', String(applied.day));
      window.history.replaceState(null, '', url);
    } finally {
      busy = false;
      if (status) status.textContent = '';
    }
  }

  const onInput = () =>
    paintLabels(clampAge(ageInput.value), clampDay(dayInput.value));

  ageInput.max = String(BED_MAX_AGE);
  ageInput.value = String(planting.state.age);
  dayInput.value = String(planting.state.day);
  for (const input of [ageInput, dayInput]) {
    input.addEventListener('input', onInput);
    input.addEventListener('change', commit);
  }

  hud.set('species', 'Lawenda · rozplenica · hortensja');
  hud.set('plants', String(options.prototypes));
  paintLabels(planting.state.age, planting.state.day);

  return {
    dispose() {
      for (const input of [ageInput, dayInput]) {
        input.removeEventListener('input', onInput);
        input.removeEventListener('change', commit);
      }
    },
  };
}
