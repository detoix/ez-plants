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

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const HALF_PI = Math.PI / 2;

/** How far the nub travels before the stick is at full tilt, in CSS pixels. */
const STICK_RADIUS = 52;
/** Past this much tilt the walker runs, which is what a shift key does. */
const STICK_RUN_AT = 0.86;
/** Radians of look per CSS pixel dragged. Tuned against a thumb, not a mouse. */
const TOUCH_LOOK_SPEED = 0.0042;

/**
 * Walk the garden: pointer-lock look and WASD on a desktop, a thumbstick and
 * drag-to-look on a touch screen.
 *
 * The touch path is not a convenience. Pointer lock does not exist on a phone
 * and neither does a keyboard, so without it the walkaround has no input at
 * all: the page loads, shows one fixed view, and cannot be moved. Neither path
 * is chosen by sniffing the device: the keys are always listening, and the
 * thumbstick arms itself the first time the canvas is touched. A touchscreen
 * laptop therefore ends up with both, working at the same time.
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
    // The element the thumbstick is appended to and positioned within. It must
    // be a containing block, and it must be the one the canvas fills, or the
    // stick will not appear under the thumb that summoned it.
    stickHost = domElement.parentElement ?? document.body,
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

  /* -------------------------------------------------------------------- *
   * Touch: a floating thumbstick to walk, a drag anywhere else to look
   * -------------------------------------------------------------------- */

  // A floating stick rather than a fixed one. A fixed pad has to be aimed at
  // before it can be pushed, which on a phone means looking down at the screen
  // furniture instead of at the garden; a stick that appears under the thumb
  // wherever it lands needs no aiming at all.
  const stick = document.createElement('div');
  stick.className = 'fx-stick';
  stick.hidden = true;
  stick.setAttribute('aria-hidden', 'true');
  const nub = document.createElement('div');
  nub.className = 'fx-stick-nub';
  stick.append(nub);
  stickHost.append(stick);

  /** Set once the visitor touches the canvas: this session walks by thumb. */
  let touchDriving = false;
  const move = { pointerId: null, originX: 0, originY: 0, x: 0, y: 0, tilt: 0 };
  const look = { pointerId: null, x: 0, y: 0 };
  const listeners = [];

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    listeners.push([target, type, handler, opts]);
  }

  function placeStick(clientX, clientY) {
    const host = stickHost.getBoundingClientRect();
    stick.style.left = `${clientX - host.left}px`;
    stick.style.top = `${clientY - host.top}px`;
    nub.style.transform = 'translate(-50%, -50%)';
    stick.hidden = false;
  }

  function releaseStick() {
    move.pointerId = null;
    move.x = 0;
    move.y = 0;
    move.tilt = 0;
    stick.hidden = true;
  }

  function onPointerDown(event) {
    if (event.pointerType !== 'touch') return;
    touchDriving = true;
    // The left third is the stick and everything else looks around, so a right
    // thumb can steer and a left one can walk at the same time. Two fingers on
    // the same side is not a gesture this page has any use for, so whichever
    // arrived first keeps its role until it lifts.
    const wantsStick = event.clientX < window.innerWidth * 0.36;
    if (wantsStick && move.pointerId === null) {
      move.pointerId = event.pointerId;
      move.originX = event.clientX;
      move.originY = event.clientY;
      placeStick(event.clientX, event.clientY);
    } else if (look.pointerId === null) {
      look.pointerId = event.pointerId;
      look.x = event.clientX;
      look.y = event.clientY;
    } else {
      return;
    }
    // Capture so a thumb that slides off the canvas edge -- onto the HUD, or
    // past the screen edge mid-turn -- keeps steering instead of silently
    // stopping. Not every browser will grant it, and none of this depends on
    // it, so a refusal is not an error.
    try {
      domElement.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer is gone already; the up handler will tidy up */
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerId === move.pointerId) {
      const dx = event.clientX - move.originX;
      const dy = event.clientY - move.originY;
      const distance = Math.hypot(dx, dy);
      const tilt = Math.min(1, distance / STICK_RADIUS);
      const scale = distance > 0 ? (tilt * STICK_RADIUS) / distance : 0;
      nub.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
      move.x = distance > 0 ? (dx / distance) * tilt : 0;
      // Screen-down is walk-backwards, so the sign flips into world forward.
      move.y = distance > 0 ? (-dy / distance) * tilt : 0;
      move.tilt = tilt;
      event.preventDefault();
      return;
    }
    if (event.pointerId !== look.pointerId) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= (event.clientX - look.x) * TOUCH_LOOK_SPEED;
    _euler.x -= (event.clientY - look.y) * TOUCH_LOOK_SPEED;
    _euler.x = Math.max(-HALF_PI, Math.min(HALF_PI, _euler.x));
    camera.quaternion.setFromEuler(_euler);
    look.x = event.clientX;
    look.y = event.clientY;
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (event.pointerId === move.pointerId) releaseStick();
    else if (event.pointerId === look.pointerId) look.pointerId = null;
  }

  on(domElement, 'pointerdown', onPointerDown);
  on(domElement, 'pointermove', onPointerMove);
  on(domElement, 'pointerup', onPointerUp);
  on(domElement, 'pointercancel', onPointerUp);
  // A touch that leaves the canvas is a lifted thumb as far as walking goes.
  on(window, 'blur', releaseStick);

  function update(delta) {
    const forward =
      (pressed.has('forward') ? 1 : 0) - (pressed.has('back') ? 1 : 0) + move.y;
    const strafe =
      (pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0) + move.x;

    direction.set(strafe, 0, forward);
    // A key is on or off; a thumb is not. Half a stick is half the speed, so
    // the walker can be edged between two plants instead of only sprinting.
    const throttle = Math.min(1, direction.length());
    if (direction.lengthSq() > 0) direction.normalize();

    const running = pressed.has('run') || move.tilt > STICK_RUN_AT;
    const target = (running ? runSpeed : speed) * throttle;
    velocity.x +=
      (direction.x * target - velocity.x) * Math.min(1, acceleration * delta);
    velocity.z +=
      (direction.z * target - velocity.z) * Math.min(1, acceleration * delta);
    if (direction.lengthSq() === 0) {
      const decay = Math.max(0, 1 - damping * delta);
      velocity.x *= decay;
      velocity.z *= decay;
    }

    if (controls.isLocked || touchDriving) {
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
    for (const [target, type, handler, opts] of listeners) {
      target.removeEventListener(type, handler, opts);
    }
    stick.remove();
    controls.disconnect();
  }

  return {
    controls,
    update,
    dispose,
    /** True once this session has been driven by touch rather than a mouse. */
    get isTouchDriving() {
      return touchDriving;
    },
    /** Fires when the walker first takes control, by either input. */
    onEngaged(callback) {
      controls.addEventListener('lock', callback);
      on(domElement, 'pointerdown', (event) => {
        if (event.pointerType === 'touch') callback();
      });
    },
  };
}
