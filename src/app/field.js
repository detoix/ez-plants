import * as THREE from 'three';

import { createFieldScene } from './field-scene';
import { createWalkControls } from './field-controls';
import { FieldViewDriver } from './field-view';
import { createFieldHUD } from './field-hud';

/** Read the garden's shape from the URL, so a run is reproducible by link. */
function readFieldOptions() {
  const params = new URLSearchParams(window.location.search);
  const number = (key, fallback, min, max) => {
    // `params.get` gives null for an absent key, and `Number(null)` is 0, not
    // NaN. Testing the parsed number alone therefore treats every default as a
    // deliberate zero and clamps it up to the minimum -- which quietly turned
    // the default garden into four plants on a January morning.
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  };
  return {
    count: number('count', 400, 4, 4000),
    day: number('day', 230, 1, 365),
    prototypes: number('prototypes', 3, 1, 8),
    budget: number('budget', 1_600_000, 10_000, 20_000_000),
    shadows: params.get('shadows') !== 'off',
    // Diagnostics. Rendering cost splits three ways -- pixels, geometry, and
    // the CPU work of deciding what to draw -- and these are the three dials
    // that move one at a time, so a slow frame can be attributed rather than
    // guessed at.
    pixelRatio: number(
      'pixelratio',
      Math.min(window.devicePixelRatio || 1, 2),
      0.5,
      3,
    ),
    lodScale: number('lod', 1, 0.1, 4),
    // `plant` (default) tests one sphere per plant in the view pass. `leaf`
    // restores the renderer's own per-organ test, for comparison -- it is the
    // same answer at roughly five thousand times the cost.
    culling: params.get('culling') === 'leaf' ? 'leaf' : 'plant',
    // The leaf wind evaluates 3D simplex noise per vertex, per frame. Off, the
    // shader is never injected at all -- a strength of zero would still pay for
    // it, so this is the only honest way to measure what it costs.
    wind: params.get('wind') !== 'off',
  };
}

window.__ready = false;

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('app');
  const loadingScreen = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');
  const hint = document.getElementById('walk-hint');

  try {
    const options = readFieldOptions();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(options.pixelRatio);
    renderer.shadowMap.enabled = options.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const stage = await createFieldScene(renderer, {
      ...options,
      onProgress: (message) => {
        if (loadingText) loadingText.textContent = message;
      },
    });

    const walk = createWalkControls(stage.camera, renderer.domElement, {
      limit: stage.extent + 14,
    });
    const view = new FieldViewDriver(stage.fields);
    const hud = createFieldHUD(document.getElementById('ui-container'));

    function resize() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      renderer.setPixelRatio(options.pixelRatio);
      stage.camera.aspect = width / height;
      stage.camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    renderer.domElement.addEventListener('click', () => walk.controls.lock());
    walk.controls.addEventListener('lock', () =>
      hint?.setAttribute('hidden', ''),
    );
    walk.controls.addEventListener('unlock', () =>
      hint?.removeAttribute('hidden'),
    );

    // The sun follows the walker so a shadow map fitted to the garden keeps its
    // resolution wherever you stand, instead of covering ground you have left.
    const sunOffset = stage.sun.position.clone();

    const clock = new THREE.Clock();
    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      walk.update(delta);
      const viewStats = view.update(stage.camera);
      const windStarted = performance.now();
      stage.update(delta, elapsed);
      const windMs = performance.now() - windStarted;

      stage.sun.target.position.set(
        stage.camera.position.x,
        0,
        stage.camera.position.z,
      );
      stage.sun.position.copy(stage.sun.target.position).add(sunOffset);
      stage.sun.target.updateMatrixWorld();

      // Split the frame. `renderer.render` returning is CPU work finishing, not
      // the GPU finishing -- WebGL is asynchronous. So a large render time means
      // three.js and the driver are busy on the CPU, while a small one against a
      // long frame means we are waiting on the GPU. That distinction is the
      // whole question here, and it cannot be answered from the total.
      const renderStarted = performance.now();
      renderer.render(stage.scene, stage.camera);
      const renderMs = performance.now() - renderStarted;

      hud.update({
        delta,
        renderer,
        fields: stage.fields,
        view: viewStats,
        timings: { render: renderMs, wind: windMs, view: viewStats.ms },
      });
      requestAnimationFrame(animate);
    }

    // One frame before the loading screen lifts, so the first thing shown is
    // the garden rather than a blank canvas while shaders compile.
    renderer.render(stage.scene, stage.camera);

    if (loadingScreen) loadingScreen.hidden = true;
    window.__ready = true;
    window.__field = stage;
    window.dispatchEvent(new CustomEvent('field-ready'));
    animate();
  } catch (error) {
    console.error('Unable to start the field demo.', error);
    if (loadingText) {
      loadingText.textContent =
        'The field could not start. Check WebGL support, then reload.';
    }
    loadingScreen?.classList.add('bc-loading-error');
  }
});
