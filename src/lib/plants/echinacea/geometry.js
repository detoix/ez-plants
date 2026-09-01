import * as THREE from 'three';

import {
  finishGeometry,
  fract,
  GOLDEN_ANGLE,
  validatePositiveInteger,
} from '../../organ-geometry.js';

const RAY_BASE = new THREE.Color(0.46, 0.035, 0.15);
const RAY_TIP = new THREE.Color(0.7, 0.12, 0.31);
const CONE_BASE = new THREE.Color(0.25, 0.065, 0.012);
const CONE_ACTIVE = new THREE.Color(0.58, 0.1, 0.008);
const CONE_TIP = new THREE.Color(0.34, 0.06, 0.006);
const BRACT_BASE = new THREE.Color(0.22, 0.35, 0.12);
const BRACT_TIP = new THREE.Color(0.48, 0.62, 0.26);
const PEDUNCLE_BASE = new THREE.Color(0.26, 0.38, 0.14);
const PEDUNCLE_TIP = new THREE.Color(0.38, 0.5, 0.2);

function pushVertex(buffers, point, colour, rayWeight = 0, headWeight = 1) {
  buffers.positions.push(point.x, point.y, point.z);
  buffers.colors.push(colour.r, colour.g, colour.b);
  buffers.rayWeights.push(rayWeight);
  buffers.headWeights.push(headWeight);
  return buffers.positions.length / 3 - 1;
}

function appendBracts(buffers, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const root = radial.clone().multiplyScalar(0.115);
    root.y = -0.006;
    const shoulder = radial.clone().multiplyScalar(0.155);
    shoulder.y = -0.035;
    const tip = radial.clone().multiplyScalar(0.245);
    tip.y = -0.075 - 0.018 * fract(index * 0.618);
    const halfWidth = 0.018;
    const base = buffers.positions.length / 3;
    pushVertex(
      buffers,
      root.clone().addScaledVector(tangent, -halfWidth),
      BRACT_BASE,
    );
    pushVertex(
      buffers,
      shoulder.clone().addScaledVector(tangent, halfWidth),
      BRACT_TIP,
    );
    pushVertex(buffers, tip, BRACT_TIP);
    pushVertex(
      buffers,
      shoulder.clone().addScaledVector(tangent, -halfWidth),
      BRACT_TIP,
    );
    buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function appendRay(buffers, { angle, sequence, segments, coneRadius }) {
  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const lengthScale = 0.91 + 0.09 * fract((sequence + 1) * 0.754877666);
  const droop = 0.028 + 0.06 * fract((sequence + 1) * 0.569840291);
  const twist = (fract((sequence + 1) * 0.819172513) - 0.5) * 0.22;
  const rows = [];

  for (let row = 0; row <= segments; row += 1) {
    const s = row / segments;
    const centreRadius = THREE.MathUtils.lerp(
      coneRadius * 0.82,
      0.5 * lengthScale,
      s,
    );
    const halfWidth =
      (0.047 + 0.044 * Math.sin(Math.PI * Math.pow(s, 0.8))) * (1 - 0.12 * s);
    const centreHeight =
      0.004 + 0.014 * Math.sin(Math.PI * s) - droop * Math.pow(s, 1.75);
    const line = [];
    for (const column of [-1, 0, 1]) {
      // A shallow two-lobed notch at the tip is characteristic of the rays.
      const notch = row === segments && column === 0 ? 0.022 : 0;
      const radius = centreRadius - notch;
      const rolled = twist * s;
      const point = radial
        .clone()
        .multiplyScalar(radius)
        .addScaledVector(tangent, column * halfWidth * Math.cos(rolled));
      point.y =
        centreHeight +
        column * halfWidth * Math.sin(rolled) +
        (column === 0 ? 0.004 * Math.sin(Math.PI * s) : 0);
      const colour = RAY_BASE.clone().lerp(RAY_TIP, 0.18 + 0.72 * s);
      colour.multiplyScalar(0.9 + 0.1 * fract(sequence * 0.37));
      line.push(pushVertex(buffers, point, colour, 1));
    }
    rows.push(line);
  }

  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const a = rows[row][column];
      const b = rows[row][column + 1];
      const c = rows[row + 1][column];
      const d = rows[row + 1][column + 1];
      buffers.indices.push(a, b, c, b, d, c);
    }
  }
}

function coneRadiusAt(t, baseRadius) {
  // Convex dome/cone rather than a straight-sided party hat. Mature Magnus
  // discs are pointed, but retain a broad shoulder almost to mid-height.
  return baseRadius * Math.sqrt(Math.max(0.04, 1 - t * t));
}

