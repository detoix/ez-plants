import * as THREE from 'three';

import {
  finishGeometry,
  fract,
  GOLDEN_ANGLE,
  validatePositiveInteger,
} from '../../organ-geometry.js';

// A Limelight panicle is overwhelmingly made from showy sterile flowers, and
// they are carried on the floret plate rather than meshed. The vertex colours
// below are for the structure under them, and are deliberately pale: an
// InstancedMesh multiplies them by lime, cream, pink, or parchment instance
// colours as the same reusable panicle passes through the season.
const PANICLE_STEM_BASE = new THREE.Color(0x66704a);
const PANICLE_STEM_TIP = new THREE.Color(0x929b68);
const BUD_BASE = new THREE.Color(0x755746);
const BUD_MIDDLE = new THREE.Color(0x8d7952);
const BUD_TIP = new THREE.Color(0x8a9362);

/** Where a panicle's lower half gives way to its later-opening apex. */
const REGION_SPLIT = 0.58;

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

/**
 * Base→apex tint baked into the card vertices.
 *
 * A panicle opens from the bottom up, so its apex runs about a week behind its
 * base and stays greener and darker through every colour change the season
 * makes. Two separately-coloured meshes used to carry that, at the cost of a
 * second draw for one head.
 *
 * One multiplicative gradient carries it instead. This is an approximation of
 * two independent points on the colour path rather than the path itself, but
 * it holds in both directions the lag actually shows up: a fresh cream head
 * keeps a limier apex, and a retained parchment one keeps a darker apex. The
 * plant's own per-instance colour supplies everything else.
 */
const APEX_LAG = Object.freeze([0.88, 0.92, 0.76]);

/** How far a card's shading normal is leaned from the shell towards the sky. */
const SKYWARD_SHADING = 0.55;

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const SIDE_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Four mutually independent irrational strides.
 *
 * Every quantity a card is placed by comes from `fract(index * stride)`, and
 * two quantities drawn from strides that sum to one are the *same* sequence
 * reflected. Height first came off 0.618 while azimuth came off the golden
 * angle, which is 0.382 of a turn -- and 0.618 + 0.382 = 1, so a card's height
 * was exactly one minus its azimuth. Sixty-eight cards meant to clothe a cone
 * instead lay on a single spiral that wrapped it once, and the heads rendered
 * as hooks. These are the additive-recurrence constants for two, three, four
 * and five dimensions; no two are related by so much as an integer.
 */
const PHI_1 = 0.5698402909980532;
const PHI_2 = 0.7548776662466927;
const PHI_3 = 0.8191725133961644;
const PHI_4 = 0.6823278038280193;

/** Deterministic unit jitter in [-1, 1] from an integer sequence. */
function jitter(sequence, salt) {
  return fract((sequence + 1) * salt) * 2 - 1;
}

/**
 * Append one cluster of four-sepal florets as a single textured quad.
 *
 * The card is *oriented* by the panicle's outward shell normal tilted by a
 * bounded deterministic amount, and *shaded* by that shell normal leaned
 * towards the sky. The two are deliberately different, for reasons given at
 * each of them below.
 */
