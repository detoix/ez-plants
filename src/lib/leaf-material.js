import * as THREE from 'three';

import { LeafWind, createLeafWindShadowMaterials } from './leaf-wind.js';

/**
 * Keep a double-sided card's authored normals when it is seen from behind.
 *
 * Three flips the shading normal by `faceDirection` on back faces, which is
 * right for a solid surface and wrong for a card standing in for a rounded
 * mass. Half the cards clothing a flower head or a canopy face away from the
 * camera at any moment; flipping their normals turns them to face the viewer
 * and therefore *away* from the sun, and they shade black in the middle of a
 * lit plant. Authoring the normal a card would have if it were part of the
 * convex surface it approximates, and then leaving it alone, is EZ-Tree's own
 * answer for leaves and works the same for florets.
 */
export function keepAuthoredNormalsOnBackFaces(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace(
        'normal *= faceDirection;',
        '',
      ),
    );
  };
  material.customProgramCacheKey = () => 'authored-normals';
  return material;
}

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
  vertexColors = false,
  wind = new LeafWind(),
  windVariant = 'leaves',
  surfaceWindVariant = `${windVariant}-rounded-normals`,
  shadowWindVariant = windVariant,
} = {}) {
  if (!(wind instanceof LeafWind)) {
    throw new TypeError('A LeafWind controller is required.');
  }

  const surface = new THREE.MeshStandardMaterial({
    name,
    map,
    // Organs built as real geometry rather than textured cards carry their
    // own pattern in vertex colours; the instance colour then supplies the
    // season on top of it.
    vertexColors,
    color: new THREE.Color(tint),
    side: THREE.DoubleSide,
    alphaTest,
    metalness: 0,
    roughness: 1,
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

  return { surface, depth, distance };
}
