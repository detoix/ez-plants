import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const KEYS = new Map([
  ['KeyW', 'forward'],
  ['ArrowUp', 'forward'],
  ['KeyS', 'back'],
  ['ArrowDown', 'back'],
  ['KeyA', 'left'],
  ['ArrowLeft', 'left'],
  ['KeyD', 'right'],
  ['ArrowRight', 'right'],
  ['ShiftLeft', 'run'],
  ['ShiftRight', 'run'],
]);

/**
 * Walk the garden: pointer-lock look, WASD move, shift to hurry.
 *
 * Height is fixed and there is no jump or collision. Both are deliberate --
 * this page exists to show what a field costs to draw, and a plant you can walk
 * through is a better instrument than one you bump into.
 */
export function createWalkControls(camera, domElement, options = {}) {
  const {
    eyeHeight = 1.7,
    speed = 2.6,
    runSpeed = 6.4,
    // Acceleration and damping rather than instant velocity, so the LOD driver
    // is exercised by realistic movement instead of teleport-like steps.
    acceleration = 26,
    damping = 9,
    limit = Infinity,
  } = options;

  const controls = new PointerLockControls(camera, domElement);
  const pressed = new Set();
  const velocity = new THREE.Vector3();
  const direction = new THREE.Vector3();

  camera.position.y = eyeHeight;

  function onKeyDown(event) {
    const action = KEYS.get(event.code);
    if (!action) return;
    if (controls.isLocked) event.preventDefault();
    pressed.add(action);
  }

  function onKeyUp(event) {
    const action = KEYS.get(event.code);
    if (action) pressed.delete(action);
  }

  // Releasing the pointer lock while a key is held would otherwise leave the
  // walker drifting for as long as the page is unfocused.
  function onLockChange() {
    if (!controls.isLocked) pressed.clear();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  controls.addEventListener('lock', onLockChange);
  controls.addEventListener('unlock', onLockChange);

  function update(delta) {
    const forward =
      (pressed.has('forward') ? 1 : 0) - (pressed.has('back') ? 1 : 0);
    const strafe =
      (pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0);

    direction.set(strafe, 0, forward);
    if (direction.lengthSq() > 0) direction.normalize();

    const target = pressed.has('run') ? runSpeed : speed;
    velocity.x +=
      (direction.x * target - velocity.x) * Math.min(1, acceleration * delta);
    velocity.z +=
      (direction.z * target - velocity.z) * Math.min(1, acceleration * delta);
    if (direction.lengthSq() === 0) {
      const decay = Math.max(0, 1 - damping * delta);
      velocity.x *= decay;
      velocity.z *= decay;
    }

    if (controls.isLocked) {
      controls.moveRight(velocity.x * delta);
      controls.moveForward(velocity.z * delta);
    }

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -limit, limit);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -limit, limit);
    camera.position.y = eyeHeight;

    return Math.hypot(velocity.x, velocity.z);
  }

  function dispose() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    controls.removeEventListener('lock', onLockChange);
    controls.removeEventListener('unlock', onLockChange);
    controls.disconnect();
  }

  return { controls, update, dispose };
}
