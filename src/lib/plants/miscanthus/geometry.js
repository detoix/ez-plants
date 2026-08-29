import * as THREE from 'three';

import {
  finishGeometry,
  fract,
  GOLDEN_ANGLE,
  validatePositiveInteger,
} from '../../organ-geometry.js';

/**
 * Geometry for the organs a grass has and this library's shrubs do not.
 *
 * Two rules keep these compatible with the shared renderer:
 *
 * 1. Every geometry is a unit organ rooted at the origin, running to y = 1,
 *    so an instance matrix carries its real size. A blade's centreline is
 *    integrated at unit speed and its width baked in as an aspect ratio, so
 *    one uniform scale gives it its true length and width at once.
 * 2. Vertex colours carry the organ's *internal* pattern only — the pale
 *    midrib, the darker margin, the shaded hair base. The season's actual
 *    colour arrives as an instance colour and multiplies through, so one
 *    blade geometry serves green summer, copper autumn and buff winter.
 */

// An instance colour multiplies these, so they carry the blade's light-and-
// dark pattern only; every trace of hue belongs to the instance colour, or a
// straw winter blade would keep a green cast from its own lamina.
//
// The midrib is only modestly lighter here. Its near-white comes from the
// additive emissive strip below, which does not depend on the host scene's
// exposure or tone mapping the way an over-driven multiplier would.
const BLADE_MIDRIB = new THREE.Color(1.3, 1.32, 1.24);
const BLADE_LAMINA = new THREE.Color(0.86, 0.9, 0.83);
const BLADE_MARGIN = new THREE.Color(0.6, 0.64, 0.58);
const BLADE_BASE_SHADE = 0.82;

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

/**
 * The three baked blade curvatures, from the short erect flag leaf under a
 * panicle to the long recurved blades low on a culm. A model snaps each
 * blade to one of these so its predicted reach matches what is drawn.
 */
export const BLADE_ARCH_VARIANTS = Object.freeze([0.32, 0.62, 0.9]);

/**
 * The single arch the blade geometry is meshed at. The middle variant, so no
 * instance is tilted more than about fifteen degrees off what it was baked as.
 */
export const BLADE_BAKED_ARCH = BLADE_ARCH_VARIANTS[1];

/** Blade twist that goes with each arch: longer, laxer blades turn over more. */
export const BLADE_TWIST_VARIANTS = Object.freeze([0.24, 0.52, 0.82]);

/**
 * Blade width as a fraction of blade length, per variant.
 *
 * Grass blade width tracks length closely, so baking the aspect into the
 * geometry and scaling each instance uniformly is both simpler and more
 * faithful than scaling width on its own — and it is the only option that
 * survives the twist (see `createBladeGeometry`). Across the modelled length
 * range these give roughly the 1-2 cm blades the sources describe, with the
 * short erect flag leaves relatively broader than the long recurved ones.
 */
export const BLADE_WIDTH_RATIOS = Object.freeze([0.032, 0.028, 0.025]);

/** Index of the baked blade variant closest to a requested arch. */
export function bladeVariantFor(arch) {
  let best = 0;
  for (let index = 1; index < BLADE_ARCH_VARIANTS.length; index += 1) {
    if (
      Math.abs(BLADE_ARCH_VARIANTS[index] - arch) <
      Math.abs(BLADE_ARCH_VARIANTS[best] - arch)
    ) {
      best = index;
    }
  }
  return best;
}

/* ==================================================================== *
 * Leaf blade
 * ==================================================================== */

/**
 * Across-blade vertex columns, by how many the caller asks for.
 *
 * Five is the shape the blade was authored at: two margins, two lamina and a
 * midrib, with the inner pair close to the centre so the pale midrib band
 * stays a fine line. Spacing them evenly — as an earlier version did —
 * brightened half the blade and made it read as a variegated cultivar rather
 * than 'Malepartus'.
 *
 * Two is what a clump of 759 blades can actually afford, and it costs less
 * than it looks. The midrib is drawn by an additive emissive strip sampled by
 * `uv.x`, and `uv.x` interpolates across a fragment whether there are two
 * vertices spanning it or five — so the signature white stripe survives
 * intact. What goes is the basal keel, which needs a centre column to lift
 * (and falls out of the arithmetic on its own here), and the margin shading,
 * so both edges take the lamina tone rather than the darker margin one.
 */
