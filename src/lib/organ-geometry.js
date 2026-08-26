import * as THREE from 'three';

/**
 * Small building blocks shared by the soft-organ geometries of every plant.
 *
 * Panicles, plumes, buds and grass blades are not woody tubes, so they do not
 * go through `woody-geometry.js`. They are still all built the same way: push
 * vertex-coloured triangles into plain arrays, then hand them to
 * `finishGeometry` for one instancing-ready BufferGeometry. Keeping the
 * primitives here means a new species writes only the shape that is actually
 * species-specific.
 */

/** Phyllotactic angle used to scatter organs without a stacked-ring pattern. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Deterministic fractional part, used as stateless jitter in organ layouts. */
export function fract(value) {
  return value - Math.floor(value);
}

export function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

/** Empty vertex-coloured triangle buffers for one organ geometry. */
export function createOrganBuffers() {
  return { positions: [], colors: [], indices: [] };
}

/** Append one vertex, returning its index. */
export function pushOrganVertex(buffers, point, colour) {
  buffers.positions.push(point.x, point.y, point.z);
  buffers.colors.push(colour.r, colour.g, colour.b);
  return buffers.positions.length / 3 - 1;
}

/**
 * Derive wind UVs from a unit organ's own height.
 *
 * The shared leaf-wind shader bends each vertex by `uv.y`, so an organ that
 * runs from y = 0 at its attachment to y = 1 at its tip gets a still base and
 * a mobile tip from nothing more than its own coordinates. Use this for
 * organs assembled from tubes and triangles, which have no natural UVs.
 */
export function heightUVs(positions) {
  const uvs = [];
  for (let offset = 1; offset < positions.length; offset += 3) {
    uvs.push(0.5, clamp01(positions[offset]));
  }
  return uvs;
}

/** Pack vertex-coloured triangle buffers into an instancing-ready geometry. */
export function finishGeometry({
  positions,
  colors,
  indices,
  userData = {},
  normals = null,
  uvs = null,
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  // The shared leaf-wind shader bends vertices by `uv.y`, so any organ that
  // should sway needs real UVs even when it carries no texture.
  if (uvs) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  if (normals) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  Object.assign(geometry.userData, userData);
  return geometry;
}

/**
 * Append one tapered polygonal tube between two points.
 *
 * This is the workhorse for every thin supporting organ that is too small and
 * too numerous to deserve a welded woody tube: panicle rachises, raceme
 * branches and the fine forks beneath a flower head.
 */
export function appendTaperedTube(
  buffers,
  {
    start,
    end,
    startRadius,
    endRadius,
    sides,
    startColour,
    endColour,
    capStart = false,
    capEnd = true,
  },
) {
  const { indices } = buffers;
  const pushVertex = (point, colour) => pushOrganVertex(buffers, point, colour);
  const direction = end.clone().sub(start).normalize();
  const reference =
    Math.abs(direction.y) < 0.92
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const basisX = new THREE.Vector3()
    .crossVectors(direction, reference)
    .normalize();
  const basisZ = new THREE.Vector3()
    .crossVectors(direction, basisX)
    .normalize();
  const startRing = [];
  const endRing = [];

  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const radial = basisX
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(basisZ, Math.sin(angle));
    startRing.push(
      pushVertex(
        start.clone().addScaledVector(radial, startRadius),
        startColour,
      ),
    );
    endRing.push(
      pushVertex(end.clone().addScaledVector(radial, endRadius), endColour),
    );
  }
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    indices.push(startRing[side], startRing[next], endRing[side]);
    indices.push(startRing[next], endRing[next], endRing[side]);
  }
  if (capStart) {
    const centre = pushVertex(start, startColour.clone().multiplyScalar(0.78));
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      indices.push(centre, startRing[next], startRing[side]);
    }
  }
  if (capEnd) {
    const centre = pushVertex(end, endColour.clone().multiplyScalar(1.04));
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      indices.push(centre, endRing[side], endRing[next]);
    }
  }
  return buffers;
}
