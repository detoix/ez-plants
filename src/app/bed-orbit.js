import * as THREE from 'three/webgpu';

/**
 * A slow orbit around the bed, with the viewer able to take over.
 *
 * ## Why not the walk controls
 *
 * `grass-webgpu/controls.js` is built for the field: pointer lock, WASD, and a
 * thumbstick on touch. That is the right interface for walking a hectare and
 * the wrong one for a single bed you want to film -- it needs a hand on the
 * keyboard for every second of footage, and pointer lock means the recording
 * starts with a permission prompt. This drifts on its own, so the page can be
 * left running and captured, and a drag interrupts it for as long as somebody
 * is actually steering.
 */

const MIN_PHI = 0.12;
const MAX_PHI = Math.PI / 2 - 0.06;
/** Seconds of stillness after a drag before the orbit picks itself back up. */
const RESUME_AFTER = 3.5;

export function createBedOrbit(
  camera,
  domElement,
  {
    target = new THREE.Vector3(0, 0.7, 0),
    radius = 11,
    minRadius = 4.5,
    maxRadius = 26,
    autoSpeed = 0.055,
    theta = Math.PI / 2 - 0.55,
    phi = 1.02,
  } = {},
) {
  if (!camera?.isCamera) throw new TypeError('The orbit needs a camera.');
  if (!domElement) throw new TypeError('The orbit needs an element to bind.');

  const focus = target.clone();
  const state = { theta, phi, radius };
  const pointers = new Map();
  let idleFor = RESUME_AFTER;
  let auto = true;
  let pinchDistance = 0;

  function clampPhi(value) {
    return Math.min(MAX_PHI, Math.max(MIN_PHI, value));
  }

  function clampRadius(value) {
    return Math.min(maxRadius, Math.max(minRadius, value));
  }

  function apply() {
    const sinPhi = Math.sin(state.phi);
    camera.position.set(
      focus.x + state.radius * sinPhi * Math.cos(state.theta),
      focus.y + state.radius * Math.cos(state.phi),
      focus.z + state.radius * sinPhi * Math.sin(state.theta),
    );
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
  }

  function onPointerDown(event) {
    domElement.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    idleFor = 0;
    if (pointers.size === 2) pinchDistance = currentPinch();
  }

  function currentPinch() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    idleFor = 0;

    if (pointers.size >= 2) {
      const distance = currentPinch();
      if (pinchDistance > 0 && distance > 0) {
        state.radius = clampRadius(state.radius * (pinchDistance / distance));
      }
      pinchDistance = distance;
      apply();
      return;
    }

    // Adding, not subtracting, and the sign is not arbitrary. Three's own
    // OrbitControls measures azimuth from +Z towards +X and subtracts here;
    // this measures it from +X towards +Z, which is the opposite handedness,
    // so the same subtraction spins the bed the wrong way under the hand.
    state.theta += dx * 0.005;
    state.phi = clampPhi(state.phi - dy * 0.005);
    apply();
  }

  function onPointerUp(event) {
    domElement.releasePointerCapture?.(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    idleFor = 0;
  }

  function onWheel(event) {
    event.preventDefault();
    state.radius = clampRadius(state.radius * Math.exp(event.deltaY * 0.0012));
    idleFor = 0;
    apply();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.style.touchAction = 'none';
  apply();

  return {
    get autoRotating() {
      return auto && pointers.size === 0 && idleFor >= RESUME_AFTER;
    },
    setAuto(enabled) {
      auto = Boolean(enabled);
      return auto;
    },
    /** Re-frame without losing the current angle -- used when the bed reloads. */
    frame({ target: nextTarget, radius: nextRadius } = {}) {
      if (nextTarget) focus.copy(nextTarget);
      if (Number.isFinite(nextRadius)) state.radius = clampRadius(nextRadius);
      apply();
    },
    update(deltaSeconds) {
      if (pointers.size === 0) idleFor += deltaSeconds;
      if (auto && pointers.size === 0 && idleFor >= RESUME_AFTER) {
        state.theta += autoSpeed * deltaSeconds;
        apply();
      }
    },
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
      pointers.clear();
    },
  };
}