const COLUMN_LAYOUTS = Object.freeze({
  5: {
    offsets: [-0.5, -0.14, 0, 0.14, 0.5],
    colours: [
      BLADE_MARGIN,
      BLADE_LAMINA,
      BLADE_MIDRIB,
      BLADE_LAMINA,
      BLADE_MARGIN,
    ],
  },
  3: {
    offsets: [-0.5, 0, 0.5],
    colours: [BLADE_MARGIN, BLADE_MIDRIB, BLADE_MARGIN],
  },
  2: {
    offsets: [-0.5, 0.5],
    colours: [BLADE_LAMINA, BLADE_LAMINA],
  },
});

/**
 * Half-width of the blade at arc position `s`, as a fraction of full width.
 * Grasses widen fast out of the sheath, hold width through the middle, then
 * run out in a long fine point rather than an ovate tip.
 */
function bladeHalfWidth(s) {
  const shoulder = clamp01(s / 0.16);
  const opening = 0.46 + 0.54 * shoulder * shoulder * (3 - 2 * shoulder);
  const taper = Math.pow(clamp01((1 - s) / 0.88), 0.62);
  return 0.5 * opening * Math.min(1, taper);
}

/**
 * Where the tip of a unit blade lands, for a given arch.
 *
 * This reports where the tip of the blade that is *actually drawn* lands, so a
 * growth model can predict a blade's reach — for the plant's spread, for a
 * camera frame — without building the geometry, and cannot drift away from it.
 *
 * Since only one blade is meshed and the variants are rotations of it (see
 * `bladeArchTilt`), every arch reaches the same distance and differs only in
 * direction. That is why this is not simply the integration of `arch`.
 *
 * @param {number} arch Same 0..1.4 value passed to `createBladeGeometry`.
 * @param {number} [segments=22] Same sampling as the geometry.
 * @returns {{along: number, across: number}} Tip offset per unit blade length,
 *   `along` in the blade's emergence direction and `across` in its arch.
 */
export function bladeTipOffset(arch, segments = 22) {
  const drawn = integrateBladeTip(BLADE_BAKED_ARCH, segments);
  const reach = Math.hypot(drawn.along, drawn.across);
  const angle = bladeTipAngle(arch, segments);
  return { along: reach * Math.cos(angle), across: reach * Math.sin(angle) };
}

/** The raw unit-speed integration of one arch, before any variant tilt. */
function integrateBladeTip(arch, segments) {
  const tipAngle = arch * (Math.PI * 0.5 + 0.5);
  let across = 0;
  let along = 0;
  for (let index = 1; index <= segments; index += 1) {
    const previous = tipAngle * Math.pow((index - 1) / segments, 1.42);
    const current = tipAngle * Math.pow(index / segments, 1.42);
    const step = 1 / segments;
    across += ((Math.sin(previous) + Math.sin(current)) / 2) * step;
    along += ((Math.cos(previous) + Math.cos(current)) / 2) * step;
  }
  return { along, across };
}

/** Angle of an arch's tip from the blade's emergence axis, in radians. */
function bladeTipAngle(arch, segments = 22) {
  const tip = integrateBladeTip(arch, segments);
  return Math.atan2(tip.across, tip.along);
}

/**
 * The extra rotation that makes the one baked blade reach like `arch`.
 *
 * Only one blade geometry is meshed, because a plant gets three draws at its
 * near band and this one needs them for blades, head and culms — and library
 * rule 9 is explicit that "three blade kinds that differ only in posture are
 * one kind with three transforms". This is that transform: a rotation in the
 * blade's own arch plane, about its width axis, applied before the roll.
 *
 * Baking at the middle variant keeps the correction small — the three tip
 * angles are 15.7°, 30.2° and 43.6°, so nothing is tilted more than fifteen
 * degrees, and a grass blade leaving its sheath at a slightly different angle
 * is what a grass blade does anyway. What a rigid rotation cannot reproduce is
 * the *shape* difference: an erect flag leaf is now a gently arched blade held
 * upright rather than a straighter one, and it shares the middle variant's
 * twist and width ratio. Across a clump of several hundred blades that reads
 * as the same fountain; at the scale of one blade it is an approximation.
 *
 * @param {number} arch Same 0..1.4 value the model carries.
 * @returns {number} Radians, positive to arch further out.
 */
