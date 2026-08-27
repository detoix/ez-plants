import * as THREE from 'three';

/**
 * Loads a plant's own leaf plate.
 *
 * Library rule 7 requires a plant to render correctly with no assets supplied
 * by the caller, so each plant carries its plate as a `leaf.webp` beside its
 * source and resolves it against its own module URL. That keeps the folder
 * portable: nothing points back at the demo app, and a bundler rewrites the
 * URL when the folder is copied into somebody else's project.
 *
 * Decoding an image needs a browser. In Node — the test environment, and any
 * server-side use — there is no decoder, so `loadLeafPlate` returns null and
 * the caller falls back to an untextured leaf. That is why the plate's shape
 * and size are asserted by reading its bytes (`test/texture-assets.test.js`)
 * rather than by loading it through Three.js.
 */

const cache = new Map();

/** True when Three.js can actually decode an image in this environment. */
export function canDecodeImages() {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/**
 * @param {URL|string} url - the plate, normally `new URL('./leaf.webp', import.meta.url)`
 * @returns {THREE.Texture | null} null where no image decoder exists
 */
export function loadLeafPlate(url) {
  if (!canDecodeImages()) return null;

  const key = String(url);
  if (cache.has(key)) return cache.get(key);

  // A missing plate must not leave a texture with a forever-undefined image:
  // that renders harmlessly but breaks GLTF export, so drop it from the cache.
  const texture = new THREE.TextureLoader().load(
    key,
    undefined,
    undefined,
    () => {
      cache.delete(key);
    },
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.name = 'LeafPlate';
  cache.set(key, texture);
  return texture;
}
