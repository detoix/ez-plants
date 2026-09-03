import * as THREE from 'three/webgpu';

import { terrainHeightAt } from './field-terrain-height.js';
import { createWebGPUWalkControls } from './grass-webgpu/controls.js';
import { createGPUDrivenGrass } from './grass-webgpu/grass.js';
import { GRASS_RINGS } from './grass-webgpu/grid.js';
import {
  LAWN_UNDERLAY,
  createLawnSurface,
  normalizeLawnUnderlay,
} from './grass-webgpu/surface.js';
import {
  createWebGPUHeightTexture,
  createWebGPUTerrainGeometry,
  webGPUBackdropHeight,
} from './grass-webgpu/terrain.js';

const SAMPLE_COUNT = 120;

export function readFieldOptions(search = '', devicePixelRatio = 1) {
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
    count: number('count', 400, 4, 4000),
    day: number('day', 230, 1, 365),
    prototypes: number('prototypes', 3, 1, 8),
    budget: number('budget', 1_600_000, 10_000, 20_000_000),
    lodScale: number('lod', 1, 0.1, 4),
    wind: params.get('wind') !== 'off',
    terrain:
      params.get('terrain') === 'flat' ? 0 : number('terrain', 1.15, 0, 4),
    shadows: params.get('shadows') !== 'off',
    underlay: normalizeLawnUnderlay(params.get('underlay')),
    pixelRatio: number(
      'pixelratio',
      Math.min(devicePixelRatio || 1, 2),
      0.5,
      3,
    ),
  };
}

function readOptions() {
  return readFieldOptions(window.location.search, window.devicePixelRatio || 1);
}

function adapterName(adapter) {
  const info = adapter.info;
  if (!info) return 'WebGPU adapter';
  return [info.vendor, info.architecture, info.device]
    .filter(Boolean)
    .join(' · ');
}

