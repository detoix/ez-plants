import * as THREE from 'three';

// A Limelight panicle is overwhelmingly made from showy sterile flowers. The
// neutral, slightly green vertex colours below are deliberately pale: an
// InstancedMesh can multiply them by lime, cream, pink, or parchment instance
// colours as the same reusable panicle passes through the season.
const SEPAL_THROAT = new THREE.Color(0xdce7b6);
const SEPAL_FACE = new THREE.Color(0xf4f5dc);
const SEPAL_EDGE = new THREE.Color(0xffffff);
const FERTILE_BASE = new THREE.Color(0x718445);
const FERTILE_TIP = new THREE.Color(0xc3cf86);
const PANICLE_STEM_BASE = new THREE.Color(0x66704a);
const PANICLE_STEM_TIP = new THREE.Color(0x929b68);
const BUD_BASE = new THREE.Color(0x755746);
const BUD_MIDDLE = new THREE.Color(0x8d7952);
const BUD_TIP = new THREE.Color(0x8a9362);

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const REGION_SPLIT = 0.58;
const VALID_REGIONS = new Set(['all', 'lower', 'upper']);

function fract(value) {
  return value - Math.floor(value);
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function finishGeometry({ positions, colors, indices, userData = {} }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  Object.assign(geometry.userData, userData);
  return geometry;
}

// Broadest just above the base, then steadily tapering. The root remains
// narrower than the lower third, which avoids the silhouette of a solid cone.
function panicleRadius(y) {
  // 'Limelight' is a broad, plump cone -- often described as football-like --
  // rather than a narrow spike. Hold most of the width through the lower two
  // thirds, then close the cap quickly enough to keep a real tapered apex.
  const capT = THREE.MathUtils.clamp((y - 0.72) / 0.26, 0, 1);
  const cap = capT * capT * (3 - 2 * capT);
  const taper = Math.pow(Math.max(0, 1 - y), 0.36) * (1 - 0.52 * cap);
  const basalShoulder = 0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, y / 0.24));
  return 0.5 * taper * basalShoulder;
}

function radiusDerivative(y) {
  const epsilon = 0.001;
  const low = Math.max(0, y - epsilon);
  const high = Math.min(1, y + epsilon);
  return (panicleRadius(high) - panicleRadius(low)) / (high - low || 1);
}

function includesRegion(region, y) {
  if (region === 'lower') return y <= REGION_SPLIT;
  if (region === 'upper') return y > REGION_SPLIT;
  return true;
}

/**
 * Append one sterile hydrangea flower to a panicle buffer.
 *
 * Limelight's show is made by four enlarged, petal-like sepals rather than by
 * true petals. Each sepal is its own shallowly cupped ovate face; keeping the
 * four faces separate preserves the dark cross-shaped throat seen in close
 * photographs.
 */
function appendSterileFloret(
  buffers,
  { centre, normal, verticalTangent, aroundTangent, size, rotation },
) {
  const { positions, colors, indices } = buffers;
  const pushVertex = (point, color) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  // Six rim vertices are enough for the soft oval at panicle scale. Together
  // with a raised centre they form a shallow cup rather than a paper-flat card.
  const rimSegments = 6;
  for (let sepalIndex = 0; sepalIndex < 4; sepalIndex += 1) {
    const angle = rotation + (sepalIndex * Math.PI) / 2;
    const direction = aroundTangent
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(verticalTangent, Math.sin(angle))
      .normalize();
    // direction x side points along the outward surface normal, which fixes
    // winding for all four sepals regardless of their rotation in the flower.
    const side = normal.clone().cross(direction).normalize();
    const length = size * (0.92 + 0.07 * Math.cos(sepalIndex * 2.3 + rotation));
    const halfWidth = length * (0.41 + 0.025 * Math.sin(rotation * 3));
    const sepalCentre = centre.clone().addScaledVector(direction, length * 0.5);
    const centreIndex = pushVertex(
      sepalCentre.clone().addScaledVector(normal, length * 0.055),
      SEPAL_THROAT.clone().lerp(SEPAL_FACE, 0.42),
    );
    const rim = [];

    for (let segment = 0; segment < rimSegments; segment += 1) {
      const theta = (segment / rimSegments) * Math.PI * 2;
      const longitudinal = Math.cos(theta) * length * 0.5;
      // Slightly narrow the throat half of the ellipse to make it ovate rather
      // than a four-disc clover.
      const throatSide = longitudinal < 0 ? 0.76 : 1;
      const lateral = Math.sin(theta) * halfWidth * throatSide;
      const point = sepalCentre
        .clone()
        .addScaledVector(direction, longitudinal)
        .addScaledVector(side, lateral);
      const edgeColour = SEPAL_FACE.clone().lerp(
        SEPAL_EDGE,
        0.34 + 0.16 * Math.max(0, Math.cos(theta)),
      );
      rim.push(pushVertex(point, edgeColour));
    }

    for (let segment = 0; segment < rimSegments; segment += 1) {
      indices.push(centreIndex, rim[segment], rim[(segment + 1) % rimSegments]);
    }
  }
}

