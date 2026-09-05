import * as THREE from 'three/webgpu';

import { BED_BOULDERS, bedOutline } from './bed-layout.js';

/**
 * Everything in the bed that is not a plant: bark mulch, a cobble edging and
 * the boulders.
 *
 * ## Why the textures are generated here
 *
 * The lawn earns its CC0 PBR set because it fills the frame and its provenance
 * is recorded. Mulch is read at a metre or two, under planting, and adding
 * another CC0 texture set to the repository for that would cost more in
 * download and in provenance bookkeeping than it buys. It is a value-noise
 * fBm map with a normal derived from the same height field: deterministic,
 * seeded, and about 200 KB of GPU memory.
 *
 * ## Why `three/webgpu`
 *
 * `rocks.js` and `clouds.js` build the single-plant page's scene from plain
 * `three`. Mixing those objects into the WebGPU runtime is what the field's
 * three-copy guard exists to catch, so this module builds its own.
 */

/* A small tile carrying high-frequency, low-contrast detail. A larger tile
   repeats less often but has to hold bigger features to stay interesting, and
   those bigger features are exactly what makes the repeat legible. */
const MULCH_TILE = 1.0;

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Tileable value noise: the lattice wraps at `period`, so the map repeats. */
function tileableNoise(x, z, period, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const wrap = (value) => ((value % period) + period) % period;
  const x0 = wrap(ix);
  const z0 = wrap(iz);
  const x1 = wrap(ix + 1);
  const z1 = wrap(iz + 1);
  const a = hash2(x0, z0, seed);
  const b = hash2(x1, z0, seed);
  const c = hash2(x0, z1, seed);
  const d = hash2(x1, z1, seed);
  return (
    a * (1 - ux) * (1 - uz) +
    b * ux * (1 - uz) +
    c * (1 - ux) * uz +
    d * ux * uz
  );
}

function fbm(x, z, basePeriod, seed, octaves) {
  let total = 0;
  let amplitude = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const period = basePeriod * 2 ** octave;
    total +=
      tileableNoise(x * 2 ** octave, z * 2 ** octave, period, seed + octave) *
      amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
  }
  return total / normalizer;
}

/**
 * A tiling colour map plus the normal map implied by the same height field.
 *
 * @returns {{map: THREE.DataTexture, normalMap: THREE.DataTexture, dispose: Function}}
 */
function createSurfaceMaps({
  size = 256,
  seed,
  basePeriod = 8,
  octaves = 4,
  dark,
  light,
  bump = 1.6,
  name,
}) {
  const height = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const darkColour = new THREE.Color(dark);
  const lightColour = new THREE.Color(light);
  const mixed = new THREE.Color();

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = fbm(
        (column / size) * basePeriod,
        (row / size) * basePeriod,
        basePeriod,
        seed,
        octaves,
      );
      height[row * size + column] = value;
      mixed.copy(darkColour).lerp(lightColour, Math.min(1, Math.max(0, value)));
      const offset = (row * size + column) * 4;
      colour[offset] = Math.round(mixed.r * 255);
      colour[offset + 1] = Math.round(mixed.g * 255);
      colour[offset + 2] = Math.round(mixed.b * 255);
      colour[offset + 3] = 255;
    }
  }

  // Central differences on the wrapped height field, so the normal map tiles
  // with the colour map rather than seaming at the edge.
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const at = (r, c) =>
        height[((r + size) % size) * size + ((c + size) % size)];
      const dx = (at(row, column + 1) - at(row, column - 1)) * bump;
      const dz = (at(row + 1, column) - at(row - 1, column)) * bump;
      const length = Math.hypot(-dx, -dz, 1);
      const offset = (row * size + column) * 4;
      normal[offset] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normal[offset + 1] = Math.round(((-dz / length) * 0.5 + 0.5) * 255);
      normal[offset + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      normal[offset + 3] = 255;
    }
  }

  const configure = (texture, colorSpace, textureName) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = colorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.name = textureName;
    texture.needsUpdate = true;
    return texture;
  };

  const map = configure(
    new THREE.DataTexture(colour, size, size),
    THREE.SRGBColorSpace,
    `${name} albedo`,
  );
  const normalMap = configure(
    new THREE.DataTexture(normal, size, size),
    THREE.NoColorSpace,
    `${name} normal`,
  );

  return {
    map,
    normalMap,
    dispose() {
      map.dispose();
      normalMap.dispose();
    },
  };
}

