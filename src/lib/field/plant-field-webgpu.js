import { InstancedMesh2 } from '@detoix/instanced-mesh/webgpu';

import { PlantFieldCore } from './plant-field-core.js';
import {
  prepareWebGPUPlantInstance,
  prepareWebGPUPlantMaterial,
} from './plant-material-webgpu.js';

/**
 * WebGPU field backend. Known EZ-Plants leaf-wind, Thuja hierarchy and
 * authored-normal hooks are translated to TSL; unknown GLSL
 * ShaderMaterial/onBeforeCompile hooks are rejected instead of being silently
 * dropped.
 */
export class PlantField extends PlantFieldCore {
  static InstancedMesh2 = InstancedMesh2;
  static prepareMaterial = prepareWebGPUPlantMaterial;
  static prepareInstance = prepareWebGPUPlantInstance;
  static useCustomShadowMaterials = false;

  /**
   * A `resolveLODIndex` callback cannot run inside a culling compute shader,
   * and installing one would send the whole wood mesh back to the CPU path.
   * The band is written as per-instance state instead, where the kernel reads
   * it -- the same decision, delivered as data.
   */
  static installWoodLODResolver() {}

  static applyWoodLevel(mesh, slot, renderLevel, shadowLevel) {
    mesh.setLODOverrideAt(slot, renderLevel);
    mesh.setLODOverrideAt(slot, shadowLevel, true);
  }
}

export default PlantField;