/**
 * Build the showy sterile-flower shell of one whole Limelight panicle.
 *
 * The unit panicle is rooted at the origin, grows along +Y, is one unit long,
 * and is approximately one unit wide at its broad lower shoulder. Pass
 * `region: 'lower'` and `region: 'upper'` to make two matching geometries for
 * bottom-up flower opening/colour changes; both calls select from the same
 * deterministic floret layout and therefore join without a visible seam.
 *
 * @param {object} [options]
 * @param {'all'|'lower'|'upper'} [options.region='all'] Vertical portion.
 * @param {number} [options.rings=11] Number of deterministic floret rings.
 * @param {number} [options.density=1.8] Relative floret density, 0.25–2.
 * @returns {THREE.BufferGeometry} Instancing-ready, vertex-coloured geometry.
 */
export function createSterilePanicleGeometry({
  region = 'all',
  rings = 11,
  density = 1.8,
} = {}) {
  if (!VALID_REGIONS.has(region)) {
    throw new RangeError(`Unknown panicle region: ${region}.`);
  }
  validatePositiveInteger(rings, 'rings');
  if (!Number.isFinite(density) || density < 0.25 || density > 2) {
    throw new RangeError('density must be a finite number from 0.25 to 2.');
  }

  const buffers = { positions: [], colors: [], indices: [] };
  let floretCount = 0;

  for (let ring = 0; ring < rings; ring += 1) {
    const ringT = rings === 1 ? 0.5 : ring / (rings - 1);
    const nominalY = THREE.MathUtils.lerp(0.075, 0.925, ringT);
    const radius = panicleRadius(nominalY);
    const aroundCount = Math.max(
      3,
      Math.round((4.2 + 10.5 * (radius / 0.5)) * density),
    );

    for (let around = 0; around < aroundCount; around += 1) {
      // Each ring has a golden-angle phase and a bounded, deterministic height
      // jitter. This removes the artificial stacked-cake pattern without any
      // mutable random state or dependence on call order.
      const phase = ring * GOLDEN_ANGLE;
      const angle = phase + (around / aroundCount) * Math.PI * 2;
      const sequence = ring * 131 + around * 71;
      const heightJitter = (fract(sequence * 0.61803398875) - 0.5) * 0.026;
      const y = THREE.MathUtils.clamp(nominalY + heightJitter, 0.06, 0.94);
      if (!includesRegion(region, y)) continue;

      const radialJitter = 0.86 + 0.13 * fract(sequence * 0.754877666);
      const localRadius = panicleRadius(y) * radialJitter;
      const centre = new THREE.Vector3(
        Math.cos(angle) * localRadius,
        y,
        Math.sin(angle) * localRadius,
      );
      const aroundTangent = new THREE.Vector3(
        -Math.sin(angle),
        0,
        Math.cos(angle),
      );
      const normal = new THREE.Vector3(
        Math.cos(angle),
        -radiusDerivative(y),
        Math.sin(angle),
      ).normalize();
      const verticalTangent = normal.clone().cross(aroundTangent).normalize();
      // At a 12-18 cm panicle width this produces 2.6-5.4 cm flower faces,
      // matching the patent's 2.7-4.7 cm visible sterile florets. The earlier
      // 0.087 scale rendered each flower at barely a centimetre and made the
      // photographed overstuffed heads read as sparse wire cones.
      const size = THREE.MathUtils.lerp(0.15, 0.11, y);
      const rotation = phase * 0.37 + around * GOLDEN_ANGLE;

      appendSterileFloret(buffers, {
        centre,
        normal,
        verticalTangent,
        aroundTangent,
        size,
        rotation,
      });
      floretCount += 1;
    }
  }

  // Basal and apical sepals naturally project a little past the centres of
  // the first/last rings. Renormalise that shared deterministic layout so the
  // complete flower surface, not merely its centres, remains rooted in 0..1.
  // The same transform is applied to lower and upper calls, preserving their
  // exact seam and base-to-tip colour registration.
  for (let offset = 1; offset < buffers.positions.length; offset += 3) {
    buffers.positions[offset] = (buffers.positions[offset] + 0.05) / 1.075;
  }

  return finishGeometry({
    ...buffers,
    userData: {
      organ: 'sterile-panicle',
      region,
      regionSplit: REGION_SPLIT,
      floretCount,
      sepalsPerFloret: 4,
    },
  });
}