/** Mulch: the bed outline, filled, lying just above the terrain. */
function createMulch({ outline, groundAt, maps, shadows }) {
  const shape = new THREE.Shape();
  // ShapeGeometry builds in XY and is rotated onto XZ below, which negates the
  // second coordinate. Feeding -z here keeps the outline the way round the
  // layout drew it.
  shape.moveTo(outline[0][0], -outline[0][1]);
  for (const [x, z] of outline.slice(1)) shape.lineTo(x, -z);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, 12);
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) / MULCH_TILE, uv.getY(index) / MULCH_TILE);
  }
  uv.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.97,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Bed mulch';
  mesh.position.y = groundAt(0, 0) + 0.025;
  mesh.receiveShadow = shadows;
  return mesh;
}

/**
 * Cobble edging, one instanced draw for the whole perimeter.
 *
 * Walked at a fixed arc length rather than a fixed angle: the outline is a
 * kidney, so equal angles would bunch the cobbles where the radius is small.
 */
function createEdging({ groundAt, shadows, seed = 7717 }) {
  const outline = bedOutline(360);
  const step = 0.29;
  const transforms = [];
  let carry = 0;

  for (let index = 0; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    const dx = next[0] - current[0];
    const dz = next[1] - current[1];
    const length = Math.hypot(dx, dz);
    carry += length;
    if (carry < step) continue;
    carry -= step;

    // Offset along the segment's own outward normal, not along a radius from
    // the origin. The outline is centred on its area rather than on the polar
    // curve's origin, so a radial offset would walk the cobbles off the mulch
    // on the side the kidney leans away from.
    let normalX = dz / (length || 1);
    let normalZ = -dx / (length || 1);
    if (normalX * current[0] + normalZ * current[1] < 0) {
      normalX = -normalX;
      normalZ = -normalZ;
    }
    const x = current[0] + normalX * 0.055;
    const z = current[1] + normalZ * 0.055;
    const jitter = hash2(index, 0, seed);
    transforms.push({
      x,
      z,
      y: groundAt(x, z) + 0.045,
      rotation: Math.atan2(dz, dx) + (jitter - 0.5) * 0.5,
      scale: 0.86 + jitter * 0.3,
      tilt: (hash2(index, 1, seed) - 0.5) * 0.22,
    });
  }

  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  geometry.scale(0.34, 0.2, 0.24);
  const material = new THREE.MeshStandardMaterial({
    color: '#9aa0a1',
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = 'Bed edging';
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  transforms.forEach((entry, index) => {
    euler.set(entry.tilt, -entry.rotation, entry.tilt * 0.6);
    quaternion.setFromEuler(euler);
    position.set(entry.x, entry.y, entry.z);
    scale.setScalar(entry.scale);
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Boulders, displaced per vertex so no two are the same stone. */
function createBoulders({ groundAt, shadows }) {
  const group = new THREE.Group();
  group.name = 'Bed boulders';
  const material = new THREE.MeshStandardMaterial({
    color: '#8d8b84',
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });

  for (const boulder of BED_BOULDERS) {
    const geometry = new THREE.IcosahedronGeometry(boulder.radius, 2);
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const displacement =
        0.82 +
        fbm(
          (x / boulder.radius) * 2 + 4,
          (z / boulder.radius) * 2 + 4,
          8,
          boulder.seed,
          3,
        ) *
          0.36;
      position.setXYZ(index, x * displacement, y * displacement, z * displacement);
    }
    // Squat rather than spherical, and sunk a third of the way into the mulch.
    geometry.scale(1, 0.72, 1);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      boulder.x,
      groundAt(boulder.x, boulder.z) + boulder.radius * 0.72 * 0.62,
      boulder.z,
    );
    mesh.rotation.y = boulder.seed;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  }
  return group;
}

/**
 * Build the bed's hard landscaping.
 *
 * @param {object} options
 * @param {number[][]} options.outline Closed bed outline from the layout.
 * @param {(x: number, z: number) => number} options.groundAt
 * @param {boolean} [options.shadows]
 */
export function createBedProps({ outline, groundAt, shadows = true }) {
  if (!Array.isArray(outline) || outline.length < 3) {
    throw new TypeError('The bed props need the layout outline.');
  }
  if (typeof groundAt !== 'function') {
    throw new TypeError('The bed props need a terrain height function.');
  }

  const mulchMaps = createSurfaceMaps({
    seed: 91_113,
    basePeriod: 16,
    octaves: 5,
    dark: '#41301f',
    light: '#8a6440',
    bump: 1.8,
    name: 'Bark mulch',
  });
  const group = new THREE.Group();
  group.name = 'Bed hard landscaping';
  const mulch = createMulch({ outline, groundAt, maps: mulchMaps, shadows });
  const edging = createEdging({ groundAt, shadows });
  const boulders = createBoulders({ groundAt, shadows });
  group.add(mulch, edging, boulders);

  return {
    group,
    dispose() {
      for (const mesh of [mulch, edging]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const stone of boulders.children) stone.geometry.dispose();
      boulders.children[0]?.material.dispose();
      mulchMaps.dispose();
      group.clear();
    },
  };
}
