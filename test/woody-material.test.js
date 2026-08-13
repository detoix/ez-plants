import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  calculateBarkTextureWraps,
  configureBarkTexture,
  createBarkMaterial,
} from '../src/lib/woody-material.js';

test('bark wrap count follows EZ-Tree v2 radius scaling', () => {
  assert.equal(calculateBarkTextureWraps(0, 250), 1);
  assert.equal(calculateBarkTextureWraps(0.0059, 250), 1);
  assert.equal(calculateBarkTextureWraps(0.006, 250), 2);
  assert.equal(calculateBarkTextureWraps(0.01, 250), 3);
  assert.throws(
    () => calculateBarkTextureWraps(-0.01, 250),
    /base radius must be finite and non-negative/i,
  );
  assert.throws(
    () => calculateBarkTextureWraps(0.01, 0),
    /textureScale\.x must be a positive number/i,
  );
});

test('shared EZ-Tree bark material uses PBR maps and repeat wrapping', () => {
  const maps = {
    color: new THREE.Texture(),
    ao: new THREE.Texture(),
    normal: new THREE.Texture(),
    roughness: new THREE.Texture(),
  };
  const material = createBarkMaterial({
    tint: 0x766352,
    textured: true,
    textureScale: new THREE.Vector2(4, 0.25),
    maps,
    normalScale: 0.2,
  });

  assert.ok(material.isMeshStandardMaterial);
  assert.equal(material.map, maps.color);
  assert.equal(material.aoMap, maps.ao);
  assert.equal(material.normalMap, maps.normal);
  assert.equal(material.roughnessMap, maps.roughness);
  assert.equal(material.metalnessMap, maps.roughness);
  for (const texture of Object.values(maps)) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [1, 4]);
    assert.equal(texture.version, 0);
  }
  assert.deepEqual(material.normalScale.toArray(), [0.2, 0.2]);
  material.dispose();
  for (const texture of Object.values(maps)) texture.dispose();
});

test('untextured bark does not mutate supplied maps', () => {
  const texture = new THREE.Texture();
  const material = createBarkMaterial({
    textured: false,
    maps: { color: texture },
  });
  assert.equal(material.map, null);
  assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
  material.dispose();
  texture.dispose();
});

test('bark texture scale rejects invalid longitudinal repeats', () => {
  assert.throws(
    () => configureBarkTexture(new THREE.Texture(), 0),
    /positive number/,
  );
});
