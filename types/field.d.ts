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

export interface BandAssignmentOptions {
  count: number;
  bands: readonly { distance: number; hysteresis?: number }[];
  distanceOf: (index: number) => number;
  costOf: (index: number, band: number) => number;
  /** Last frame's assignment, for hysteresis. */
  previous?: Int32Array | null;
  /** Maximum total instances; `Infinity` to disable. */
  budget?: number;
}

export interface BandAssignment {
  /** Band per placement, or -1 for a placement dropped to stay in budget. */
  bands: Int32Array;
  total: number;
  demoted: number;
  dropped: number;
}

export declare function assignBands(
  options: BandAssignmentOptions,
): BandAssignment;

export interface PlantPlacement {
  position:
    | THREE.Vector3
    | [number, number, number]
    | { x: number; y: number; z: number };
  rotationY?: number;
  scale?: number;
  /** Index into `prototypes`; omitted, one is chosen from the placement index. */
  prototype?: number;
}

export interface PlantFieldOptions {
  prototypes: PlantPrototype[];
  placements: PlantPlacement[];
  /** Peak organ instances for the whole field, across every organ kind. */
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
  /** How many plants sit in each band. */
  bandCounts: number[];
  demoted: number;
  /** Plants dropped entirely because the budget could not seat them. */
  dropped: number;
  repacks: number;
}

/** Organ instances the whole field may draw at once, across every organ kind. */
export declare const DEFAULT_INSTANCE_BUDGET: number;

export declare class PlantField extends THREE.Group {
  constructor(options: PlantFieldOptions);
  /** Advance wind, and re-assign bands when a camera is supplied. */
  update(
    deltaSeconds?: number,
    elapsedSeconds?: number,
    camera?: THREE.Camera,
  ): this;
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
