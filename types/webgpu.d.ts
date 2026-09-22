import type { Mesh, Object3D, Vector3 } from 'three';
import type { Material } from 'three';

export interface TreeLeafWindOptions {
  /** World-space sway, in metres. */
  strength?: Vector3;
  /** Base oscillation rate. */
  frequency?: number;
  /** Metres per noise cell. */
  scale?: number;
}

export interface TreeLeafWind {
  readonly uniforms: {
    time: unknown;
    strength: unknown;
    frequency: unknown;
    scale: unknown;
  };
  /**
   * Port one grown tree's leaf material to a node material carrying the wind.
   * Returns the ported material, or undefined when there was nothing to do.
   */
  applyTo(tree: Object3D & { leavesMesh?: Mesh }): Material | undefined;
  /** Advance the shared clock. Once per frame, not once per tree. */
  setTime(elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Carry EZ-Tree's GLSL leaf wind across to TSL, so trees sway under a WebGPU
 * renderer. Separate from the field backend's plant wind, and free of
 * `@detoix/instanced-mesh`.
 */
export declare function createTreeLeafWind(
  options?: TreeLeafWindOptions,
): TreeLeafWind;
