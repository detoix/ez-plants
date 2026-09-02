import * as THREE from 'three';
import { finishGeometry, heightUVs } from '../../organ-geometry.js';

const SHELL_INNER = new THREE.Color(0x4f794d);
const SHELL_OUTER = new THREE.Color(0x75a867);

const PRINCIPAL_PLANE_NORMAL = Object.freeze([0, 0, 1]);
const SPRAY_SEGMENTS = Object.freeze([3, 2, 1]);

const SHELL_LEVELS = Object.freeze([
  Object.freeze({
    segments: 18,
    rings: Object.freeze([
      Object.freeze([0, 0.7]),
      Object.freeze([0.1, 0.76]),
      Object.freeze([0.22, 0.75]),
      Object.freeze([0.34, 0.7]),
      Object.freeze([0.46, 0.64]),
      Object.freeze([0.58, 0.56]),
      Object.freeze([0.7, 0.46]),
      Object.freeze([0.8, 0.36]),
      Object.freeze([0.9, 0.21]),
      Object.freeze([1, 0.03]),
    ]),
  }),
  Object.freeze({
    segments: 12,
    rings: Object.freeze([
      Object.freeze([0, 0.7]),
      Object.freeze([0.15, 0.76]),
      Object.freeze([0.32, 0.71]),
      Object.freeze([0.5, 0.61]),
      Object.freeze([0.68, 0.48]),
      Object.freeze([0.84, 0.31]),
      Object.freeze([1, 0.03]),
    ]),
  }),
  Object.freeze({
    segments: 8,
    rings: Object.freeze([
      Object.freeze([0, 0.7]),
      Object.freeze([0.24, 0.73]),
      Object.freeze([0.52, 0.59]),
      Object.freeze([0.78, 0.38]),
      Object.freeze([1, 0.03]),
    ]),
  }),
]);

/**
 * One photographed Thuja scale-foliage spray card.
 *
 * The alpha plate carries the real branchlet silhouette and its scale-leaf
 * detail. Geometry exists only to bend that plate: near range has two interior
 * rows for a smooth crown arc, mid range has one, and far range is EZ-Tree's
 * original two-triangle answer. Every rung remains one XY plane; crown layering
 * supplies edge-on fullness without crossed-card overdraw.
 */
export function createThujaSprayGeometry({ level = 0 } = {}) {
  if (!Number.isInteger(level) || level < 0 || level > 2) {
    throw new RangeError('Thuja spray level must be 0, 1 or 2.');
  }

  const segments = SPRAY_SEGMENTS[level];
  const buffers = {
    positions: [],
    colors: [],
    normals: [],
    uvs: [],
    indices: [],
  };
  for (let row = 0; row <= segments; row += 1) {
    const y = row / segments;
    for (const side of [-1, 1]) {
      buffers.positions.push(side * 0.5, y, 0);
      buffers.colors.push(1, 1, 1);
      const normal = new THREE.Vector3(-side * 0.085, 0, 1).normalize();
      buffers.normals.push(normal.x, normal.y, normal.z);
      buffers.uvs.push((side + 1) * 0.5, y);
    }
    if (row < segments) {
      const lowerLeft = row * 2;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + 2;
      const upperRight = lowerLeft + 3;
      buffers.indices.push(
        lowerLeft,
        lowerRight,
        upperRight,
        lowerLeft,
        upperRight,
        upperLeft,
      );
    }
  }

  const triangleCount = segments * 2;

  return finishGeometry({
    ...buffers,
    userData: {
      kind: 'thuja-photographic-spray-card',
      level,
      triangleCount,
      topology: {
        form: 'segmented-alpha-card',
        principalPlane: 'xy',
        principalPlaneNormal: PRINCIPAL_PLANE_NORMAL,
        internalPlaneCount: 1,
        crossedPlanes: false,
        connectedSurface: true,
        negativeSpace: 'photographic-alpha',
        silhouetteStyle: 'real-thuja-occidentalis-scale-spray',
        sourcePlate: 'leaf.webp',
        longitudinalSegments: segments,
        planeThickness: 0,
        planeThicknessLimit: 0,
        cupRepresentation: 'authored-normals',
      },
    },
  });
}

/**
 * A small, deeply recessed foliage volume behind the animated outer pads.
 * Dense conifers do not reveal daylight through their centre; this 64-324
 * triangle shell supplies that near-view occlusion without enlarging spray
 * proxies or adding alpha-card overdraw. Outer sprays still own the visible
 * silhouette.
 */
export function createThujaDepthShellGeometry({ level = 0 } = {}) {
  if (!Number.isInteger(level) || level < 0 || level > 2) {
    throw new RangeError('Thuja depth-shell level must be 0, 1 or 2.');
  }
  const { segments, rings } = SHELL_LEVELS[level];
  const positions = [];
  const colors = [];
  const normals = [];
  const indices = [];

  for (const [ringIndex, [height, radius]] of rings.entries()) {
    const previous = rings[Math.max(0, ringIndex - 1)];
    const next = rings[Math.min(rings.length - 1, ringIndex + 1)];
    const slope =
      (previous[1] - next[1]) / Math.max(0.001, next[0] - previous[0]);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const irregularity =
        height >= 0.99
          ? 1
          : 1 +
            Math.sin(segment * 2.399 + ringIndex * 1.71) * 0.045 +
            Math.sin(segment * 5.13 - ringIndex * 0.83) * 0.025;
      positions.push(
        cosine * radius * irregularity,
        height,
        sine * radius * irregularity,
      );
      const normal = new THREE.Vector3(cosine, slope, sine).normalize();
      normals.push(normal.x, normal.y, normal.z);
      const shade =
        0.18 +
        height * 0.32 +
        (segment % 3 === 0 ? 0.15 : segment % 3 === 1 ? -0.08 : 0);
      const colour = SHELL_INNER.clone().lerp(
        SHELL_OUTER,
        THREE.MathUtils.clamp(shade, 0, 0.72),
      );
      colors.push(colour.r, colour.g, colour.b);
    }
  }

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    const lower = ring * segments;
    const upper = (ring + 1) * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(
        lower + segment,
        upper + segment,
        lower + next,
        lower + next,
        upper + segment,
        upper + next,
      );
    }
  }

  return finishGeometry({
    positions,
    colors,
    normals,
    indices,
    uvs: heightUVs(positions),
    userData: {
      kind: 'thuja-recessed-foliage-shell',
      level,
      triangleCount: indices.length / 3,
      outerSilhouette: false,
    },
  });
}
