import type { Material } from 'three';

/**
 * Clone a plant material into the WebGPU field's supported TSL representation.
 * Known leaf wind, Thuja hierarchy, and authored back-face normals are
 * preserved; unknown GLSL hooks are rejected.
 */
export declare function prepareWebGPUPlantMaterial(
  material: Material,
): Material;

/**
 * WebGPU field entry point.
 *
 * Its field/prototype API is shared with `./field`; the WebGL-only ShaderChunk
 * guard functions are deliberately not re-exported here because they do not
 * exist in the WebGPU runtime module.
 */
export {
  DEFAULT_INSTANCE_BUDGET,
  PlantField,
  createPlantPrototype,
  createPrototypePool,
  type BakedOrgan,
  type BakedPlant,
  type PlantFieldOptions,
  type PlantFieldRenderer,
  type PlantFieldStats,
  type PlantPlacement,
  type PlantPrototype,
  type PrototypeBand,
  type PrototypeOptions,
} from './field';
