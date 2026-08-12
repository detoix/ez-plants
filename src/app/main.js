import * as THREE from 'three';
import { createScene } from './scene';
import {
  readBlackcurrantStateFromUrl,
  setupBlackcurrantUI,
} from './blackcurrant-ui';

window.__ready = false;

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('app');
  const loadingScreen = document.getElementById('loading-screen');
  const loadingText = document.getElementById('loading-text');

  try {
    const initialState = readBlackcurrantStateFromUrl();

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

    const { scene, plant, camera, controls, setReviewView } = await createScene(
      renderer,
      initialState,
    );

    const ui = setupBlackcurrantUI({
      plant,
      initialState,
      setReviewView,
    });

    // Stable camera hooks make visual regression captures reproducible while
    // leaving OrbitControls available for normal exploration.
    window.setReviewView = (view) => ui.setView(view);
    window.blackcurrant = plant;

    const clock = new THREE.Clock();
    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      plant.update?.(delta, elapsed, camera);
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    function resize() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    window.addEventListener('resize', resize);
    resize();
    controls.update();
    renderer.render(scene, camera);

    if (loadingScreen) loadingScreen.hidden = true;
    window.__ready = true;
    window.dispatchEvent(new CustomEvent('blackcurrant-ready'));
    animate();
  } catch (error) {
    console.error('Unable to start the blackcurrant digital twin.', error);
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
