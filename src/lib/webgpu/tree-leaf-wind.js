import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { Fn, mx_noise_float, positionLocal, sin, uniform, uv, vec3 } from 'three/tsl';

/**
 * A Tree installs its leaf wind through `LeafWind.apply`, which patches
 * `onBeforeCompile` and splices GLSL into the vertex shader. A WebGPU renderer
 * has no such hook -- it rebuilds each material from its properties -- so the
 * tree renders correctly and stands perfectly still. This entry point carries
 * that motion across as TSL nodes.
 *
 * It is deliberately a separate effect from the field backend's plant wind.
 * That one lives behind `./field/webgpu` and reaches the shader through
 * `@detoix/instanced-mesh`, which a single tree has no use for. The two are
 * kept in step by eye, not by contract: changing one does not change the other.
 *
 * The motion follows EZ-Tree's original: a low-frequency spatial offset drives
 * three stacked sine terms, and the leaf card's `uv.y` holds bases still while
 * tips travel. The offset comes from the built-in MaterialX gradient noise
 * rather than a second copy of the library's simplex; at the authored 70 m
 * scale a tree spans a fraction of one cell either way, so a canopy sways as
 * one body, which is what the GLSL path does too.
 */
const DEFAULTS = { strength: new THREE.Vector3(0.5, 0, 0.5), frequency: 0.5, scale: 70 };

/**
 * Create a wind controller shared by every tree in one scene: one clock, one
 * set of dials, one uniform write per frame however many trees there are.
 *
 * @param {object} [options]
 * @param {THREE.Vector3} [options.strength] World-space sway, metres.
 * @param {number} [options.frequency] Base oscillation rate.
 * @param {number} [options.scale] Metres per noise cell; larger sways a canopy
 *   more as one body, smaller breaks it into independent gusts.
 */
export function createTreeLeafWind({ strength, frequency, scale } = {}) {
  const uniforms = {
    time: uniform(0),
    strength: uniform(strength ? strength.clone() : DEFAULTS.strength.clone()),
    frequency: uniform(frequency ?? DEFAULTS.frequency),
    scale: uniform(scale ?? DEFAULTS.scale),
  };

  const displaced = Fn(() => {
    const offset = mx_noise_float(positionLocal.div(uniforms.scale)).mul(Math.PI * 2);
    const clock = uniforms.time.mul(uniforms.frequency);
    const signal = sin(clock.add(offset))
      .mul(0.5)
      .add(sin(clock.mul(2).add(offset.mul(1.3))).mul(0.3))
      .add(sin(clock.mul(5).add(offset.mul(1.5))).mul(0.2));
    return positionLocal.add(vec3(uniforms.strength).mul(signal).mul(uv().y));
  });

  const ported = new Set();

  /**
   * Mirrors `NodeLibrary.fromMaterial`: the node class for this material type,
   * every enumerable property carried over, then the dead GLSL hooks reset so
   * the compatibility boundary is explicit rather than inherited by accident.
   */
  const port = (source) => {
    const node = new MeshStandardNodeMaterial();
    for (const key in source) node[key] = source[key];
    node.uuid = THREE.MathUtils.generateUUID();
    node.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
    node.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
    node.positionNode = displaced();
    node.needsUpdate = true;
    return node;
  };

  return {
    uniforms,

    /**
     * Give one grown tree its wind, after `generateLODs`. Every level shares a
     * single leaf material, so one swap reaches all of them including the far
     * billboard. Returns the ported material, or undefined if there was
     * nothing left to do.
     *
     * @param {THREE.Object3D & { leavesMesh?: THREE.Mesh }} tree
     */
    applyTo(tree) {
      const source = tree?.leavesMesh?.material;
      // Already ported: a node material is this function's own output, and a
      // known source would mean two trees sharing one leaf set.
      if (!source || source.isNodeMaterial || ported.has(source)) return undefined;
      ported.add(source);
      const node = port(source);
      const seen = new Set();
      tree.traverse((object) => {
        if (object.material === source && !seen.has(object)) {
          seen.add(object);
          object.material = node;
        }
      });
      // Unreachable once every level points at the node material, and nothing
      // else shares it: one leaf material set per tree.
      source.dispose();
      return node;
    },

    /** Advance the shared clock. Call once per frame, not once per tree. */
    setTime(elapsedSeconds) {
      uniforms.time.value = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    },

    dispose() {
      ported.clear();
    },
  };
}
