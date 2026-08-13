import * as THREE from 'three';
import { createScene } from './scene';
import { readPlantStateFromUrl, setupPlantUI } from './plant-ui';
import { getPlantDescriptor } from './plants';

window.__ready = false;

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('app');
  const loadingScreen = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');

  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    // One live stage that swaps plants in place. Everything the previous
    // plant owned is disposed before the next one is built, so switching
    // species repeatedly does not leak GPU memory.
    let stage = null;
    let ui = null;

    async function mountPlant(state) {
      const descriptor = getPlantDescriptor(state.plant);
      stage = await createScene(renderer, descriptor, state);
      ui = setupPlantUI({
        descriptor,
        plant: stage.plant,
        initialState: { ...state, plant: descriptor.id },
        setReviewView: stage.setReviewView,
        onSelectPlant: (nextPlantId) => selectPlant(nextPlantId),
      });
      window.plant = stage.plant;
      window.setReviewView = (view) => ui.setView(view);
      resize();
      window.dispatchEvent(
        new CustomEvent('plant-ready', { detail: { plant: descriptor.id } }),
      );
    }

    async function selectPlant(nextPlantId) {
      const previous = ui.getState();
      const descriptor = getPlantDescriptor(nextPlantId);
      ui.destroy();
      stage.dispose();
      await mountPlant({
        ...previous,
        plant: descriptor.id,
        // Age and day are per-species meaningful, so fall back to the new
        // plant's defaults rather than carrying a currant's harvest date
        // onto a forsythia.
        age: Math.min(previous.age, descriptor.maxYears),
        day: descriptor.defaults.day,
        phenologyProfile: descriptor.profileControl.options[0][0],
      });
    }

    function resize() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (!stage) return;
      stage.camera.aspect = width / height;
      stage.camera.updateProjectionMatrix();
    }

    await mountPlant(readPlantStateFromUrl());

    const clock = new THREE.Clock();
    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      stage.plant.update(delta, elapsed, stage.camera);
      stage.controls.update();
      renderer.render(stage.scene, stage.camera);
      requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize();
    stage.controls.update();
    renderer.render(stage.scene, stage.camera);

    if (loadingScreen) loadingScreen.hidden = true;
    window.__ready = true;
    window.dispatchEvent(new CustomEvent('blackcurrant-ready'));
    animate();
  } catch (error) {
    console.error('Unable to start the garden digital twin.', error);
    if (loadingText) {
      loadingText.textContent =
        'The 3D garden could not start. Check WebGL support, then reload.';
    }
    loadingScreen?.classList.add('bc-loading-error');
    window.dispatchEvent(
      new CustomEvent('blackcurrant-error', { detail: { error } }),
    );
  }
});