function appendFertileBud(buffers, centre, radius, colourMix, turn) {
  const { positions, colors, indices } = buffers;
  const belt = [];
  const sides = 5;
  const colour = FERTILE_BASE.clone().lerp(FERTILE_TIP, colourMix);
  const pushVertex = (point, shade = 1) => {
    positions.push(point.x, point.y, point.z);
    const vertexColour = colour.clone().multiplyScalar(shade);
    colors.push(vertexColour.r, vertexColour.g, vertexColour.b);
    return positions.length / 3 - 1;
  };

  const bottom = pushVertex(
    centre.clone().add(new THREE.Vector3(0, -radius * 0.82, 0)),
    0.78,
  );
  const top = pushVertex(
    centre.clone().add(new THREE.Vector3(0, radius * 1.18, 0)),
    1.08,
  );
  for (let side = 0; side < sides; side += 1) {
    const angle = turn + (side / sides) * Math.PI * 2;
    belt.push(
      pushVertex(
        centre
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * radius,
              0,
              Math.sin(angle) * radius,
            ),
          ),
        0.9 + 0.08 * Math.cos(angle),
      ),
    );
  }
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    indices.push(bottom, belt[next], belt[side]);
    indices.push(top, belt[side], belt[next]);
  }
}

/**
 * Build the much smaller fertile-flower/bud mass inside one Limelight panicle.
 *
 * Limelight is a very densely sterile cultivar, so these five-sided buds are
 * deliberately sparse and sit at varied depths inside the showy shell. The
 * gaps are intentional: the result reads as individual fertile flowers and a
 * branching interior, never as an opaque green cone.
 *
 * @param {object} [options]
 * @param {number} [options.count=52] Number of representative fertile buds.
 * @returns {THREE.BufferGeometry} One normalized whole-panicle geometry.
 */
export function createFertilePanicleGeometry({ count = 52 } = {}) {
  validatePositiveInteger(count, 'count');
  const buffers = { positions: [], colors: [], indices: [] };

  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.65) / (count + 0.3);
    const y = THREE.MathUtils.lerp(0.055, 0.955, t);
    const angle = index * GOLDEN_ANGLE;
    // Alternate between exposed flowers in gaps and deeper fertile flowers.
    const depth = 0.25 + 0.62 * fract((index + 1) * 0.569840296);
    const radius = panicleRadius(y) * depth;
    const centre = new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius,
    );
    const budRadius = THREE.MathUtils.lerp(0.0125, 0.0085, y);
    appendFertileBud(buffers, centre, budRadius, 0.25 + 0.55 * y, angle);
  }

  return finishGeometry({
    ...buffers,
    userData: {
      organ: 'fertile-panicle',
      representativeFlowerCount: count,
    },
  });
}

function appendTaperedTube(
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
  const { positions, colors, indices } = buffers;
  const pushVertex = (point, colour) => {
    positions.push(point.x, point.y, point.z);
    colors.push(colour.r, colour.g, colour.b);
    return positions.length / 3 - 1;
  };
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
}

/**
 * Build one whole-panicle rachis and its tapered compound branchlets.
 *
 * A straight central rachis runs from y=0 almost to the tip. Alternating pairs
 * and three-part whorls divide into short forks beneath the sterile-flower
 * shell. This is intentionally an open low-poly framework: it gives close
 * views biological support for the flowers without turning the panicle into a
 * solid cone. As with the flower geometries, instantiate once per panicle and
 * scale X/Z to panicle width and Y to panicle length.
 *
 * @param {object} [options]
 * @param {number} [options.levels=9] Branching levels along the rachis.
 * @param {number} [options.sides=5] Polygon sides per tapered stem tube.
 * @returns {THREE.BufferGeometry} Normalized, vertex-coloured rachis geometry.
 */
