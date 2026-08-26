import * as THREE from 'three';

import {
  appendTaperedTube,
  createOrganBuffers,
  finishGeometry,
  fract,
  GOLDEN_ANGLE,
  heightUVs,
  pushOrganVertex,
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

const RACHIS_BASE = new THREE.Color(0.52, 0.5, 0.36);
const RACHIS_TIP = new THREE.Color(0.86, 0.8, 0.62);
const SPIKELET_BODY = new THREE.Color(0.72, 0.6, 0.58);
const SPIKELET_TIP = new THREE.Color(0.94, 0.88, 0.86);
const HAIR_BASE = new THREE.Color(0.66, 0.58, 0.56);
const HAIR_TIP = new THREE.Color(1.0, 1.0, 1.0);

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

/**
 * The three baked blade curvatures, from the short erect flag leaf under a
 * panicle to the long recurved blades low on a culm. A model snaps each
 * blade to one of these so its predicted reach matches what is drawn.
 */
export const BLADE_ARCH_VARIANTS = Object.freeze([0.32, 0.62, 0.9]);

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
 * This runs the same integration `createBladeGeometry` uses, so a growth
 * model can predict a blade's reach — for the plant's spread, for a camera
 * frame — without building the geometry, and cannot drift away from what is
 * actually drawn.
 *
 * @param {number} arch Same 0..1.4 value passed to `createBladeGeometry`.
 * @param {number} [segments=22] Same sampling as the geometry.
 * @returns {{along: number, across: number}} Tip offset per unit blade length,
 *   `along` in the blade's emergence direction and `across` in its arch.
 */
export function bladeTipOffset(arch, segments = 22) {
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
 * @returns {THREE.BufferGeometry} Instancing-ready blade with UVs for wind.
 */
export function createBladeGeometry({
  arch = 0.6,
  twist = 0.5,
  widthRatio = 0.028,
  keel = 0.16,
  segments = 22,
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
  // Five columns: two margins, two lamina, one midrib. That is the smallest
  // strip that can show a distinct midrib stripe and a shaded margin.
  // The inner pair sits close to the centre so the pale midrib band stays a
  // fine line. Spacing them evenly across the blade — as an earlier version
  // did — brightened half its width and made it read as a variegated
  // cultivar rather than 'Malepartus'.
  const columns = [-0.5, -0.14, 0, 0.14, 0.5];
  const columnColour = [
    BLADE_MARGIN,
    BLADE_LAMINA,
    BLADE_MIDRIB,
    BLADE_LAMINA,
    BLADE_MARGIN,
  ];
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

    for (let column = 0; column < columns.length; column += 1) {
      const across = columns[column] * halfWidth * 2;
      const lift = keelDepth * (1 - Math.abs(columns[column]) / 0.5);
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
      uvs.push(columns[column] + 0.5, s);
      row.push(positions.length / 3 - 1);
    }
    rows.push(row);
  }

  for (let index = 0; index < segments; index += 1) {
    for (let column = 0; column < columns.length - 1; column += 1) {
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
 * Build the rachis and raceme skeleton of one whole panicle.
 *
 * Unlike a hydrangea head, a Miscanthus panicle's own branches are visible
 * all winter once the hairs have blown away, so they are real tapered tubes
 * rather than a hidden support.
 *
 * @param {object} [options]
 * @param {number} [options.racemes=15] Finger-like racemes in the fan.
 * @param {number} [options.sides=4] Polygon sides per tube.
 * @returns {THREE.BufferGeometry} Normalized, vertex-coloured fan geometry.
 */
export function createRacemeFanGeometry({ racemes = 15, sides = 4 } = {}) {
  validatePositiveInteger(racemes, 'racemes');
  validatePositiveInteger(sides, 'sides');
  if (racemes < 3 || sides < 3) {
    throw new RangeError('A raceme fan needs at least 3 racemes and 3 sides.');
  }

  const layout = racemeLayout(racemes);
  const { scaleXZ, scaleY } = normalisation(layout);
  const buffers = createOrganBuffers();
  const topAttach = Math.max(...layout.map((raceme) => raceme.attachY));

  appendTaperedTube(buffers, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(0, topAttach * scaleY, 0),
    startRadius: 0.016,
    endRadius: 0.007,
    sides,
    startColour: RACHIS_BASE,
    endColour: RACHIS_BASE.clone().lerp(RACHIS_TIP, 0.4),
    capStart: true,
    capEnd: true,
  });

  for (const raceme of layout) {
    const steps = raceme.points.length - 1;
    for (let step = 0; step < steps; step += 1) {
      const from = step / steps;
      const to = (step + 1) / steps;
      appendTaperedTube(buffers, {
        start: racemePoint(raceme, from, scaleXZ, scaleY),
        end: racemePoint(raceme, to, scaleXZ, scaleY),
        startRadius: THREE.MathUtils.lerp(0.008, 0.0022, from),
        endRadius: THREE.MathUtils.lerp(0.008, 0.0022, to),
        sides,
        startColour: RACHIS_BASE.clone().lerp(RACHIS_TIP, from),
        endColour: RACHIS_BASE.clone().lerp(RACHIS_TIP, to),
        capEnd: step === steps - 1,
      });
    }
  }

  return finishGeometry({
    ...buffers,
    uvs: heightUVs(buffers.positions),
    userData: { organ: 'raceme-fan', racemeCount: racemes },
  });
}

/**
 * Build the paired spikelets carried along every raceme.
 *
 * These are the actual flowers. They are small, and in a fluffed head they
 * are almost hidden by their own hairs, but they carry the wine-red that
 * makes a fresh 'Malepartus' head coppery rather than white.
 *
 * @param {object} [options]
 * @param {number} [options.racemes=15] Must match the fan geometry.
 * @param {number} [options.perRaceme=7] Spikelet pairs sampled per raceme.
 * @returns {THREE.BufferGeometry} Normalized, vertex-coloured spikelet mass.
 */
export function createSpikeletGeometry({ racemes = 15, perRaceme = 7 } = {}) {
  validatePositiveInteger(racemes, 'racemes');
  validatePositiveInteger(perRaceme, 'perRaceme');

  const layout = racemeLayout(racemes);
  const { scaleXZ, scaleY } = normalisation(layout);
  const buffers = createOrganBuffers();
  let spikeletCount = 0;

  for (const raceme of layout) {
    for (let index = 0; index < perRaceme; index += 1) {
      const sample = 0.16 + (index / perRaceme) * 0.82;
      const centre = racemePoint(raceme, sample, scaleXZ, scaleY);
      const ahead = racemePoint(
        raceme,
        Math.min(1, sample + 0.04),
        scaleXZ,
        scaleY,
      );
      const along = ahead.clone().sub(centre);
      if (along.lengthSq() < 1e-12) along.set(0, 1, 0);
      along.normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(along).normalize();
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);

      // One sessile and one pedicelled spikelet at each node, which is the
      // arrangement across the whole Andropogoneae tribe.
      for (const pedicel of [0, 1]) {
        const offset = centre
          .clone()
          .addScaledVector(side, (pedicel ? 1 : -1) * 0.004)
          .addScaledVector(along, pedicel * 0.012);
        appendTaperedTube(buffers, {
          start: offset,
          end: offset.clone().addScaledVector(along, 0.02),
          startRadius: 0.0035,
          endRadius: 0.0012,
          // Three sides and no caps: at 5 mm inside a fluffed head these are
          // a colour cue, and every extra face is paid for 50 times over in
          // a mature clump.
          sides: 3,
          startColour: SPIKELET_BODY,
          endColour: SPIKELET_TIP,
          capEnd: false,
        });
        spikeletCount += 1;
      }
    }
  }

  return finishGeometry({
    ...buffers,
    uvs: heightUVs(buffers.positions),
    userData: {
      organ: 'spikelets',
      racemeCount: racemes,
      representativeSpikeletCount: spikeletCount,
    },
  });
}

/**
 * Build the silky hair mass that is the actual ornamental display.
 *
 * Each spikelet sits in a tuft of long hairs; collectively they are what
 * catches low autumn light and what turns the head from coppery to silver.
 * Rendering them as thin tapered blades rather than as a texture keeps the
 * head readable in silhouette against a winter sky.
 *
 * @param {object} [options]
 * @param {number} [options.racemes=15] Must match the fan geometry.
 * @param {number} [options.perRaceme=12] Tuft sites per raceme.
 * @param {number} [options.hairsPerTuft=7] Hairs drawn at each site.
 * @returns {THREE.BufferGeometry} Normalized, vertex-coloured hair mass.
 */
export function createPlumeGeometry({
  racemes = 15,
  perRaceme = 12,
  hairsPerTuft = 7,
} = {}) {
  validatePositiveInteger(racemes, 'racemes');
  validatePositiveInteger(perRaceme, 'perRaceme');
  validatePositiveInteger(hairsPerTuft, 'hairsPerTuft');

  const layout = racemeLayout(racemes);
  const { scaleXZ, scaleY } = normalisation(layout);
  const buffers = createOrganBuffers();
  const { indices } = buffers;
  let hairCount = 0;

  for (const raceme of layout) {
    for (let index = 0; index < perRaceme; index += 1) {
      const sample = 0.16 + (index / perRaceme) * 0.82;
      const centre = racemePoint(raceme, sample, scaleXZ, scaleY);
      const ahead = racemePoint(
        raceme,
        Math.min(1, sample + 0.04),
        scaleXZ,
        scaleY,
      );
      const along = ahead.clone().sub(centre);
      if (along.lengthSq() < 1e-12) along.set(0, 1, 0);
      along.normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(along).normalize();
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      const up = along.clone().cross(side).normalize();

      for (let hair = 0; hair < hairsPerTuft; hair += 1) {
        const sequence = raceme.index * 97 + index * 31 + hair * 13;
        const around =
          (hair / hairsPerTuft) * Math.PI * 2 +
          fract(sequence * 0.618034) * 1.4;
        const splay = 0.5 + 0.55 * fract(sequence * 0.7548);
        const direction = along
          .clone()
          .addScaledVector(side, Math.cos(around) * splay)
          .addScaledVector(up, Math.sin(around) * splay)
          .normalize();
        const length = 0.05 * (0.72 + 0.5 * fract(sequence * 0.3247));
        const tip = centre.clone().addScaledVector(direction, length);
        // The hair is a single tapered ribbon; its flat face is turned toward
        // the tuft's own axis so a tuft reads as volume, not as a fan.
        const across = direction.clone().cross(up).normalize();
        if (across.lengthSq() < 1e-6) across.copy(side);
        const halfWidth = length * 0.075;

        const a = pushOrganVertex(
          buffers,
          centre.clone().addScaledVector(across, -halfWidth),
          HAIR_BASE,
        );
        const b = pushOrganVertex(
          buffers,
          centre.clone().addScaledVector(across, halfWidth),
          HAIR_BASE,
        );
        const c = pushOrganVertex(buffers, tip, HAIR_TIP);
        indices.push(a, b, c);
        hairCount += 1;
      }
    }
  }

  return finishGeometry({
    ...buffers,
    uvs: heightUVs(buffers.positions),
    userData: {
      organ: 'plume-hairs',
      racemeCount: racemes,
      representativeHairCount: hairCount,
    },
  });
}
