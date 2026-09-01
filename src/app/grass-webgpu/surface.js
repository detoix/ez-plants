import * as THREE from 'three/webgpu';

import { LAWN_COLORS } from './preset.js';
import {
  LAWN_MACRO_SAMPLE_LEVEL,
  LAWN_MACRO_WORLD_SIZE,
  LAWN_PBR_ASSET,
  LAWN_PBR_SECONDARY_UV_SCALE,
  LAWN_PBR_WORLD_SIZE,
  LAWN_UNDERLAY,
  lawnPBRGPUBytes,
  normalizeLawnUnderlay,
} from './surface-assets.js';

const {
  Fn,
  cameraPosition,
  float,
  mix,
  normalMap,
  positionWorld,
  smoothstep,
  texture: textureNode,
  textureLevel,
  vec2,
  vec3,
} = THREE.TSL;

const SECONDARY_UV_OFFSET = new THREE.Vector2(0.37, 0.19);
const MACRO_UV_OFFSET = new THREE.Vector2(0.23, 0.61);

function configureLawnTexture(texture, { colorSpace, anisotropy, name }) {
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export async function loadLawnPBRTextures({ loader } = {}) {
  const textureLoader = loader ?? new THREE.TextureLoader();
  const results = await Promise.allSettled([
    textureLoader.loadAsync(LAWN_PBR_ASSET.maps.albedoRoughness.url),
    textureLoader.loadAsync(LAWN_PBR_ASSET.maps.normal.url),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    for (const result of results) {
      if (result.status === 'fulfilled') result.value.dispose();
    }
    throw failed.reason;
  }
  const [albedoRoughness, normal] = results.map((result) => result.value);
  return { albedoRoughness, normal };
}

export async function createLawnSurface({ renderer, underlay, textures } = {}) {
  if (!renderer || typeof renderer.getMaxAnisotropy !== 'function') {
    throw new TypeError('The lawn surface needs an initialized renderer.');
  }

  const loaded = textures ?? (await loadLawnPBRTextures());
  if (!loaded?.albedoRoughness?.isTexture || !loaded?.normal?.isTexture) {
    throw new TypeError(
      'The lawn surface needs albedo/roughness and normal textures.',
    );
  }

  const anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  const albedoRoughnessTexture = configureLawnTexture(loaded.albedoRoughness, {
    colorSpace: THREE.SRGBColorSpace,
    anisotropy,
    name: 'Grass004 albedo + roughness',
  });
  const normalTexture = configureLawnTexture(loaded.normal, {
    colorSpace: THREE.NoColorSpace,
    anisotropy,
    name: 'Grass004 OpenGL normal',
  });

  // PlaneGeometry's v axis points towards -Z after it is rotated onto XZ.
  // Matching that orientation keeps the OpenGL tangent-space normal correct.
  const primaryUVAt = Fn(([worldXZ]) =>
    vec2(worldXZ.x, worldXZ.y.negate()).div(LAWN_PBR_WORLD_SIZE),
  );
  const secondaryUVAt = Fn(([worldXZ]) =>
    vec2(worldXZ.y, worldXZ.x)
      .div(LAWN_PBR_WORLD_SIZE)
      .mul(LAWN_PBR_SECONDARY_UV_SCALE)
      .add(SECONDARY_UV_OFFSET),
  );

  // The same source albedo supplies a deliberately coarse world-space signal
  // for both terrain variation and grass appearance. It is sampled explicitly
  // in compute, so placement never depends on fragment derivatives.
  const macroAt = Fn(([worldXZ]) => {
    const macroUV = vec2(worldXZ.x, worldXZ.y.negate())
      .div(LAWN_MACRO_WORLD_SIZE)
      .add(MACRO_UV_OFFSET);
    const macroGreen = textureLevel(
      albedoRoughnessTexture,
      macroUV,
      float(LAWN_MACRO_SAMPLE_LEVEL),
    ).g;
    return smoothstep(float(0.045), float(0.32), macroGreen);
  });

  const tintFrom = Fn(([macro]) =>
    vec3(mix(0.9, 1.06, macro), mix(0.94, 1.05, macro), mix(0.88, 0.99, macro)),
  );
  const densityFrom = Fn(([macro]) => mix(0.78, 1, macro));

  // Grass is visually isotropic, so blending a rotated, non-harmonic repeat is
  // an inexpensive way to break the obvious 1.4 m tile without extra assets.
  const pbrAt = Fn(([worldXZ, macro]) => {
    const primary = textureNode(albedoRoughnessTexture, primaryUVAt(worldXZ));
    const secondary = textureNode(
      albedoRoughnessTexture,
      secondaryUVAt(worldXZ),
    );
    return mix(primary, secondary, macro.mul(0.46).add(0.27));
  });

  const solidMaterial = new THREE.MeshStandardMaterial({
    color: LAWN_COLORS.ground,
    roughness: 1,
    metalness: 0,
  });
  solidMaterial.name = 'Solid lawn underlay control';

  const lawnMaterial = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
  });
  lawnMaterial.name = 'World-space Grass004 PBR lawn';
  const worldXZ = positionWorld.xz;
  const macro = macroAt(worldXZ).toVar('lawnSurfaceMacro');
  const pbr = pbrAt(worldXZ, macro).toVar('lawnPbrSample');
  const textureBlend = macro.mul(0.46).add(0.27);
  const primaryNormal = textureNode(normalTexture, primaryUVAt(worldXZ))
    .rgb.mul(2)
    .sub(1);
  const secondaryNormalRaw = textureNode(normalTexture, secondaryUVAt(worldXZ))
    .rgb.mul(2)
    .sub(1);
  const secondaryNormal = vec3(
    secondaryNormalRaw.y,
    secondaryNormalRaw.x.negate(),
    secondaryNormalRaw.z,
  );
  const packedNormal = mix(primaryNormal, secondaryNormal, textureBlend)
    .normalize()
    .mul(0.5)
    .add(0.5);
  const horizontalDistance = cameraPosition.xz.sub(worldXZ).length();
  const normalStrength = smoothstep(8, 24, horizontalDistance)
    .oneMinus()
    .mul(0.58);
  lawnMaterial.colorNode = pbr.rgb.mul(tintFrom(macro));
  lawnMaterial.roughnessNode = pbr.a.mul(0.22).add(0.76);
  lawnMaterial.normalNode = normalMap(packedNormal, vec2(normalStrength));

  let mode = normalizeLawnUnderlay(underlay);
  let disposed = false;

  function setMode(nextMode) {
    mode = normalizeLawnUnderlay(nextMode);
    return mode;
  }

  return {
    albedoRoughnessTexture,
    normalTexture,
    macroAt,
    tintFrom,
    densityFrom,
    solidMaterial,
    lawnMaterial,
    get mode() {
      return mode;
    },
    get material() {
      return mode === LAWN_UNDERLAY.lawn ? lawnMaterial : solidMaterial;
    },
    setMode,
    stats: Object.freeze({
      asset: LAWN_PBR_ASSET.id,
      maps: Object.keys(LAWN_PBR_ASSET.maps).length,
      encodedBytes: LAWN_PBR_ASSET.encodedBytes,
      gpuBytes: lawnPBRGPUBytes(),
      anisotropy,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      solidMaterial.dispose();
      lawnMaterial.dispose();
      albedoRoughnessTexture.dispose();
      normalTexture.dispose();
    },
  };
}

export { LAWN_UNDERLAY, normalizeLawnUnderlay };