function appendFloretCard(
  buffers,
  { centre, normal, aroundTangent, size, sequence },
) {
  const { positions, colors, normals, uvs, indices } = buffers;

  // Bounded tightly. Enough tilt to break the shell up and give the outline
  // flowers rather than facets; not so much that a card stands proud of the
  // cone it is clothing and blurs 'Limelight's tapered profile into a blob.
  const tiltAround = jitter(sequence, PHI_2) * 0.5;
  const tiltVertical = jitter(sequence, PHI_3) * 0.4;
  const verticalTangent = normal.clone().cross(aroundTangent).normalize();
  const facing = normal
    .clone()
    .addScaledVector(aroundTangent, Math.tan(tiltAround))
    .addScaledVector(verticalTangent, Math.tan(tiltVertical))
    .normalize();

  // Roll the card in its own plane so neighbouring clusters never line up.
  const roll = fract(sequence * PHI_4) * Math.PI * 2;
  const seed = Math.abs(facing.y) < 0.9 ? UP_AXIS : SIDE_AXIS;
  const right = seed.clone().cross(facing).normalize();
  const up = facing.clone().cross(right).normalize();
  const axisA = right
    .clone()
    .multiplyScalar(Math.cos(roll))
    .addScaledVector(up, Math.sin(roll));
  const axisB = right
    .clone()
    .multiplyScalar(-Math.sin(roll))
    .addScaledVector(up, Math.cos(roll));

  // Apex lag, evaluated at the card's own height rather than per region.
  const lag = THREE.MathUtils.smoothstep(centre.y, REGION_SPLIT - 0.22, 0.98);
  const tint = [
    THREE.MathUtils.lerp(1, APEX_LAG[0], lag),
    THREE.MathUtils.lerp(1, APEX_LAG[1], lag),
    THREE.MathUtils.lerp(1, APEX_LAG[2], lag),
  ];

  // Shade by the shell, not by the card, and lift the shell normal towards the
  // sky. Two reasons, and they compound.
  //
  // The tilt above exists to fix the head's silhouette; letting lighting
  // follow it makes a smooth cone read as a heap of randomly-lit flakes. So
  // the normal comes from the shell.
  //
  // But a shell of cards is not a closed surface. Cards at different depths
  // and angles overlap in projection, so two neighbouring pixels can come from
  // the front of the head and the side of it, whose shell normals are ninety
  // degrees apart -- rendered flat white, the head came out as bright and
  // near-black cards side by side. A real panicle does not shade like an
  // opaque sphere either: it is a translucent mass of pale sepals passing
  // light through itself, low-contrast and bright, which is exactly what
  // photographs show. Leaning the normal towards +Y buys both at once.
  const shaded = normal
    .clone()
    .multiplyScalar(1 - SKYWARD_SHADING)
    .addScaledVector(UP_AXIS, SKYWARD_SHADING)
    .normalize();

  const half = size / 2;
  const base = positions.length / 3;
  const corners = [
    [-1, 1],
    [-1, -1],
    [1, -1],
    [1, 1],
  ];
  const cardUVs = [0, 1, 0, 0, 1, 0, 1, 1];
  corners.forEach(([a, b], corner) => {
    const point = centre
      .clone()
      .addScaledVector(axisA, a * half)
      .addScaledVector(axisB, b * half);
    positions.push(point.x, point.y, point.z);
    colors.push(tint[0], tint[1], tint[2]);
    normals.push(shaded.x, shaded.y, shaded.z);
    uvs.push(cardUVs[corner * 2], cardUVs[corner * 2 + 1]);
  });
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Build one whole Limelight head, at one rung of its detail ladder.
 *
 * Unit frame is unchanged from the meshed panicle this replaces: rooted at
 * y=0, one unit long up +Y, about one unit across the broad lower shoulder --
 * so the same instance matrix (X/Z to panicle width, Y to length) still
 * places it.
 *
 * The head is a shell of textured floret-cluster cards. Cards sit between 45%
 * and 95% of the shell radius rather than on it, which fills the head's volume
 * instead of leaving a hollow crust, and the coarser rungs answer a smaller
 * card count with larger cards so coverage holds as the head simplifies.
 *
 * Rung 0 also carries a three-sided central rachis. It is only ever glimpsed
 * between florets on a cultivar this densely sterile, but at arm's length the
 * alternative is seeing through the head into nothing.
 *
 * @param {object} [options]
 * @param {number} [options.cards=44] Floret-cluster cards over the shell.
 * @param {number} [options.cardSize=0.34] Card edge, in panicle lengths.
 * @param {boolean} [options.rachis=true] Include the central axis.
 * @returns {THREE.BufferGeometry} Instancing-ready, textured, vertex-coloured.
 */
export function createPanicleGeometry({
  cards = 44,
  cardSize = 0.34,
  rachis = true,
} = {}) {
  validatePositiveInteger(cards, 'cards');
  if (!Number.isFinite(cardSize) || cardSize <= 0 || cardSize > 1.5) {
    throw new RangeError('cardSize must be a positive number up to 1.5.');
  }

  const buffers = {
    positions: [],
    colors: [],
    normals: [],
    uvs: [],
    indices: [],
  };

  if (rachis) {
    appendPanicleRachis(buffers);
  }

  for (let card = 0; card < cards; card += 1) {
    // Height by an additive-recurrence sequence rather than by rings: rings on
    // a cone this short read as stacked bands once the cards are large.
    //
    // Inset by the card's own size, because a card is placed by its centre and
    // drawn around it. Without the inset a coarse rung -- ten cards, each most
    // of a head wide -- draws a head a fifth longer than the model asked for,
    // and the panicle visibly grows every time the plant crosses a band.
    const heightT = fract(card * PHI_1 + 0.13);
    const y = THREE.MathUtils.lerp(
      0.04 + cardSize * 0.52,
      0.98 - cardSize * 0.26,
      heightT,
    );
    const angle = card * GOLDEN_ANGLE;
    const shell = panicleRadius(y);
    // Kept close to the shell rather than spread through the volume. A card
    // sunk to the middle of the head is a card whose outward normal can point
    // anywhere -- including straight away from the sun -- while still being
    // visible through the gaps around it, and a head clothed that way shades
    // in patches instead of as one convex body.
    const depth = 0.78 + 0.22 * fract(card * PHI_2);
    const localRadius = shell * depth;
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

    // Cards shrink with the shell, hard. The apex of this cone is a tenth of
    // the width of its shoulder, so a card scaled gently for its height is
    // still several times wider than the tip it sits on, and the pointed
    // profile the cultivar is known for comes out as a blunt fluffy head.
    const size = cardSize * (0.42 + 0.75 * (shell / 0.5));

    appendFloretCard(buffers, {
      centre,
      normal,
      aroundTangent,
      size,
      sequence: card,
    });
  }

  return finishGeometry({
    ...buffers,
    userData: {
      organ: 'panicle',
      cards,
      rachis,
      // What the plate multiplies out to on screen: the tile carries nine
      // florets, of which about five read as whole at card scale.
      apparentFlorets: cards * 5,
    },
  });
}

/** A minimal central axis, UV-parked on an opaque part of the floret plate. */
function appendPanicleRachis(buffers) {
  const { positions, colors, normals, uvs, indices } = buffers;
  const sides = 3;
  const rings = [];
  const profile = [
    [0.0, 0.016],
    [0.55, 0.0085],
    [0.985, 0.003],
  ];

  for (const [y, radius] of profile) {
    const ring = [];
    const shade = THREE.MathUtils.lerp(0.42, 0.62, y);
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      const colour = PANICLE_STEM_BASE.clone()
        .lerp(PANICLE_STEM_TIP, y)
        .multiplyScalar(shade / 0.5);
      colors.push(colour.r, colour.g, colour.b);
      normals.push(Math.cos(angle), 0, Math.sin(angle));
      // The plate's central floret, well inside its opaque core, so the axis
      // survives the same alpha test the cards are drawn with.
      uvs.push(0.5, 0.52);
      ring.push(positions.length / 3 - 1);
    }
    rings.push(ring);
  }

  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const a = rings[ring][side];
      const b = rings[ring][next];
      const c = rings[ring + 1][side];
      const d = rings[ring + 1][next];
      indices.push(a, c, b, b, c, d);
    }
  }
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
