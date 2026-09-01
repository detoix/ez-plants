import { InstancedMesh2 } from '@detoix/instanced-mesh';

import { PlantFieldCore } from './plant-field-core.js';
import { assertInstancingPatch } from './three-copy-guard.js';

export { DEFAULT_INSTANCE_BUDGET } from './plant-field-core.js';

/** WebGL field backend. The public API lives in PlantFieldCore. */
export class PlantField extends PlantFieldCore {
  static InstancedMesh2 = InstancedMesh2;
  static validateBackend = assertInstancingPatch;
}

export default PlantField;
