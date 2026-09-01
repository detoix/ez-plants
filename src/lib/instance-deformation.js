const INSTANCE_DEFORMATION = Symbol.for(
  '@detoix/ez-plants/instance-deformation/v1',
);

export const MAGNUS_HEAD_DEFORMATION = 'magnus-head-ray-morph-v1';

/** Mark a known per-instance vertex deformation for backend translation. */
export function setInstanceDeformation(material, kind) {
  Object.defineProperty(material, INSTANCE_DEFORMATION, {
    configurable: true,
    value: Object.freeze({ kind }),
  });
  return material;
}

/** Return the backend-neutral deformation contract carried by a material. */
export function instanceDeformationForMaterial(material) {
  return material?.[INSTANCE_DEFORMATION] ?? null;
}
