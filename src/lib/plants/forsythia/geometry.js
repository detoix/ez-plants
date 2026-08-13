import * as THREE from 'three';

// 'Lynwood Variety' is described as a lighter, less brassy yellow than its
// 'Spectabilis' parent, with broader and less curled lobes. The lobe faces are
// a clear golden yellow; only the very throat runs deeper, and it must stay
// confined there or the whole flower reads orange instead of forsythia yellow.
const LOBE_YELLOW = new THREE.Color(0xffcf1c);
const LOBE_EDGE = new THREE.Color(0xffe867);
const THROAT_AMBER = new THREE.Color(0xf0ac1b);
const TUBE_GREEN = new THREE.Color(0xc7cc63);

/**
 * One open forsythia corolla, built as a unit organ along +Y.
 *
 * The flower is a short tube opening into four deeply divided oblong lobes.
 * The lobes are modelled as twisted strips that spread outward and then roll
 * back on themselves, which is the "often revolute and twisted" habit that
 * separates a forsythia corolla from a flat four-petalled star.
 *
 * The geometry is normalised so one unit of scale equals one corolla width.
 */
export function createFlowerGeometry({
  lobes = 4,
  lobeSegments = 6,
  tubeSegments = 6,
  twist = 0.55,
} = {}) {
  const positions = [];
  const colors = [];
  const indices = [];

  const pushVertex = (point, color) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  const tubeBaseRadius = 0.055;
  const tubeMouthRadius = 0.072;
  const tubeHeight = 0.26;

  // --- Corolla tube -------------------------------------------------------
  const tubeRings = [];
  for (let ring = 0; ring <= 1; ring += 1) {
    const t = ring;
    const radius = THREE.MathUtils.lerp(tubeBaseRadius, tubeMouthRadius, t);
    const y = tubeHeight * t;
    const color = TUBE_GREEN.clone().lerp(THROAT_AMBER, t);
    const rowIndices = [];
    for (let segment = 0; segment < tubeSegments; segment += 1) {
      const angle = (segment / tubeSegments) * Math.PI * 2;
      rowIndices.push(
        pushVertex(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            y,
            Math.sin(angle) * radius,
          ),
          color,
        ),
      );
    }
    tubeRings.push(rowIndices);
  }
  for (let segment = 0; segment < tubeSegments; segment += 1) {
    const next = (segment + 1) % tubeSegments;
    const a = tubeRings[0][segment];
    const b = tubeRings[0][next];
    const c = tubeRings[1][segment];
    const d = tubeRings[1][next];
    indices.push(a, c, b, b, c, d);
  }

  // Floor the tube. Left open, the corolla is a pipe you can see the sky
  // through when the flower is viewed face on.
  const throatCentre = pushVertex(
    new THREE.Vector3(0, tubeHeight * 0.16, 0),
    THROAT_AMBER.clone().multiplyScalar(0.72),
  );
  for (let segment = 0; segment < tubeSegments; segment += 1) {
    const next = (segment + 1) % tubeSegments;
    indices.push(throatCentre, tubeRings[0][next], tubeRings[0][segment]);
  }

  // --- Four spreading, revolute lobes -------------------------------------
  for (let lobe = 0; lobe < lobes; lobe += 1) {
    const lobeAngle = (lobe / lobes) * Math.PI * 2;
    const outward = new THREE.Vector3(
      Math.cos(lobeAngle),
      0,
      Math.sin(lobeAngle),
    );
    const sideways = new THREE.Vector3(-outward.z, 0, outward.x);
    const rows = [];

    for (let step = 0; step <= lobeSegments; step += 1) {
      const s = step / lobeSegments;
      // Reach outward to a half-width of 0.5, so a unit scale is one corolla
      // width tip to tip.
      const radial = tubeMouthRadius + (0.5 - tubeMouthRadius) * s;
      // Rise off the mouth, then roll back down: the revolute tip.
      const height = tubeHeight + 0.15 * s - 0.34 * Math.pow(s, 2.3);
      // Oblong: near parallel-sided for most of its length, then rounded off.
      // A lobe that swells through the middle reads as a broad petal, which is
      // a buttercup or a kerria -- forsythia lobes are narrow straps.
      const halfWidth =
        0.088 * Math.pow(Math.sin(Math.PI * (0.3 + 0.7 * s)), 0.3);
      // The lobe twists about its own axis along its length.
      const lobeTwist = twist * s;
      const centre = outward
        .clone()
        .multiplyScalar(radial)
        .add(new THREE.Vector3(0, height, 0));
      // Keep the deeper gold in the throat only.
      const color = THROAT_AMBER.clone().lerp(
        LOBE_YELLOW,
        THREE.MathUtils.smoothstep(s, 0.0, 0.2),
      );

      const rowIndices = [];
      for (let edge = -1; edge <= 1; edge += 2) {
        const offset = sideways
          .clone()
          .multiplyScalar(Math.cos(lobeTwist) * halfWidth * edge)
          .add(new THREE.Vector3(0, Math.sin(lobeTwist) * halfWidth * edge, 0));
        rowIndices.push(
          pushVertex(
            centre.clone().add(offset),
            color.clone().lerp(LOBE_EDGE, 0.3 * s),
          ),
        );
      }
      rows.push(rowIndices);
    }

    for (let step = 0; step < lobeSegments; step += 1) {
      const [a, b] = rows[step];
      const [c, d] = rows[step + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A closed flower bud: the swollen, still-furled corolla that sits on bare
 * wood for weeks before the display opens. Built along +Y like the open
 * corolla so both share one instancing convention.
 */
export function createFlowerBudGeometry({ segments = 6, rings = 5 } = {}) {
  const positions = [];
  const colors = [];
  const indices = [];
  // Unopened buds are duller and browner than the open corolla; the yellow
  // only shows once the lobes start to separate at the tip.
  const budBase = new THREE.Color(0xa8973f);
  const budTip = new THREE.Color(0xf2c62b);

  const pushVertex = (point, color) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  const rows = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    // A slender teardrop: widest below the middle, drawn to a soft point.
    const radius = 0.28 * Math.sin(Math.PI * Math.pow(t, 0.78));
    const y = t;
    const color = budBase.clone().lerp(budTip, Math.pow(t, 1.6));
    const rowIndices = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      // A faint longitudinal groove marks where the four lobes are furled.
      const groove = 1 + 0.06 * Math.cos(angle * 4);
      rowIndices.push(
        pushVertex(
          new THREE.Vector3(
            Math.cos(angle) * radius * groove,
            y,
            Math.sin(angle) * radius * groove,
          ),
          color,
        ),
      );
    }
    rows.push(rowIndices);
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = rows[ring][segment];
      const b = rows[ring][next];
      const c = rows[ring + 1][segment];
      const d = rows[ring + 1][next];
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A dry, two-celled dehiscent capsule: small, brown, beaked, unshowy. */
export function createCapsuleGeometry() {
  const geometry = new THREE.SphereGeometry(0.5, 8, 6);
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
