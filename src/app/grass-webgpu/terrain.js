import * as THREE from 'three/webgpu';

import {
  terrainHeightAt,
  terrainHeightBounds,
} from '../field-terrain-height.js';

export function webGPUBackdropHeight(terrainAmplitude) {
  return -(Math.max(0, terrainAmplitude) * 1.6 + 0.1);
}

export function createWebGPUTerrainGeometry({
  amplitude = 1.15,
  size = 260,
  segments = 220,
} = {}) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    position.setY(
      index,
      terrainHeightAt(position.getX(index), position.getZ(index), {
        amplitude,
      }),
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Bakes the shared scalar terrain into an r185-owned, filterable height map.
 *
 * Core WebGPU's filterable R16 float format avoids optional normalized texture
 * features while keeping sub-millimetre precision at field heights.
 */
export function createWebGPUHeightTexture({
  amplitude = 1.15,
  extent = 130,
  resolution = 1024,
} = {}) {
  const heightBounds = terrainHeightBounds(amplitude);
  const data = new Uint16Array(resolution * resolution);
  const step = (extent * 2) / (resolution - 1);

  for (let row = 0; row < resolution; row += 1) {
    const z = -extent + row * step;
    for (let column = 0; column < resolution; column += 1) {
      const x = -extent + column * step;
      const height = terrainHeightAt(x, z, { amplitude });
      data[row * resolution + column] = THREE.DataUtils.toHalfFloat(height);
    }
  }

  const texture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  texture.name = 'WebGPU field height';
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    extent,
    resolution,
    minimum: 0,
    scale: 1,
    packingMinimum: heightBounds.minimum,
    // A flat field still needs a non-zero divisor. Its only stored height is
    // zero, so a unit range decodes that value exactly.
    packingRange: heightBounds.span || 1,
    texelWorldSize: step,
  };
}
