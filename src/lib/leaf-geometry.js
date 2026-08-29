import * as THREE from 'three';

import { Billboard } from './enums.js';

/**
 * Where a stalk samples its colour from. Leaf plates in this library are drawn
 * blade-up around u=0.5 and are opaque along that column from about v=0.05, so
 * a thin slice just above the blade's base is midrib -- the same tissue the
 * petiole is made of, and already the right colour in every season the plate
 * is tinted through.
 */
const STALK_UV_HALF_WIDTH = 0.012;
const STALK_UV_SPAN = Object.freeze([0.07, 0.17]);

/** Create the flat arrays consumed by EZ-Tree's combined leaf mesh. */
export function createLeafGeometryData() {
  return {
    verts: [],
    normals: [],
    indices: [],
    uvs: [],
  };
}

function validateGeometryData(data) {
  for (const key of ['verts', 'normals', 'indices', 'uvs']) {
    if (!Array.isArray(data?.[key])) {
      throw new TypeError(`Leaf geometry data requires an array at ${key}.`);
    }
  }
}

function validateCardOptions({
  origin,
  orientation,
  width,
  length,
  billboard,
}) {
  if (!origin?.isVector3) {
    throw new TypeError('A leaf card requires a Vector3 origin.');
  }
  if (!orientation?.isEuler) {
    throw new TypeError('A leaf card requires an Euler orientation.');
  }
  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError('Leaf card width must be a positive finite number.');
  }
  if (!Number.isFinite(length) || length <= 0) {
    throw new RangeError('Leaf card length must be a positive finite number.');
  }
  if (!Object.values(Billboard).includes(billboard)) {
    throw new RangeError(`Unknown leaf billboard policy: ${billboard}.`);
  }
}

/**
 * Append EZ-Tree's original four-vertex UV leaf card to a combined buffer.
 * The card is rooted at y=0, reaches y=length and uses uv.y as its wind bend
 * weight. Double billboards retain the original crossed-card normal behavior.
 *
 * `stalk` extends the card *backwards*, from y=-stalk to y=0, as two more
 * triangles carrying the petiole. A petiole meshed as its own instanced tube
 * is the single most wasteful organ a leafy plant can own -- hydrangea spent
 * 35,140 triangles and a whole draw call on 1,757 of them, more than five
 * times what the leaves they carry cost -- and the standard foliage answer is
 * that a leaf card includes its own stalk. The strip samples a narrow column
 * of the plate's midrib, which every leaf plate in this library keeps opaque
 * on u=0.5, so no plate needs reauthoring to grow one. Its uv.y stays low, so
 * the shared leaf wind bends a petiole far less than the blade above it --
 * which is also what a real petiole does.
 */
export function appendLeafCard(
  data,
  {
    origin = new THREE.Vector3(),
    orientation = new THREE.Euler(),
    width = 1,
    length = 1,
    billboard = Billboard.Single,
    roundedNormals = true,
    stalk = 0,
    stalkWidth = 0.03,
  } = {},
) {
  validateGeometryData(data);
  validateCardOptions({ origin, orientation, width, length, billboard });
  if (!Number.isFinite(stalk) || stalk < 0) {
    throw new RangeError('Leaf card stalk must be a non-negative number.');
  }
  if (stalk > 0 && (!Number.isFinite(stalkWidth) || stalkWidth <= 0)) {
    throw new RangeError('Leaf card stalk width must be positive.');
  }

  const vertexOffset = data.verts.length / 3;
  const indexOffset = data.indices.length;
  let cardVertexOffset = vertexOffset;

  const createCard = (rotation) => {
    const vertices = [
      new THREE.Vector3(-width / 2, length, 0),
      new THREE.Vector3(-width / 2, 0, 0),
      new THREE.Vector3(width / 2, 0, 0),
      new THREE.Vector3(width / 2, length, 0),
    ].map((vertex) =>
      vertex
        .applyEuler(new THREE.Euler(0, rotation, 0))
        .applyEuler(orientation)
        .add(origin),
    );

    for (const vertex of vertices) {
      data.verts.push(vertex.x, vertex.y, vertex.z);
    }

    // This intentionally mirrors EZ-Tree: the crossed-card rotation is not
    // applied to the flat normal, while rounded normals follow each vertex.
    const leafNormal = new THREE.Vector3(0, 0, 1).applyEuler(orientation);
    const normals = roundedNormals
      ? vertices.map((vertex) =>
          leafNormal.clone().add(vertex).sub(origin).normalize(),
        )
      : [leafNormal, leafNormal, leafNormal, leafNormal];
    for (const normal of normals) {
      data.normals.push(normal.x, normal.y, normal.z);
    }

    data.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
    data.indices.push(
      cardVertexOffset,
      cardVertexOffset + 1,
      cardVertexOffset + 2,
      cardVertexOffset,
      cardVertexOffset + 2,
      cardVertexOffset + 3,
    );
    cardVertexOffset += 4;
  };

  // A single quad on the same plane as the first card. The midrib column is
  // narrow enough that a crossed stalk would cost two more triangles to hide
  // a two-millimetre edge, which is not a trade worth making at any band.
  const appendStalk = () => {
    const half = stalkWidth / 2;
    const vertices = [
      new THREE.Vector3(-half, 0, 0),
      new THREE.Vector3(-half, -stalk, 0),
      new THREE.Vector3(half, -stalk, 0),
      new THREE.Vector3(half, 0, 0),
    ].map((vertex) => vertex.applyEuler(orientation).add(origin));

    for (const vertex of vertices) {
      data.verts.push(vertex.x, vertex.y, vertex.z);
    }
    const stalkNormal = new THREE.Vector3(0, 0, 1).applyEuler(orientation);
    for (let index = 0; index < 4; index += 1) {
      data.normals.push(stalkNormal.x, stalkNormal.y, stalkNormal.z);
    }
    // A thin slice of the midrib, running up to where the blade takes over.
    const [u0, u1] = [0.5 - STALK_UV_HALF_WIDTH, 0.5 + STALK_UV_HALF_WIDTH];
    const [v0, v1] = STALK_UV_SPAN;
    data.uvs.push(u0, v1, u0, v0, u1, v0, u1, v1);
    data.indices.push(
      cardVertexOffset,
      cardVertexOffset + 1,
      cardVertexOffset + 2,
      cardVertexOffset,
      cardVertexOffset + 2,
      cardVertexOffset + 3,
    );
    cardVertexOffset += 4;
  };

  createCard(0);
  if (billboard === Billboard.Double) createCard(Math.PI / 2);
  if (stalk > 0) appendStalk();

  return {
    vertexOffset,
    vertexCount: data.verts.length / 3 - vertexOffset,
    indexOffset,
    indexCount: data.indices.length - indexOffset,
  };
}

/** Build a Three.js leaf geometry, selecting 32-bit indices when required. */
export function createLeafBufferGeometry(data) {
  validateGeometryData(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(data.verts, 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(data.normals, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  // Passing the plain array lets Three.js choose Uint16 or Uint32 indices.
  geometry.setIndex(data.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Create one reusable unit UV card for InstancedMesh leaf pools.
 * Override dimensions or transforms only when a non-unit standalone card is
 * explicitly needed; the default is one single card, not a leaf variant set.
 */
export function createLeafCardGeometry(options = {}) {
  const data = createLeafGeometryData();
  appendLeafCard(data, options);
  return createLeafBufferGeometry(data);
}