function appendCone(buffers, { radialSegments, rings, baseRadius = 0.18 }) {
  const coneHeight = 0.22;
  const ringVertices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const radius = coneRadiusAt(t, baseRadius);
    const y = 0.006 + coneHeight * Math.pow(t, 1.05);
    const line = [];
    for (let side = 0; side < radialSegments; side += 1) {
      const angle = (side / radialSegments) * Math.PI * 2;
      const point = new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius,
      );
      const activeRing = Math.sin(Math.PI * t);
      const colour = CONE_BASE.clone()
        .lerp(CONE_ACTIVE, activeRing * 0.88)
        .lerp(CONE_TIP, Math.pow(t, 2.2) * 0.68);
      line.push(pushVertex(buffers, point, colour));
    }
    ringVertices.push(line);
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let side = 0; side < radialSegments; side += 1) {
      const next = (side + 1) % radialSegments;
      const a = ringVertices[ring][side];
      const b = ringVertices[ring][next];
      const c = ringVertices[ring + 1][side];
      const d = ringVertices[ring + 1][next];
      buffers.indices.push(a, c, b, b, c, d);
    }
  }

  const top = pushVertex(
    buffers,
    new THREE.Vector3(0, coneHeight + 0.012, 0),
    CONE_TIP,
  );
  const last = ringVertices.at(-1);
  for (let side = 0; side < radialSegments; side += 1) {
    buffers.indices.push(last[side], top, last[(side + 1) % radialSegments]);
  }

  // Sparse triangular paleae catch the silhouette and make the cone prickly
  // without instancing hundreds of botanical disc florets.
  const spikeCount = radialSegments * 3;
  for (let spike = 0; spike < spikeCount; spike += 1) {
    const t = 0.12 + 0.76 * fract((spike + 1) * 0.618033989);
    const angle = spike * GOLDEN_ANGLE;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const radius = coneRadiusAt(t, baseRadius) + 0.002;
    const y = 0.006 + coneHeight * Math.pow(t, 1.05);
    const centre = radial.clone().multiplyScalar(radius);
    centre.y = y;
    const half = 0.008;
    const a = pushVertex(
      buffers,
      centre.clone().addScaledVector(tangent, -half),
      CONE_ACTIVE,
    );
    const b = pushVertex(
      buffers,
      centre.clone().addScaledVector(tangent, half),
      CONE_ACTIVE,
    );
    const tip = radial.clone().multiplyScalar(radius + 0.027);
    tip.y = y + 0.025;
    const c = pushVertex(buffers, tip, CONE_TIP);
    buffers.indices.push(a, c, b);
  }
}

function appendCoarsePeduncle(buffers, sides = 4) {
  // Coarse head rungs carry their own continuous supporting stem so dropping
  // the dedicated stem mesh can meet two draws without floating flowers.
  const radius = 0.037;
  const bottom = [];
  const top = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    bottom.push(
      pushVertex(buffers, new THREE.Vector3(x, 0, z), PEDUNCLE_BASE, 0, 0),
    );
    top.push(
      pushVertex(buffers, new THREE.Vector3(x, 0.995, z), PEDUNCLE_TIP, 0, 0),
    );
  }
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    buffers.indices.push(
      bottom[side],
      top[side],
      bottom[next],
      bottom[next],
      top[side],
      top[next],
    );
  }
}

/**
 * One whole capitulum in one draw: broad ray ribbons, involucral bracts and a
 * faceted prickly disc cone. Unit diameter is one, local +Y is head normal.
 */
export function createMagnusHeadGeometry({
  rays = 20,
  raySegments = 3,
  radialSegments = 16,
  coneRings = 4,
  coarsePeduncle = false,
} = {}) {
  validatePositiveInteger(rays, 'rays');
  validatePositiveInteger(raySegments, 'raySegments');
  validatePositiveInteger(radialSegments, 'radialSegments');
  validatePositiveInteger(coneRings, 'coneRings');
  if (rays < 10 || rays > 24) {
    throw new RangeError('rays must be an integer from 10 to 24.');
  }
  if (raySegments < 1 || raySegments > 4) {
    throw new RangeError('raySegments must be an integer from 1 to 4.');
  }
  if (radialSegments < 8 || radialSegments > 20) {
    throw new RangeError('radialSegments must be an integer from 8 to 20.');
  }
  if (coneRings < 2 || coneRings > 6) {
    throw new RangeError('coneRings must be an integer from 2 to 6.');
  }

  const buffers = {
    positions: [],
    colors: [],
    indices: [],
    rayWeights: [],
    headWeights: [],
  };
  appendBracts(buffers, Math.max(8, Math.round(rays * 0.65)));
  for (let ray = 0; ray < rays; ray += 1) {
    appendRay(buffers, {
      angle: (ray / rays) * Math.PI * 2 + 0.025 * Math.sin(ray * 2.13),
      sequence: ray,
      segments: raySegments,
      coneRadius: 0.18,
    });
  }
  appendCone(buffers, { radialSegments, rings: coneRings });

  if (coarsePeduncle) {
    // Put the whole head at local y=1. Its vertical relief is normalised to a
    // typical 0.8 m stem; the renderer scales Y by the actual base-to-head
    // distance while X/Z remain scaled by flower diameter.
    for (let offset = 1; offset < buffers.positions.length; offset += 3) {
      buffers.positions[offset] = 1 + buffers.positions[offset] * 0.105;
    }
    appendCoarsePeduncle(buffers);
  }

  const geometry = finishGeometry({
    ...buffers,
    userData: {
      organ: 'echinacea-capitulum',
      rays,
      raySegments,
      radialSegments,
      coneRings,
      coarsePeduncle,
      representativeDiscFlorets: true,
      unitDiameter: 1,
    },
  });
  geometry.setAttribute(
    'magnusRay',
    new THREE.Float32BufferAttribute(buffers.rayWeights, 1),
  );
  geometry.setAttribute(
    'magnusHead',
    new THREE.Float32BufferAttribute(buffers.headWeights, 1),
  );
  return geometry;
}