export function createPanicleStemGeometry({ levels = 9, sides = 5 } = {}) {
  validatePositiveInteger(levels, 'levels');
  validatePositiveInteger(sides, 'sides');
  if (levels < 3 || sides < 3) {
    throw new RangeError(
      'Panicle stems need at least 3 levels and 3 tube sides.',
    );
  }

  const buffers = { positions: [], colors: [], indices: [] };
  appendTaperedTube(buffers, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(0, 0.985, 0),
    startRadius: 0.014,
    endRadius: 0.0035,
    sides,
    startColour: PANICLE_STEM_BASE,
    endColour: PANICLE_STEM_TIP,
    capStart: true,
    capEnd: true,
  });

  let branchCount = 0;
  for (let level = 0; level < levels; level += 1) {
    const levelT = levels === 1 ? 0.5 : level / (levels - 1);
    const y = THREE.MathUtils.lerp(0.105, 0.82, levelT);
    const branchesInWhorl = level % 3 === 1 ? 3 : 2;
    const phase = level * GOLDEN_ANGLE;
    const shellRadius = panicleRadius(y);
    const primaryReach = shellRadius * (0.5 + 0.08 * (1 - levelT));
    const branchColour = PANICLE_STEM_BASE.clone().lerp(
      PANICLE_STEM_TIP,
      0.35 + 0.55 * levelT,
    );

    for (let branch = 0; branch < branchesInWhorl; branch += 1) {
      const angle = phase + (branch / branchesInWhorl) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const start = new THREE.Vector3(0, y, 0);
      const fork = start
        .clone()
        .addScaledVector(radial, primaryReach)
        .add(new THREE.Vector3(0, 0.025 + 0.025 * levelT, 0));
      appendTaperedTube(buffers, {
        start,
        end: fork,
        startRadius: THREE.MathUtils.lerp(0.007, 0.0038, levelT),
        endRadius: THREE.MathUtils.lerp(0.0035, 0.002, levelT),
        sides,
        startColour: branchColour.clone().multiplyScalar(0.88),
        endColour: branchColour,
        capEnd: false,
      });
      branchCount += 1;

      // A compact two-way terminal fork is the visible remnant of the compound
      // panicle branching once the dense sterile sepals are instanced over it.
      for (let forkSide = -1; forkSide <= 1; forkSide += 2) {
        const forkAngle = angle + forkSide * (0.18 + 0.05 * levelT);
        const forkDirection = new THREE.Vector3(
          Math.cos(forkAngle),
          0,
          Math.sin(forkAngle),
        );
        const end = fork
          .clone()
          .addScaledVector(
            forkDirection,
            shellRadius * THREE.MathUtils.lerp(0.24, 0.14, levelT),
          )
          .add(new THREE.Vector3(0, 0.025 + 0.015 * levelT, 0));
        appendTaperedTube(buffers, {
          start: fork,
          end,
          startRadius: THREE.MathUtils.lerp(0.0034, 0.0019, levelT),
          endRadius: THREE.MathUtils.lerp(0.0015, 0.0009, levelT),
          sides,
          startColour: branchColour,
          endColour: PANICLE_STEM_TIP,
        });
        branchCount += 1;
      }
    }
  }

  return finishGeometry({
    ...buffers,
    userData: {
      organ: 'panicle-stem',
      branchCount,
      branchingLevels: levels,
    },
  });
}

/**
 * Create a reusable pointed vegetative bud, rooted at y=0 and ending at y=1.
 * The slightly compressed cross-section and two longitudinal grooves suggest
 * the paired outer scales of an opposite hydrangea bud without adding a
 * separate mesh per scale.
 */
export function createVegetativeBudGeometry({ segments = 8, rings = 5 } = {}) {
  validatePositiveInteger(segments, 'segments');
  validatePositiveInteger(rings, 'rings');
  if (segments < 4 || rings < 2) {
    throw new RangeError(
      'Vegetative buds need at least 4 segments and 2 rings.',
    );
  }

  const positions = [];
  const colors = [];
  const indices = [];
  const pushVertex = (point, color) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  const bottom = pushVertex(new THREE.Vector3(0, 0, 0), BUD_BASE);
  const rows = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const t = ring / rings;
    const radius = 0.34 * Math.pow(Math.sin(Math.PI * t), 0.72);
    const colour =
      t < 0.62
        ? BUD_BASE.clone().lerp(BUD_MIDDLE, t / 0.62)
        : BUD_MIDDLE.clone().lerp(BUD_TIP, (t - 0.62) / 0.38);
    const row = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      // Hydrangea buds are laterally compressed. A subtle two-fold groove
      // reads as paired scales once instance tint and directional light apply.
      const groove = 1 - 0.09 * Math.pow(Math.abs(Math.cos(angle)), 8);
      row.push(
        pushVertex(
          new THREE.Vector3(
            Math.cos(angle) * radius * groove,
            t,
            Math.sin(angle) * radius * 0.72,
          ),
          colour,
        ),
      );
    }
    rows.push(row);
  }
  const top = pushVertex(new THREE.Vector3(0, 1, 0), BUD_TIP);

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(bottom, rows[0][segment], rows[0][next]);
  }
  for (let ring = 0; ring < rows.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = rows[ring][segment];
      const b = rows[ring][next];
      const c = rows[ring + 1][segment];
      const d = rows[ring + 1][next];
      indices.push(a, c, b, b, c, d);
    }
  }
  const last = rows.at(-1);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(top, last[next], last[segment]);
  }

  return finishGeometry({
    positions,
    colors,
    indices,
    userData: { organ: 'vegetative-bud' },
  });
}
