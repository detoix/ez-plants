import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { readFieldOptions } from '../src/app/field-runtime.js';
import { terrainHeightAt } from '../src/app/field-terrain-height.js';
import {
  LAWN_PBR_ASSET,
  LAWN_PBR_WORLD_SIZE,
  lawnPBRGPUBytes,
  mipmappedTextureBytes,
  normalizeLawnUnderlay,
} from '../src/app/grass-webgpu/surface-assets.js';
import {
  createLawnSurface,
  loadLawnPBRTextures,
} from '../src/app/grass-webgpu/surface.js';
import { webGPUBackdropHeight } from '../src/app/grass-webgpu/terrain.js';

function createTestTexture(size) {
  return new THREE.DataTexture(
    new Uint8Array(size * size * 4).fill(128),
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
}

test('the checked-in Grass004 derivatives match their documented metadata', () => {
  assert.equal(LAWN_PBR_ASSET.id, 'Grass004');
  assert.equal(LAWN_PBR_ASSET.license, 'CC0 1.0 Universal');
  assert.equal(LAWN_PBR_WORLD_SIZE, 1.4);

  let encodedBytes = 0;
  for (const map of Object.values(LAWN_PBR_ASSET.maps)) {
    const bytes = readFileSync(new URL(map.url));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length, map.encodedBytes);
    assert.equal(digest, map.sha256);
    encodedBytes += bytes.length;
  }
  assert.equal(encodedBytes, LAWN_PBR_ASSET.encodedBytes);

  const packed = readFileSync(new URL(LAWN_PBR_ASSET.maps.albedoRoughness.url));
  assert.equal(packed.toString('ascii', 0, 4), 'RIFF');
  assert.equal(packed.toString('ascii', 8, 12), 'WEBP');
  assert.ok(
    packed.includes(Buffer.from('ALPH')),
    'roughness must remain packed',
  );

  const normal = readFileSync(new URL(LAWN_PBR_ASSET.maps.normal.url));
  assert.deepEqual(Array.from(normal.subarray(0, 3)), [0xff, 0xd8, 0xff]);
  assert.equal(mipmappedTextureBytes(1024), 5_592_404);
  assert.equal(mipmappedTextureBytes(512), 1_398_100);
  assert.equal(lawnPBRGPUBytes(), 6_990_504);
});

test('underlay modes are whitelisted with the PBR lawn as the default', () => {
  assert.equal(normalizeLawnUnderlay('solid'), 'solid');
  assert.equal(normalizeLawnUnderlay('lawn'), 'lawn');
  assert.equal(normalizeLawnUnderlay(''), 'lawn');
  assert.equal(normalizeLawnUnderlay('photographic'), 'lawn');

  assert.equal(readFieldOptions('', 2).underlay, 'lawn');
  assert.equal(
    readFieldOptions('?underlay=solid&terrain=flat', 2).underlay,
    'solid',
  );
  assert.equal(readFieldOptions('?underlay=unknown', 2).underlay, 'lawn');
});

test('mixed field query defaults and diagnostics match the original field', () => {
  assert.deepEqual(
    (({ count, day, prototypes, budget, lodScale, wind }) => ({
      count,
      day,
      prototypes,
      budget,
      lodScale,
      wind,
    }))(readFieldOptions('', 2)),
    {
      count: 400,
      day: 230,
      prototypes: 3,
      budget: 1_600_000,
      lodScale: 1,
      wind: true,
    },
  );
  const custom = readFieldOptions(
    '?count=812&day=90&prototypes=6&budget=3200000&lod=0.6&culling=leaf&wind=off',
    2,
  );
  assert.equal(custom.count, 812);
  assert.equal(custom.day, 90);
  assert.equal(custom.prototypes, 6);
  assert.equal(custom.budget, 3_200_000);
  assert.equal(custom.lodScale, 0.6);
  assert.equal('culling' in custom, false);
  assert.equal(custom.wind, false);
});

test('live underlay switching retains two textures and two materials', async () => {
  const albedoRoughness = createTestTexture(4);
  const normal = createTestTexture(4);
  const surface = await createLawnSurface({
    renderer: { getMaxAnisotropy: () => 16 },
    underlay: 'solid',
    textures: { albedoRoughness, normal },
  });
  const solidMaterial = surface.solidMaterial;
  const lawnMaterial = surface.lawnMaterial;

  assert.equal(albedoRoughness.colorSpace, THREE.SRGBColorSpace);
  assert.equal(normal.colorSpace, THREE.NoColorSpace);
  for (const texture of [albedoRoughness, normal]) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.anisotropy, 8);
  }
  assert.equal(surface.stats.asset, 'Grass004');
  assert.equal(surface.stats.maps, 2);
  assert.equal(surface.stats.encodedBytes, 615_023);
  assert.equal(surface.stats.gpuBytes, 6_990_504);
  assert.strictEqual(surface.material, solidMaterial);

  assert.equal(surface.setMode('lawn'), 'lawn');
  assert.strictEqual(surface.material, lawnMaterial);
  assert.strictEqual(surface.albedoRoughnessTexture, albedoRoughness);
  assert.strictEqual(surface.normalTexture, normal);
  assert.strictEqual(surface.solidMaterial, solidMaterial);

  assert.equal(surface.setMode('solid'), 'solid');
  assert.strictEqual(surface.material, solidMaterial);
  assert.strictEqual(surface.lawnMaterial, lawnMaterial);

  surface.dispose();
  surface.dispose();
});

test('a partial PBR load failure disposes the map that did load', async () => {
  const fulfilled = createTestTexture(2);
  let disposed = 0;
  fulfilled.addEventListener('dispose', () => {
    disposed += 1;
  });
  const loader = {
    loadAsync(url) {
      return url.endsWith('.webp')
        ? Promise.resolve(fulfilled)
        : Promise.reject(new Error('normal failed'));
    },
  };

  await assert.rejects(loadLawnPBRTextures({ loader }), /normal failed/);
  assert.equal(disposed, 1);
});

test('the horizon backdrop stays below every sampled terrain hollow', () => {
  const amplitude = 1.15;
  const backdrop = webGPUBackdropHeight(amplitude);
  assert.equal(backdrop, -1.94);

  for (let z = -130; z <= 130; z += 2) {
    for (let x = -130; x <= 130; x += 2) {
      assert.ok(
        terrainHeightAt(x, z, { amplitude }) > backdrop,
        `terrain at ${x},${z} fell through the horizon backdrop`,
      );
    }
  }
});
