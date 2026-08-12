import * as THREE from 'three';

/**
 * Apply the texture wrapping contract used by EZ-Tree's bark material.
 * Circumference tiling is baked into woody geometry UVs, so only the
 * longitudinal repeat is applied to the texture itself.
 */
export function configureBarkTexture(texture, textureScaleY = 1) {
  if (!texture) return null;
  if (!Number.isFinite(textureScaleY) || textureScaleY <= 0) {
    throw new RangeError('Bark textureScale.y must be a positive number.');
  }

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1 / textureScaleY);
  return texture;
}

/**
 * Create the shared PBR bark material introduced by EZ-Tree v2.
 * Species renderers provide only their tint, age styling and texture maps.
 */
export function createBarkMaterial({
  name = 'branches',
  tint = 0xffffff,
  flatShading = false,
  textured = false,
  textureScale = new THREE.Vector2(1, 1),
  maps = {},
  roughness = 1,
  metalness = 0,
  normalScale,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    name,
    flatShading,
    color: new THREE.Color(tint),
    metalness,
    roughness,
  });

  if (!textured) return material;

  const scaleY = textureScale?.y ?? 1;
  material.map = configureBarkTexture(maps.color, scaleY);
  material.aoMap = configureBarkTexture(maps.ao, scaleY);
  material.normalMap = configureBarkTexture(maps.normal, scaleY);
  material.roughnessMap = configureBarkTexture(maps.roughness, scaleY);

  if (material.normalMap && normalScale != null) {
    material.normalScale.copy(
      normalScale.isVector2
        ? normalScale
        : new THREE.Vector2(normalScale, normalScale),
    );
  }

  // Retain EZ-Tree v2's exact bark-slot contract. With metalness fixed at zero
  // this does not make bark metallic, and keeps the material exporter-friendly.
  if (material.roughnessMap) material.metalnessMap = material.roughnessMap;

  return material;
}
