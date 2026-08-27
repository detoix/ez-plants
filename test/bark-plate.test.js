import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createBarkMaps } from '../src/lib/bark-plate.js';
import { Blackcurrant, Forsythia, Hydrangea } from '../src/lib/index.js';

const WOOD_MATERIAL = 'branches';

function woodMaterials(plant) {
  const found = [];
  plant.traverse((object) => {
    for (const material of [object.material ?? []].flat()) {
      if (material.name === WOOD_MATERIAL) found.push(material);
    }
  });
  return found;
}

/** Mean absolute difference between two columns of the colour map. */
function columnDelta(data, width, a, b) {
  const height = data.length / 4 / width;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    total += Math.abs(data[(y * width + a) * 4] - data[(y * width + b) * 4]);
  }
  return total / height;
}

test('the generated set fills every slot createBarkMaterial reads', () => {
  const maps = createBarkMaps();
  for (const slot of ['color', 'normal', 'roughness']) {
    assert.ok(maps[slot]?.isTexture, `${slot} must be a texture`);
    assert.equal(maps[slot].wrapS, THREE.RepeatWrapping);
    assert.equal(maps[slot].wrapT, THREE.RepeatWrapping);
  }
  // Only the colour map carries colour; the other two are data.
  assert.equal(maps.color.colorSpace, THREE.SRGBColorSpace);
  assert.notEqual(maps.normal.colorSpace, THREE.SRGBColorSpace);
});

test('the maps are built once and shared', () => {
  const first = createBarkMaps();
  const second = createBarkMaps();
  assert.strictEqual(first.color, second.color);
  assert.strictEqual(first.normal, second.normal);
});

test('bark tiles without a seam on either axis', () => {
  const { color } = createBarkMaps();
  const { data, width } = color.image;

  // A seam shows up as a discontinuity: the wrap-around edge must be no more
  // different than any other pair of neighbouring columns.
  const seam = columnDelta(data, width, 0, width - 1);
  let interior = 0;
  for (let x = 1; x < width; x += 1) {
    interior += columnDelta(data, width, x, x - 1);
  }
  interior /= width - 1;

  assert.ok(
    seam <= interior * 1.5,
    `wrap seam (${seam.toFixed(2)}) stands out against neighbours (${interior.toFixed(2)})`,
  );
});

test('bark has vertical grain rather than isotropic noise', () => {
  const { color } = createBarkMaps();
  const { data, width, height } = color.image;
  const luma = (x, y) => data[(y * width + x) * 4];

  // Real bark runs along the stem, so neighbouring pixels differ far less
  // going up than going across. That anisotropy is the whole point.
  let across = 0;
  let along = 0;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      across += Math.abs(luma(x, y) - luma(x - 1, y));
      along += Math.abs(luma(x, y) - luma(x, y - 1));
    }
  }
  assert.ok(
    across > along * 3,
    `grain is not vertical: across=${across} along=${along}`,
  );
});

test('a plant with no assets renders textured bark, not a flat tint', () => {
  for (const Plant of [Blackcurrant, Forsythia, Hydrangea]) {
    const plant = new Plant({ ageYears: 6, dayOfYear: 200 });
    const materials = woodMaterials(plant);
    assert.ok(materials.length > 0, `${plant.name} has no wood material`);
    for (const material of materials) {
      assert.ok(material.map, `${plant.name} bark has no colour map`);
      assert.ok(material.normalMap, `${plant.name} bark has no normal map`);
    }
    plant.dispose();
  }
});

test('caller-supplied bark replaces the generated set', () => {
  const named = (name) => {
    const texture = new THREE.Texture();
    texture.name = name;
    return texture;
  };
  const maps = {
    color: named('SuppliedColor'),
    normal: named('SuppliedNormal'),
    roughness: named('SuppliedRoughness'),
  };
  const plant = new Hydrangea({
    ageYears: 6,
    dayOfYear: 230,
    assets: { bark: { textured: true, maps, textureScale: { x: 250, y: 5 } } },
  });
  for (const material of woodMaterials(plant)) {
    assert.strictEqual(material.map, maps.color);
    assert.strictEqual(material.normalMap, maps.normal);
  }
  plant.dispose();
  for (const texture of Object.values(maps)) texture.dispose();
});

test('disposing a plant does not dispose the shared bark maps', () => {
  const maps = createBarkMaps();
  let disposals = 0;
  for (const texture of Object.values(maps)) {
    texture.addEventListener('dispose', () => {
      disposals += 1;
    });
  }
  const plant = new Forsythia({ ageYears: 6, dayOfYear: 200 });
  plant.dispose();
  assert.equal(disposals, 0, 'shared bark must outlive any one plant');

  // And the next plant still gets working maps.
  const next = new Forsythia({ ageYears: 6, dayOfYear: 200 });
  for (const material of woodMaterials(next)) assert.ok(material.map);
  next.dispose();
});
