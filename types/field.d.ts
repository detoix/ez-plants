import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';

import type { PlantDetail, PlantLODLevel, PlantRenderer } from './plants';

/* ==================================================================== *
 * Field rendering — opt-in
 *
 * Requires the optional peer `@detoix/instanced-mesh`, and requires `three`
 * r185 to be deduplicated in the consuming bundler. The same field API is
 * exposed by `./field` (WebGL) and `./field/webgpu` (WebGPU). The WebGPU entry
 * translates the library's known leaf-wind, Thuja hierarchy, and
 * authored-normal hooks to TSL; unknown GLSL `ShaderMaterial` or
 * `onBeforeCompile` customization is rejected.
 * See the README.
 * ==================================================================== */

/** One organ kind, frozen at one band. */
export interface BakedOrgan {
  kind: string;
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  customDepthMaterial?: THREE.Material;
  customDistanceMaterial?: THREE.Material;
  count: number;
  matrices: Float32Array;
  colors: Float32Array | null;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface BakedPlant {
  plantId: string;
  name: string;
  seed: string | number;
  ageYears: number;
  dayOfYear: number;
  detail: PlantDetail;
  wood: { geometry: THREE.BufferGeometry; material: THREE.Material } | null;
  organs: BakedOrgan[];
  bounds: THREE.Box3;
  dispose(): void;
}

export interface PrototypeBand {
  distance: number;
  hysteresis: number;
  baked: BakedPlant;
}

/**
 * One plant frozen at every band it will be drawn at.
 *
 * Holds the source plant's materials, so **the plant must stay alive** for as
 * long as the prototype is used.
 */
export interface PlantPrototype {
  id: string;
  plant: PlantRenderer;
  bands: PrototypeBand[];
  /** Read off what the plant baked, never from a species list. */
  organKinds: string[];
  bounds: THREE.Box3;
  organCount(kind: string, band: number): number;
  instanceCount(band: number): number;
  /** Releases the prototype's wood copies. Never the plant's own resources. */
  dispose(): void;
}

export interface PrototypeOptions {
  /** Bands to bake at. Defaults to the plant's own `lodLevels`. */
  levels?: readonly PlantLODLevel[];
  id?: string;
}

export declare function createPlantPrototype(
  plant: PlantRenderer,
  options?: PrototypeOptions,
): PlantPrototype;

export declare function createPrototypePool(
  plants: readonly PlantRenderer[],
  options?: PrototypeOptions,
): PlantPrototype[];

export interface PlantPlacement {
  position:
    | THREE.Vector3
    | readonly [number, number, number]
    | { x: number; y: number; z: number };
  rotationY?: number;
  scale?: number;
  /** Index into `prototypes`; omitted, one is chosen from the placement index. */
  prototype?: number;
  /** Which level to draw this plant at. Defaults to 0, the finest. */
  level?: number;
}

/** Renderer accepted by one of the two field backends. */
export type PlantFieldRenderer = THREE.WebGLRenderer | WebGPURenderer;

export interface PlantFieldOptions {
  prototypes: readonly PlantPrototype[];
  placements: readonly PlantPlacement[];
  /**
   * Organ instances you expect to afford, across every organ kind.
   *
   * Advice, not a governor: if the levels you set need more, the field draws
   * them anyway and reports `overBudget`. It never coarsens or drops a plant
   * you asked for.
   */
  budget?: number;
  /**
   * Renderer for the selected field backend: `WebGLRenderer` for `./field`, or
   * `WebGPURenderer` for `./field/webgpu`.
   *
   * Passing the renderer is strongly recommended for WebGL. Without it,
   * instanced-mesh initialises its buffers during the first render and draws
   * nothing on frame one — invisible in a render loop, a blank image for a
   * single-shot render. WebGPU storage buffers are initialized eagerly.
   */
  renderer?: PlantFieldRenderer | null;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Let instanced-mesh frustum-test every organ instance. Defaults to `true`.
   *
   * Disable this when culling whole plants with `placementSphere()` and
   * `setVisibility()`; otherwise the renderer repeats that work per organ.
   */
  perInstanceCulling?: boolean;
  name?: string;
}

export interface PlantFieldStats {
  plants: number;
  prototypes: number;
  /** One per active organ-geometry rung, plus one per prototype's wood. */
  drawCalls: number;
  organDrawCalls: number;
  woodDrawCalls: number;
  organInstances: number;
  budget: number;
  /**
   * The levels you chose need more instances than you budgeted for. The field
   * drew them regardless; this is a number to act on, not a state it fixed.
   */
  overBudget: boolean;
  /** How many placements sit at each level. */
  levelCounts: number[];
  /** Placements currently drawn; the rest are hidden by `setVisibility`. */
  visiblePlants: number;
  /**
   * Placements whose organ instances have been written since construction,
   * including the initial build.
   */
  repacks: number;
  /** Organ instances written since construction. */
  instanceWrites: number;
  /** Active and inactive slots currently spanned by all organ buffers. */
  slots: number;
  /** The current slot span for each organ kind. */
  slotsByKind: Record<string, number>;
  /** Inactive slots inside `slots`; `compact()` reclaims them. */
  unusedSlots: number;
}

/** Organ instances the whole field may draw at once, across every organ kind. */
export declare const DEFAULT_INSTANCE_BUDGET: number;

export declare class PlantField extends THREE.Group {
  constructor(options: PlantFieldOptions);
  /** The level each placement draws at. A copy; use `setLevels` to change. */
  readonly levels: number[];
  /** Set every placement's level at once. One index per placement. */
  setLevels(levels: ArrayLike<number>): this;
  /** Set one placement's level. */
  setLevelAt(index: number, level: number): this;
  /**
   * The visibility of each placement. A copy; use `setVisibility` or
   * `setVisibleAt` to change it. This is distinct from `Object3D.visible`,
   * which controls the entire field group.
   */
  readonly visibility: boolean[];
  /** Show or hide one placement, including its organs and wood. */
  setVisibleAt(index: number, visible: boolean): this;
  /** Show or hide every placement at once. One flag per placement. */
  setVisibility(flags: ArrayLike<boolean | number>): this;
  /**
   * Get one placement's bounding sphere in field-local coordinates.
   *
   * The optional target is populated and returned. If the field group itself
   * is transformed, apply its `matrixWorld` before testing in world space.
   */
  placementSphere(index: number, target?: THREE.Sphere): THREE.Sphere;
  /**
   * Repack every placement to reclaim inactive instance slots. This rewrites
   * the whole field and should not be called inside a render loop.
   */
  compact(): this;
  /**
   * Advance wind. Takes no camera: levels are `setLevels` / `setLevelAt`, and
   * they change only when you say so.
   */
  update(deltaSeconds?: number, elapsedSeconds?: number): this;
  stats(): PlantFieldStats;
  /** Releases the field's meshes. Never the prototypes or the source plants. */
  dispose(): void;
}

export declare function inspectInstancingPatch(
  chunks?: Record<string, string>,
): {
  patched: boolean;
  missing: string[];
};

export declare function assertInstancingPatch(
  chunks?: Record<string, string>,
): void;

export declare function warnOnMissingInstancingPatch(
  chunks?: Record<string, string>,
): boolean;
