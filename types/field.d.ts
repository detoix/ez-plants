import * as THREE from 'three';

import type { PlantDetail, PlantLODLevel, PlantRenderer } from './plants';

/* ==================================================================== *
 * Field rendering — opt-in
 *
 * Requires the optional peer `@three.ez/instanced-mesh`, and requires `three`
 * to be deduplicated in the consuming bundler. See the README.
 * ==================================================================== */

/** One organ kind, frozen at one band. */
export interface BakedOrgan {
  kind: string;
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
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
    | [number, number, number]
    | { x: number; y: number; z: number };
  rotationY?: number;
  scale?: number;
  /** Index into `prototypes`; omitted, one is chosen from the placement index. */
  prototype?: number;
  /** Which level to draw this plant at. Defaults to 0, the finest. */
  level?: number;
}

export interface PlantFieldOptions {
  prototypes: PlantPrototype[];
  placements: PlantPlacement[];
  /**
   * Organ instances you expect to afford, across every organ kind.
   *
   * Advice, not a governor: if the levels you set need more, the field draws
   * them anyway and reports `overBudget`. It never coarsens or drops a plant
   * you asked for.
   */
  budget?: number;
  /**
   * Strongly recommended. Without it, instanced-mesh initialises its buffers
   * during the first render and draws nothing on frame one — invisible in a
   * render loop, a blank image for a single-shot render.
   */
  renderer?: THREE.WebGLRenderer | null;
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
}

export interface PlantFieldStats {
  plants: number;
  prototypes: number;
  /** One per organ kind carrying instances, plus one per prototype's wood. */
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
  repacks: number;
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