export function bladeArchTilt(arch) {
  return bladeTipAngle(arch) - bladeTipAngle(BLADE_BAKED_ARCH);
}

/**
 * Build one unit leaf blade.
 *
 * The centreline is integrated at unit speed, so the arc length is exactly 1
 * and a single uniform instance scale gives the blade its real length in
 * metres however far it arches. Width is baked in as `widthRatio` rather than
 * left to a separate axis: the blade twists about its own axis as it runs
 * out, which mixes the across-blade direction into the plane the arch lives
 * in, so a non-uniform scale would stretch the twisted part of every blade
 * into a paddle.
 *
 * @param {object} [options]
 * @param {number} [options.arch=0.6] 0 = nearly erect, 1 = strongly recurved.
 * @param {number} [options.twist=0.5] Turn of the blade about its own axis.
 * @param {number} [options.widthRatio=0.028] Full width, as a fraction of length.
 * @param {number} [options.keel=0.16] Depth of the V-section near the base.
 * @param {number} [options.segments=22] Samples along the blade.
 * @param {number} [options.columns=5] Vertex columns across the blade: 5, 3
 *   or 2. See `COLUMN_LAYOUTS`.
 * @returns {THREE.BufferGeometry} Instancing-ready blade with UVs for wind.
 */
export function createBladeGeometry({
  arch = 0.6,
  twist = 0.5,
  widthRatio = 0.028,
  keel = 0.16,
  segments = 22,
  columns = 5,
} = {}) {
  validatePositiveInteger(segments, 'segments');
  if (segments < 4) throw new RangeError('A blade needs at least 4 segments.');
  if (!Number.isFinite(arch) || arch < 0 || arch > 1.4) {
    throw new RangeError('arch must be a finite number from 0 to 1.4.');
  }
  if (!Number.isFinite(twist) || Math.abs(twist) > 3) {
    throw new RangeError('twist must be a finite number from -3 to 3.');
  }
  if (!Number.isFinite(widthRatio) || widthRatio <= 0 || widthRatio > 0.5) {
    throw new RangeError('widthRatio must be a finite number from 0 to 0.5.');
  }

  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const layout = COLUMN_LAYOUTS[columns];
  if (!layout) {
    throw new RangeError(`A blade needs 2, 3 or 5 columns, not ${columns}.`);
  }
  const { offsets: columnOffsets, colours: columnColour } = layout;
  // A cantilevered blade bends increasingly toward its tip, so the slope
  // grows faster than arc length. The exponent is what stops the base from
  // curling straight out of the sheath.
  const tipAngle = arch * (Math.PI * 0.5 + 0.5);
  const rows = [];
  let x = 0;
  let y = 0;

  for (let index = 0; index <= segments; index += 1) {
    const s = index / segments;
    const angle = tipAngle * Math.pow(s, 1.42);
    const tangent = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    if (index > 0) {
      // Trapezoidal integration of a unit-speed curve keeps arc length at 1.
      const previous = tipAngle * Math.pow((index - 1) / segments, 1.42);
      const step = 1 / segments;
      x += ((Math.sin(previous) + tangent.x) / 2) * step;
      y += ((Math.cos(previous) + tangent.y) / 2) * step;
    }

    const halfWidth = bladeHalfWidth(s) * widthRatio;
    // The face normal lies in XY, perpendicular to the tangent: the blade
    // droops in the direction it faces.
    const faceX = tangent.y;
    const faceY = -tangent.x;
    // Miscanthus blades turn over as they run out. Rolling the width axis
    // about the tangent is what makes a long blade show both faces.
    const roll = twist * Math.pow(s, 1.25);
    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);
    // Keeled at the base, flat by mid-blade.
    const keelDepth = keel * widthRatio * Math.pow(clamp01(1 - s / 0.55), 1.6);
    const row = [];

    for (let column = 0; column < columnOffsets.length; column += 1) {
      const across = columnOffsets[column] * halfWidth * 2;
      const lift = keelDepth * (1 - Math.abs(columnOffsets[column]) / 0.5);
      // Rolling mixes the across-blade axis (local Z) into the face normal.
      const outOfPlane = across * sinRoll + lift * cosRoll;
      const inPlane = across * cosRoll - lift * sinRoll;
      positions.push(x + faceX * outOfPlane, y + faceY * outOfPlane, inPlane);
      const shade =
        BLADE_BASE_SHADE + (1 - BLADE_BASE_SHADE) * clamp01(s / 0.22);
      const colour = columnColour[column].clone().multiplyScalar(shade);
      colors.push(colour.r, colour.g, colour.b);
      // uv.x is the true normalised across-blade position, not the column
      // index: the emissive midrib strip is sampled by it, so it has to
      // correspond to real width or the stripe lands in the wrong place.
      // uv.y runs along the blade and is the wind bend weight the shared
      // leaf-wind shader multiplies by, so a blade sways from a still base to
      // a mobile tip exactly like a leaf card.
      uvs.push(columnOffsets[column] + 0.5, s);
      row.push(positions.length / 3 - 1);
    }
    rows.push(row);
  }

  for (let index = 0; index < segments; index += 1) {
    for (let column = 0; column < columnOffsets.length - 1; column += 1) {
      const a = rows[index][column];
      const b = rows[index][column + 1];
      const c = rows[index + 1][column];
      const d = rows[index + 1][column + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  return finishGeometry({
    positions,
    colors,
    indices,
    uvs,
    userData: {
      organ: 'grass-blade',
      arch,
      twist,
      widthRatio,
      // The instance contract: one uniform scale, the blade's length in metres.
      unitLength: 1,
    },
  });
}

/**
 * A one-row emissive strip that lights only the blade's midrib.
 *
 * The midrib cannot be produced by the instance colour alone: that colour is
 * multiplied through, and multiplication can brighten but never desaturate,
 * so reaching white means over-driving the value until it clips. That works
 * only if the host application happens to tone-map, which a library has no
 * business assuming — in a dim or untone-mapped scene the stripe silently
 * degrades to "slightly brighter green".
 *
 * An emissive map is additive instead of multiplicative, so the stripe is an
 * absolute colour: independent of the season tint, the host's exposure and
 * the scene's lights. It is sampled by the blade's own `uv.x`, which already
 * runs across the blade from margin to margin.
 *
 * @param {object} [options]
 * @param {number} [options.width=64] Texels across the blade.
 * @param {number} [options.halfWidth=0.05] Half-width of the lit core, in uv.
 * @param {number} [options.falloff=0.07] Soft edge either side of the core.
 * @returns {THREE.DataTexture} Caller owns disposal.
 */
export function createMidribEmissiveTexture({
  width = 64,
  halfWidth = 0.05,
  falloff = 0.07,
} = {}) {
  validatePositiveInteger(width, 'width');
  const data = new Uint8Array(width * 4);
  for (let index = 0; index < width; index += 1) {
    const u = (index + 0.5) / width;
    const distance = Math.abs(u - 0.5);
    const edge =
      1 - THREE.MathUtils.smoothstep(distance, halfWidth, halfWidth + falloff);
    const value = Math.round(clamp01(edge) * 255);
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  texture.name = 'Miscanthus_Midrib_Emissive';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/* ==================================================================== *
 * Terminal panicle
 * ==================================================================== */

/**
 * Deterministic layout of one panicle's racemes.
 *
 * The rachis fan, the spikelets and the silky hairs are three separate
 * geometries instanced with the same matrix, so they must agree exactly on
 * where every raceme runs. Sharing this one function is what guarantees that.
 */
function racemeLayout(count) {
  const racemes = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    // The head is close to digitate: photographs of a cut stem show the
    // racemes springing from within a couple of centimetres of each other,
    // like fingers from a palm, rather than spaced up a long central rachis.
    const attachY = THREE.MathUtils.lerp(0.01, 0.15, Math.pow(t, 0.8));
    // The upper racemes are shorter than the lowest, but not by nearly as
    // much as an earlier version assumed — a real head is broad most of the
    // way up rather than tapering to a point.
    const length = THREE.MathUtils.lerp(0.86, 0.58, t);
    const azimuth = index * GOLDEN_ANGLE + fract(index * 0.7548) * 0.35;
    // Angle from the vertical at the point of attachment. Photographs of a
    // freshly emerged head show the racemes thrown out almost to the
    // horizontal in an open, airy whisk, not gathered into a brush.
    const spread =
      THREE.MathUtils.lerp(1.36, 0.86, t) *
      (0.88 + 0.24 * fract(index * 0.61803398875));
    const points = [];
    const steps = 5;
    let x = 0;
    let y = attachY;

    for (let step = 0; step <= steps; step += 1) {
      const s = step / steps;
      // A raceme holds roughly the angle it left the axis at, and only nods
      // near the tip under the weight of its own spikelets. Straightening it
      // back toward vertical along its length — which an earlier version did
      // — gathers the whole head into a narrow bundle.
      const angle = spread * (1 - 0.16 * s) + 0.6 * Math.pow(s, 2.8);
      if (step > 0) {
        const previousS = (step - 1) / steps;
        const previousAngle =
          spread * (1 - 0.16 * previousS) + 0.6 * Math.pow(previousS, 2.8);
        const delta = length / steps;
        x += ((Math.sin(previousAngle) + Math.sin(angle)) / 2) * delta;
        y += ((Math.cos(previousAngle) + Math.cos(angle)) / 2) * delta;
      }
      points.push({ radius: x, y });
    }

    racemes.push({ index, azimuth, attachY, length, points });
  }
  return racemes;
}

function racemePoint(raceme, sample, scaleXZ, scaleY) {
  const count = raceme.points.length - 1;
  const position = THREE.MathUtils.clamp(sample, 0, 1) * count;
  const low = Math.min(Math.floor(position), count - 1);
  const mix = position - low;
  const a = raceme.points[low];
  const b = raceme.points[low + 1];
  const radius = THREE.MathUtils.lerp(a.radius, b.radius, mix) * scaleXZ;
  const y = THREE.MathUtils.lerp(a.y, b.y, mix) * scaleY;
  return new THREE.Vector3(
    Math.cos(raceme.azimuth) * radius,
    y,
    Math.sin(raceme.azimuth) * radius,
  );
}

/**
 * Normalising factors that put the widest raceme tip at radius 0.5 and the
 * highest point at y = 1, so the unit-organ contract holds for any count.
 */
function normalisation(racemes) {
  let maxRadius = 0;
  let maxY = 0;
  for (const raceme of racemes) {
    for (const point of raceme.points) {
      maxRadius = Math.max(maxRadius, point.radius);
      maxY = Math.max(maxY, point.y);
    }
  }
  return {
    scaleXZ: maxRadius > 0 ? 0.5 / maxRadius : 1,
    scaleY: maxY > 0 ? 1 / maxY : 1,
  };
}

/**
 * How wide a raceme card is, as a fraction of the raceme's own length.
 *
 * The plate's hairs span about 56% of the tile's width, and the model's hairs
 * are about 0.05 head-lengths on a raceme of about 0.7 -- so the hair mass is
 * roughly 14% of a raceme's length across, and the card has to be 0.14/0.56
 * wide for the plate to land at that scale. Get this wrong and the head is
 * either a bottlebrush or a bare whisk.
 */
const RACEME_CARD_WIDTH = 0.26;

const HEAD_UP = new THREE.Vector3(0, 1, 0);
const HEAD_SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Build one whole Malepartus head as a fan of textured raceme cards.
 *
 * Unit frame is unchanged from the three meshes this replaces: rooted at y=0,
 * one unit tall, half a unit in radius, so the same instance matrix (X/Z to
 * head width, Y to length) still places it.
 *
 * Each raceme is a **crossed** pair of ribbons following its own curve. Single
 * cards would be the obvious saving, but a head is a fan thrown out in every
 * azimuth at once: whichever way it is seen, a third of its racemes are edge
 * on, and with flat cards those simply vanish. Crossing them doubles a raceme
 * from four triangles to eight and keeps the head a solid feathery mass from
 * any angle, which is the whole reason to draw it.
 *
 * There is no central rachis. The real one is under two centimetres long,
 * buried where fifteen racemes converge, and the culm is already drawn up to
 * it -- it was costing triangles to be invisible.
 *
 * @param {object} [options]
 * @param {number} [options.racemes=15] Finger-like racemes in the fan.
 * @param {number} [options.segments=2] Card segments along each raceme.
 * @param {boolean} [options.crossed=true] Two ribbons per raceme, not one.
 * @param {number} [options.hairSpread=RACEME_CARD_WIDTH] Card width, in
 *   raceme lengths.
 * @returns {THREE.BufferGeometry} Instancing-ready, textured, vertex-coloured.
 */
export function createPanicleGeometry({
  racemes = 15,
  segments = 2,
  crossed = true,
  hairSpread = RACEME_CARD_WIDTH,
} = {}) {
  validatePositiveInteger(racemes, 'racemes');
  validatePositiveInteger(segments, 'segments');
  if (racemes < 3) throw new RangeError('A head needs at least 3 racemes.');
  if (!Number.isFinite(hairSpread) || hairSpread <= 0 || hairSpread > 1) {
    throw new RangeError('hairSpread must be a finite number from 0 to 1.');
  }

  const layout = racemeLayout(racemes);
  const { scaleXZ, scaleY } = normalisation(layout);
  const positions = [];
  const colors = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (const raceme of layout) {
    // The raceme's own length in the normalised frame, which is what the card
    // width is a fraction of.
    const root = racemePoint(raceme, 0, scaleXZ, scaleY);
    const tip = racemePoint(raceme, 1, scaleXZ, scaleY);
    const halfWidth = root.distanceTo(tip) * hairSpread * 0.5;

    const rows = [];
    for (let step = 0; step <= segments; step += 1) {
      const s = step / segments;
      const centre = racemePoint(raceme, s, scaleXZ, scaleY);
      const ahead = racemePoint(raceme, Math.min(1, s + 0.05), scaleXZ, scaleY);
      const behind = racemePoint(
        raceme,
        Math.max(0, s - 0.05),
        scaleXZ,
        scaleY,
      );
      const tangent = ahead.clone().sub(behind);
      if (tangent.lengthSq() < 1e-12) tangent.copy(HEAD_UP);
      tangent.normalize();

      // Two width axes perpendicular to the raceme and to each other. The
      // seed is whichever world axis the raceme is least parallel to, so a
      // near-vertical topmost raceme gets a stable frame like any other.
      const seed = Math.abs(tangent.y) < 0.9 ? HEAD_UP : HEAD_SIDE;
      const axisA = seed.clone().cross(tangent).normalize();
      const axisB = tangent.clone().cross(axisA).normalize();
      rows.push({ centre, axisA, axisB, s });
    }

    const ribbon = (across, facing) => {
      const base = positions.length / 3;
      for (const row of rows) {
        for (const side of [-1, 1]) {
          const point = row.centre
            .clone()
            .addScaledVector(row[across], side * halfWidth);
          positions.push(point.x, point.y, point.z);
          // Neutral: the plate carries the pattern and the instance colour
          // carries the season, from wine-red through silver to winter straw.
          colors.push(1, 1, 1);
          const normal = row[facing];
          normals.push(normal.x, normal.y, normal.z);
          // uv.x across the card, uv.y along the raceme -- which is also the
          // shared leaf wind's bend weight, so a raceme sways from a still
          // attachment to a mobile tip exactly as it should.
          uvs.push((side + 1) / 2, row.s);
        }
      }
      for (let step = 0; step < segments; step += 1) {
        const a = base + step * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };

    ribbon('axisA', 'axisB');
    if (crossed) ribbon('axisB', 'axisA');
  }

  return finishGeometry({
    positions,
    colors,
    indices,
    normals,
    uvs,
    userData: {
      organ: 'panicle',
      racemeCount: racemes,
      crossed,
      segments,
    },
  });
}
