import * as THREE from 'three';

import {
  createOrganBuffers,
  finishGeometry,
  pushOrganVertex,
} from '../../organ-geometry.js';

// 'Lynwood Variety' is described as a lighter, less brassy yellow than its
// 'Spectabilis' parent, with broader and less curled lobes. The corolla itself
// now lives in `flower.webp` -- these are the colours of the parts around it,
// which are still meshed.
const BUD_BASE = new THREE.Color(0xa8973f);
const BUD_TIP = new THREE.Color(0xf2c62b);

/**
 * One open forsythia corolla, as a single alpha card.
 *
 * The card lies in the XZ plane facing +Y, so composing it with the flower's
 * own outward-and-downward direction points its face where the corolla faces.
 * One unit of scale is one corolla width, tip to tip, exactly as the meshed
 * corolla it replaces -- the placement code did not have to change.
 *
 * Two triangles, where the mesh spent 66. Library rule 9's own words for this
 * case: a four-lobed star with wide gaps between its arms is the best case for
 * alpha and the worst case for triangles. See `scripts/make-flower-texture.mjs`
 * for what the plate carries and why the yellow is baked into it.
 *
 * `rise` lifts the card off the attachment point by the corolla tube, so the
 * flower still stands proud of the stem rather than sinking into the bark.
 */
export function createCorollaCardGeometry({ rise = 0.3, dish = 1 } = {}) {
  const half = 0.5;
  const corners = [
    [-half, -half],
    [-half, half],
    [half, half],
    [half, -half],
  ];
  const positions = [];
  // Rounded normals, the way EZ-Tree rounds a leaf card's. A single flat +Y
  // normal is what a flat quad deserves and what makes a mass of them wrong:
  // every corolla facing away from the sun goes dark at once, and a forsythia
  // in bloom turns olive. Splaying the corners outward instead gives the card
  // the shading of the shallow funnel a corolla actually is, so a flower
  // turned away still catches light on the lobes that face the light.
  const normals = [];
  for (const [x, z] of corners) {
    positions.push(x, rise, z);
    const length = Math.hypot(x * dish * 2, 1, z * dish * 2);
    normals.push((x * dish * 2) / length, 1 / length, (z * dish * 2) / length);
  }
  const uvs = [0, 1, 0, 0, 1, 0, 1, 1];
  const colors = new Array(12).fill(1);
  return finishGeometry({
    positions,
    colors,
    normals,
    uvs,
    indices: [0, 1, 2, 0, 2, 3],
  });
}

/**
 * One furled bud, open flower's predecessor and dormant leaf bud alike.
 *
 * These were two organ kinds and two meshes -- a five-ring teardrop for the
 * flower bud, a three-ring one for the vegetative bud -- costing 30 and 60
 * triangles each on a plant that carries thousands of both. Rule 9 says merge
 * kinds before dropping them, and these two merge cleanly: a 4 mm leaf bud and
 * a 7 mm flower bud are the same pointed teardrop at two sizes in two colours,
 * and colour and size are per-instance values, not meshes.
 *
 * ONE triangle: two shoulders and a drawn-out tip. That is the whole
 * silhouette of a bud, and at the scale a bud is ever drawn -- 3 mm for a leaf
 * bud, 12 for a swelling flower bud -- there is nothing else in it. It matters
 * because there are a great many: on the day before the display opens this
 * plant carries close to ten thousand of them, so a second triangle each is
 * ten thousand more, and they are competing for the budget with the flowers
 * they are about to become.
 *
 * The vertex colours run dark at the base to light at the tip and are
 * multiplied by the instance colour, so one geometry gives an olive leaf bud
 * and a gold flower bud without a second mesh.
 */
export function createBudCardGeometry({ width = 0.5 } = {}) {
  const buffers = createOrganBuffers();
  const shade = (t) => BUD_BASE.clone().lerp(BUD_TIP, Math.pow(t, 1.5));

  const left = pushOrganVertex(
    buffers,
    new THREE.Vector3(-width, 0, 0),
    shade(0),
  );
  const right = pushOrganVertex(
    buffers,
    new THREE.Vector3(width, 0, 0),
    shade(0),
  );
  const tip = pushOrganVertex(buffers, new THREE.Vector3(0, 1, 0), shade(1));
  buffers.indices.push(left, right, tip);

  // A bud sits on bare wood with light coming from anywhere, so a single flat
  // face normal would switch every bud on the plant dark together as it turns.
  // Splaying the base corners outward gives a rounded read for free.
  const normals = [];
  for (const [x, y, z] of [
    [-0.85, -0.1, 0.6],
    [0.85, -0.1, 0.6],
    [0, 0.45, 0.9],
  ]) {
    const length = Math.hypot(x, y, z);
    normals.push(x / length, y / length, z / length);
  }
  return finishGeometry({ ...buffers, normals });
}

/**
 * A dry, two-celled dehiscent capsule: small, brown, beaked, unshowy.
 *
 * 'Lynwood' is a thrum clone that sets almost no seed, so a five-year plant
 * carries eighteen of these. They are here for botanical completeness, and the
 * sphere they are cut from is the coarsest one that still reads as a pod.
 */
export function createCapsuleGeometry({ segments = 6, rings = 4 } = {}) {
  const geometry = new THREE.SphereGeometry(0.5, segments, rings);
  const position = geometry.getAttribute('position');
  const colors = [];
  const dry = new THREE.Color(0x6d5a3a);
  const beak = new THREE.Color(0x4a3b24);

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Ovoid and drawn out into a beak at the apex, with a faint suture ridge
    // marking the line the two cells split along.
    const taper = 1 - 0.34 * Math.max(0, y * 2);
    const suture = 1 + 0.05 * Math.cos(Math.atan2(z, x) * 2);
    position.setXYZ(i, x * taper * suture, y * 1.45, z * taper * suture);
    const shade = dry.clone().lerp(beak, THREE.MathUtils.clamp(y * 2, 0, 1));
    colors.push(shade.r, shade.g, shade.b);
  }

  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // SphereGeometry duplicates its poles for UV continuity. After the ovoid
  // taper those degenerate pole faces can still produce a zero normal, so fall
  // back to the outward radial direction.
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i += 1) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const magnitude = Math.hypot(nx, ny, nz);
    if (magnitude > 1e-8) {
      normal.setXYZ(i, nx / magnitude, ny / magnitude, nz / magnitude);
      continue;
    }
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const radialLength = Math.hypot(px, py, pz) || 1;
    normal.setXYZ(i, px / radialLength, py / radialLength, pz / radialLength);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}
