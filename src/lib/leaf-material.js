import * as THREE from 'three';

import { LeafWind, createLeafWindShadowMaterials } from './leaf-wind.js';

/**
 * Create one EZ-Tree leaf surface material and its matching shadow passes.
 * The caller owns the texture and supplies it directly; no asset URL or leaf
 * variant is embedded in the shared library.
 */
export function createLeafMaterialSet({
  name = 'leaves',
  map = null,
  tint = 0xffffff,
  alphaTest = 0,
  roundedNormals = true,
  wind = new LeafWind(),
  windVariant = 'leaves',
  surfaceWindVariant = `${windVariant}-rounded-normals`,
  shadowWindVariant = windVariant,
} = {}) {
  if (!(wind instanceof LeafWind)) {
    throw new TypeError('A LeafWind controller is required.');
  }

  const surface = new THREE.MeshPhongMaterial({
    name,
    map,
    color: new THREE.Color(tint),
    side: THREE.DoubleSide,
    alphaTest,
    dithering: true,
  });

  wind.apply(surface, {
    variant: surfaceWindVariant,
    afterCompile: (shader) => {
      shader.uniforms.uCustomNormals = { value: roundedNormals };
      // Preserve EZ-Tree's rounded canopy normals on double-sided leaves.
      shader.fragmentShader =
        `uniform bool uCustomNormals;\n` +
        shader.fragmentShader.replace(
          '#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace(
            'normal *= faceDirection;',
            'if (!uCustomNormals) { normal *= faceDirection; }',
          ),
        );
    },
  });

  const { depth, distance } = createLeafWindShadowMaterials(wind, {
    map,
    alphaTest,
    side: THREE.DoubleSide,
    variant: shadowWindVariant,
  });

  return { surface, depth, distance, wind };
}