function formatInteger(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatSurface(surface) {
  const { asset, maps, encodedBytes, gpuBytes, anisotropy } = surface.stats;
  return `${asset} · ${maps} maps · ${(encodedBytes / 1024).toFixed(0)} KiB transfer · ${(gpuBytes / 1024 / 1024).toFixed(1)} MiB GPU · ${anisotropy}×`;
}

function createHUD(renderer, adapter, surface) {
  const values = new Map(
    [...document.querySelectorAll('[data-stat]')].map((node) => [
      node.dataset.stat,
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
  set('gpu', adapterName(adapter) || 'WebGPU adapter');
  set('surface-tile', formatSurface(surface));

  return {
    update(delta, grassStats, plantStats) {
      samples[cursor] = delta;
      cursor = (cursor + 1) % SAMPLE_COUNT;
      filled = Math.min(SAMPLE_COUNT, filled + 1);
      let total = 0;
      let worst = 0;
      for (let index = 0; index < filled; index += 1) {
        total += samples[index];
        worst = Math.max(worst, samples[index]);
      }
      const mean = total / Math.max(1, filled);
      set('fps', mean > 0 ? (1 / mean).toFixed(0) : '—');
      set(
        'frame',
        `${(mean * 1000).toFixed(1)} ms · worst ${(worst * 1000).toFixed(0)}`,
      );
      set('candidates', formatInteger(grassStats.candidates));
      set(
        'visible',
        formatInteger(grassStats.visible.reduce((a, b) => a + b, 0)),
      );
      for (const ring of GRASS_RINGS) {
        set(
          `visible-${ring.id}`,
          formatInteger(grassStats.visible[ring.index]),
        );
      }
      const triangles = GRASS_RINGS.reduce(
        (sum, ring) => sum + grassStats.visible[ring.index] * ring.segments * 2,
        0,
      );
      set('triangles', formatInteger(triangles));
      set('grass-draws', String(grassStats.drawCalls));
      set('scene-draws', String(renderer.info.render.drawCalls));
      set(
        'compute',
        `${grassStats.computeCalls} this frame · ${GRASS_RINGS.length + 1} steady`,
      );
      set('placements', formatInteger(grassStats.placements));
      // The on-screen count comes from the view driver's per-plant sphere test.
      // `visiblePlants` counts placements not hidden through `setVisibility`,
      // and nothing hides them any more -- frustum culling is the backend's,
      // per instance -- so that number is always the whole field.
      set(
        'plant-count',
        `${formatInteger(plantStats.culling?.visible ?? plantStats.visiblePlants)} / ${formatInteger(plantStats.plants)}`,
      );
      set('plant-instances', formatInteger(plantStats.organInstances));
      set('plant-draws', formatInteger(plantStats.drawCalls));
      set(
        'plant-levels',
        plantStats.levelCounts.map(formatInteger).join(' / '),
      );
      set(
        'plant-view',
        `${plantStats.culling.ms.toFixed(2)} ms · ${formatInteger(plantStats.culling.pending)} pending`,
      );
      set('memory', formatBytes(renderer.info.memory.total));
    },
  };
}

function createScene({ terrainAmplitude, shadows, surface }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b8c9b5');
  scene.fog = new THREE.Fog('#b8c9b5', 44, 125);

  const skyLight = new THREE.HemisphereLight('#e8f4e3', '#26331e', 1.7);
  scene.add(skyLight);

  const sun = new THREE.DirectionalLight('#fff0cd', 3.2);
  sun.position.set(24, 34, 17);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.00015;
  scene.add(sun, sun.target);

  const terrain = new THREE.Mesh(
    createWebGPUTerrainGeometry({ amplitude: terrainAmplitude }),
    surface.material,
  );
  terrain.name = 'WebGPU field terrain';
  terrain.castShadow = shadows;
  terrain.receiveShadow = shadows;
  scene.add(terrain);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({
      color: '#33481f',
      roughness: 1,
      metalness: 0,
    }),
  );
  backdrop.name = 'Flat field backdrop';
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.y = webGPUBackdropHeight(terrainAmplitude);
  backdrop.receiveShadow = shadows;
  scene.add(backdrop);

  return {
    scene,
    sun,
    terrain,
    backdrop,
    surface,
    setUnderlay(nextMode) {
      const mode = surface.setMode(nextMode);
      terrain.material = surface.material;
      return mode;
    },
  };
}

function bindUnderlayControl(stage, options) {
  const select = document.getElementById('underlay-control');

  function setMode(nextMode, { updateURL = true } = {}) {
    const mode = stage.setUnderlay(nextMode);
    options.underlay = mode;
    if (select && select.value !== mode) select.value = mode;

    if (updateURL) {
      const url = new URL(window.location.href);
      if (mode === LAWN_UNDERLAY.lawn) url.searchParams.delete('underlay');
      else url.searchParams.set('underlay', mode);
      window.history.replaceState(null, '', url);
    }
    return mode;
  }

  const onChange = () => setMode(select.value);
  select?.addEventListener('change', onChange);
  setMode(options.underlay, { updateURL: false });

  return {
    setMode,
    dispose() {
      select?.removeEventListener('change', onChange);
    },
  };
}

export async function startField({ adapter }) {
  const options = readOptions();
  const container = document.getElementById('app');
  const loading = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');
  const hint = document.getElementById('walk-hint');
  if (!container) throw new Error('The WebGPU canvas host is missing.');

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = options.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(options.pixelRatio);
  renderer.setSize(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight),
  );
  container.append(renderer.domElement);

  let heightMap;
  let surface;
  let stage;
  let grass;
  let plantPlot;
  let underlayControl;
  let controls;
  let resize;
  let beforeUnloadInstalled = false;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    if (resize) window.removeEventListener('resize', resize);
    if (beforeUnloadInstalled) {
      window.removeEventListener('beforeunload', dispose);
    }
    underlayControl?.dispose();
    controls?.dispose();
    if (plantPlot) stage?.scene.remove(plantPlot.group);
    plantPlot?.dispose();
    grass?.dispose();
    heightMap?.texture.dispose();
    stage?.terrain.geometry.dispose();
    surface?.dispose();
    stage?.backdrop.geometry.dispose();
    stage?.backdrop.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  try {
    if (loadingText) loadingText.textContent = 'Opening the WebGPU device…';
    await renderer.init();
    if (renderer.backend.isWebGPUBackend !== true) {
      throw new Error(
        'Three.js fell back to WebGL2; GPU atomics and indirect grass require the WebGPU backend.',
      );
    }

    const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 170);
    camera.coordinateSystem = renderer.coordinateSystem;
    camera.position.set(0, 2, 18);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    if (loadingText)
      loadingText.textContent = 'Baking the shared terrain height…';
    heightMap = createWebGPUHeightTexture({
      amplitude: options.terrain,
    });
    if (loadingText) loadingText.textContent = 'Loading the CC0 lawn PBR maps…';
    surface = await createLawnSurface({
      renderer,
      underlay: options.underlay,
    });
    stage = createScene({
      terrainAmplitude: options.terrain,
      shadows: options.shadows,
      surface,
    });

    if (loadingText)
      loadingText.textContent = 'Allocating persistent grass grids…';
    grass = createGPUDrivenGrass({
      renderer,
      heightMap,
      surface,
      shadows: options.shadows,
    });
    stage.scene.add(grass.group);
    underlayControl = bindUnderlayControl(stage, options);

    const groundAt = (x, z) =>
      terrainHeightAt(x, z, { amplitude: options.terrain });
    const { createMixedPlantField } = await import('./field-plants.js');
    plantPlot = await createMixedPlantField({
      renderer,
      camera,
      groundAt,
      shadows: options.shadows,
      count: options.count,
      day: options.day,
      prototypeCount: options.prototypes,
      budget: options.budget,
      lodScale: options.lodScale,
      wind: options.wind,
      onProgress(message) {
        if (loadingText) loadingText.textContent = message;
      },
    });
    stage.scene.add(plantPlot.group);

    controls = createWebGPUWalkControls(camera, renderer.domElement, {
      groundAt,
      limit: plantPlot.layout.extent + 14,
    });
    controls.setOnEngaged(() => hint?.setAttribute('hidden', ''));

    const hud = createHUD(renderer, adapter, surface);
    const sunOffset = stage.sun.position.clone();
    const clock = new THREE.Clock();
    let firstFrame = true;
    let lastReadback = 0;

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

    function animate(now) {
      const rawDelta = clock.getDelta();
      const delta = Math.min(rawDelta, 0.05);
      controls.update(delta);

      stage.sun.target.position.set(
        camera.position.x,
        groundAt(camera.position.x, camera.position.z),
        camera.position.z,
      );
      stage.sun.position.copy(stage.sun.target.position).add(sunOffset);
      stage.sun.target.updateMatrixWorld();
      stage.sun.updateMatrixWorld();

      grass.update(camera);
      const plantStats = plantPlot.update(camera, delta, clock.elapsedTime);
      renderer.render(stage.scene, camera);
      const grassStats = grass.stats();
      hud.update(rawDelta, grassStats, plantStats);

      if (now - lastReadback >= 750) {
        lastReadback = now;
        grass.sampleVisibleCounts().catch((error) => {
          console.warn('Grass visible-count readback failed.', error);
        });
      }

      if (firstFrame) {
        firstFrame = false;
        loading?.setAttribute('hidden', '');
        window.__ready = true;
      }
    }

    await renderer.setAnimationLoop(animate);
    window.addEventListener('beforeunload', dispose, { once: true });
    beforeUnloadInstalled = true;

    window.__field = {
      renderer,
      camera,
      grass,
      plants: plantPlot,
      plantFields: plantPlot.fields.map((entry) => entry.field),
      surface,
      options,
      setUnderlay: underlayControl.setMode,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
