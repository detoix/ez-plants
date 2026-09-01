import { InstancedMesh2 } from '@detoix/instanced-mesh/webgpu';

import { PlantFieldCore } from './plant-field-core.js';
import {
  prepareWebGPUPlantInstance,
  prepareWebGPUPlantMaterial,
} from './plant-material-webgpu.js';

/**
 * WebGPU field backend. Known EZ-Plants leaf-wind and authored-normal hooks are
 * translated to TSL; unknown GLSL ShaderMaterial/onBeforeCompile hooks are
 * rejected instead of being silently dropped.
 */
export class PlantField extends PlantFieldCore {
  static InstancedMesh2 = InstancedMesh2;
  static prepareMaterial = prepareWebGPUPlantMaterial;
  static prepareInstance = prepareWebGPUPlantInstance;
  static useCustomShadowMaterials = false;
}

export default PlantField;
