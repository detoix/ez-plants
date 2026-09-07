/**
 * Deterministic planting plan for the ornamental bed.
 *
 * Dependency-free on purpose, exactly like `field-terrain-height.js`: this is a
 * numeric contract, and four unrelated consumers read it -- the three plant
 * fields, the mulch and edging geometry, the orbit camera's framing, and the
 * tests. Keep three.js out of this module.
 *
 * ## Why this is not `field-layout.js`
 *
 * The field scatters plants across a shuffled, jittered grid, because it is
 * measuring what a mixed field costs, and a species dealt round-robin to every
 * other cell is exactly right for that. A bed is designed. Its plants stand in
 * drifts -- a group of one species, then a group of the next -- and the drifts
 * step up in height from the path. Dealing three species alternately across a
 * grid would read as a meadow, not as a planting.
 *
 * ## Shape
 *
 * The outline is a closed polar curve with two harmonics, which is enough to
 * give the kidney shape a bed is normally cut to and cheap enough that the
 * mulch, the edging and the point-in-bed test can all evaluate it directly.
 */

/** Mean radius of the bed, in metres. */
export const BED_RADIUS = 1.55;

export const BED_SEED = 20260905;

/**
 * Concentric bands, measured as metres in from the bed's edge.
 *
 * This is how the reference planting is built and it is not the same idea as a
 * drift: the species follow the outline rather than sitting in blobs, so the
 * lavender makes an unbroken skirt at the kerb, the fountain grass a ring
 * behind it, and the hydrangeas hold the middle. Because the camera orbits,
 * "the middle" is the right place for the tallest plant -- there is no front
 * to hide behind.
 *
 * Distance is measured to the outline itself, not to a radius from the origin.
 * On a kidney those are different numbers, and the radius version puts the
 * band boundaries in the wrong place across the notch.
 */
export const BED_BANDS = Object.freeze([
  Object.freeze({ id: 'hydrangea', from: 0.85, to: Infinity }),
  Object.freeze({ id: 'pennisetum', from: 0.42, to: 0.85 }),
  Object.freeze({ id: 'lavender', from: 0.06, to: 0.42 }),
]);

/**
 * Ornamental boulders.
 *
 * They live here, not in `bed-props.js`, because they occupy ground. The band
 * fill rejects candidates against everything already standing, so seeding the
 * occupancy list with the boulders is what stops a lavender growing through
 * one. A prop module that placed its own stones could only hope they missed.
 */
export const BED_BOULDERS = Object.freeze([
  Object.freeze({ x: -1.01, z: 0.07, radius: 0.22, seed: 11 }),
  Object.freeze({ x: 0.97, z: -0.37, radius: 0.19, seed: 37 }),
]);

/**
 * How close two plants may stand, as a fraction of their summed canopy
 * diameters. Below 0.5 the canopies overlap.
 *
 * This is the number that decides whether the bed reads as a planting or as a
 * mulch bed with plants standing in it, and it is worth the arithmetic. Random
 * sequential packing jams at about 0.547 area fraction of the exclusion disks
 * the fill tests against. Those disks have radius `footprint * factor`, while
 * the canopy that actually hides the ground has radius `footprint / 2`, so the
 * ground cover the fill can reach is
 *
 *   0.547 * (0.5 / factor)^2
 *
 * At the 0.58 this module shipped with, that is 41% -- a hard 59%-bare-mulch
 * ceiling that no plant count could get past, which is exactly what the bed
 * looked like. At 0.36 it is 105%: the canopies close over.
 *
 * Overlapping canopies is what the horticultural figure means too. Lavender is
 * planted at 25-35 cm to make an unbroken ribbon, and a five-year-old plant is
 * wider than that on its own.
 */
export const PACKING_FACTOR = 0.36;

/**
 * `footprint` is the canopy diameter the plant carries at the age this page
 * grows it to -- narrower than its mature spread, and the figure `insideBed`,
 * the boulder rejection and `PACKING_FACTOR` all measure against. There is no
 * separate spacing: the centre distance is `PACKING_FACTOR` times the two
 * footprints, so a species cannot have a spacing that disagrees with its own
 * canopy.
 *
 * Heights, for the record: hydrangea 1.85 m, fountain grass 0.86 m,
 * lavender 0.54 m. The bands above are ordered on that.
 */
export const BED_PLANTING = Object.freeze({
  hydrangea: Object.freeze({
    footprint: 0.85,
    scaleRange: Object.freeze([0.88, 1.1]),
  }),
  pennisetum: Object.freeze({
    footprint: 0.36,
    scaleRange: Object.freeze([0.9, 1.08]),
  }),
  lavender: Object.freeze({
    footprint: 0.3,
    scaleRange: Object.freeze([0.92, 1.06]),
  }),
});

/**
 * The candidate lattice, as a fraction of the centre distance it is feeding.
 *
 * The lattice only supplies candidates; the rejection below is what sets the
 * density. Step it at the packing distance and the lattice becomes the binding
 * constraint instead -- the first attempt at a small bed did exactly that and
 * filled 8 m2 with 22 plants, 2.7 per m2, against the 7-9 a closed planting
 * wants.
 */
const CANDIDATE_PITCH = 0.55;

/** Species from the middle outwards. The order the fields are built in. */
export const BED_SPECIES_ORDER = Object.freeze([
  ...new Set(BED_BANDS.map((band) => band.id)),
]);

/**
 * A local mulberry32 rather than an import.
 *
 * `field-layout.js` keeps its own for the same reason this one does: the
 * generator is part of the layout's determinism contract, and sharing one
 * would let an unrelated edit renumber this bed. The tests pin the output.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The polar curve, as coefficients rather than literals.
 *
 * Three consumers read this shape: `bedRadiusAt` below, the centre-of-area
 * integral under it, and the lawn mask in `bed-runtime.js`, which has to
 * evaluate the same curve inside a compute shader. Two of those had the
 * numbers written out by hand until the third arrived; one edit to a literal
 * would have moved the bed out from under its own grass.
 */
export const BED_SHAPE = Object.freeze({
  /** r(theta) = radius * (1 + a*sin(theta + phaseA) + b*sin(2*theta + phaseB)) */
  a: 0.26,
  phaseA: 0.55,
  b: 0.235,
  phaseB: 1.35,
});

/**
 * Bed radius at an angle.
 *
 * The first harmonic swings the mass to one side; the second is what actually
 * makes it a kidney, by pulling one flank in far enough to leave a concave
 * notch. At the amplitudes the first draft used the two harmonics only nudged
 * an ellipse, and the bed read as a circle.
 */
export function bedRadiusAt(theta, radius = BED_RADIUS) {
  const { a, phaseA, b, phaseB } = BED_SHAPE;
  return (
    radius *
    (1 + a * Math.sin(theta + phaseA) + b * Math.sin(2 * theta + phaseB))
  );
}

/**
 * The polar curve's own centre of area, as a fraction of the radius.
 *
 * The harmonics that make the kidney a kidney also push its mass off the
 * origin -- by two thirds of a metre at the shipped radius. Left uncorrected
 * that offset lands in three places at once: the deep core the hydrangeas fill
 * drifts to one flank, the orbit camera frames a bed that is not where it is
 * pointing, and the mulch is wider on one side than the other. Subtracting it
 * costs one constant.
 */
export const CENTRE_FRACTION = (() => {
  const samples = 720;
  let area = 0;
  let x = 0;
  let z = 0;
  for (let index = 0; index < samples; index += 1) {
    const t0 = (index / samples) * Math.PI * 2;
    const t1 = ((index + 1) / samples) * Math.PI * 2;
    const r0 = bedRadiusAt(t0, 1);
    const r1 = bedRadiusAt(t1, 1);
    const x0 = Math.cos(t0) * r0;
    const z0 = Math.sin(t0) * r0;
    const x1 = Math.cos(t1) * r1;
    const z1 = Math.sin(t1) * r1;
    const cross = x0 * z1 - x1 * z0;
    area += cross;
    x += (x0 + x1) * cross;
    z += (z0 + z1) * cross;
  }
  area /= 2;
  return { x: x / (6 * area), z: z / (6 * area) };
})();

/** Closed outline polygon in XZ, centred on its own area. */
export function bedOutline(samples = 96, radius = BED_RADIUS) {
  return Array.from({ length: samples }, (_, index) => {
    const theta = (index / samples) * Math.PI * 2;
    const r = bedRadiusAt(theta, radius);
    return [
      Math.cos(theta) * r - CENTRE_FRACTION.x * radius,
      Math.sin(theta) * r - CENTRE_FRACTION.z * radius,
    ];
  });
}

/**
 * The outline, cached per radius.
 *
 * Every band test and every rejection walks it, so building it once matters;
 * a bed is only ever laid out for one or two radii in a session.
 */
const outlineCache = new Map();

function outlineFor(radius) {
  let cached = outlineCache.get(radius);
  if (!cached) {
    cached = bedOutline(240, radius);
    outlineCache.set(radius, cached);
  }
  return cached;
}

function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToOutline(x, z, polygon) {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const dx = xi - xj;
    const dz = zi - zj;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared > 0
        ? Math.min(1, Math.max(0, ((x - xj) * dx + (z - zj) * dz) / lengthSquared))
        : 0;
    const px = xj + t * dx;
    const pz = zj + t * dz;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * How far inside the mulch a point lies, in metres. Negative outside.
 *
 * Measured to the outline polygon, not to the polar radius. On a kidney those
 * two disagree by most of a metre across the notch, which is exactly where the
 * bands would otherwise land in the wrong place.
 */
export function depthInBed(x, z, radius = BED_RADIUS) {
  const polygon = outlineFor(radius);
  const distance = distanceToOutline(x, z, polygon);
  return pointInPolygon(x, z, polygon) ? distance : -distance;
}

/**
 * Does a lawn blade survive at this point? The scalar twin of the compute
 * shader's mask in `bed-lawn-mask.js`.
 *
 * Written without a single trig call, because the shader form has to run over
 * 1.1 million grass candidates every frame. Normalizing the vector gives
 * `sin(theta)` and `cos(theta)` directly, and the two harmonics then come out
 * of the angle-sum identities:
 *
 *   sin(theta + p)      = sin*cos(p) + cos*sin(p)
 *   sin(2*theta + p)    = (2*sin*cos)*cos(p) + (1 - 2*sin^2)*sin(p)
 *
 * `test/bed-lawn-mask.test.js` pins this against the polygon test, which is
 * the thing it is allowed to disagree with only inside a tolerance.
 */
export function bedKeepsLawnAt(x, z, margin = 0, radius = BED_RADIUS) {
  const qx = x + CENTRE_FRACTION.x * radius;
  const qz = z + CENTRE_FRACTION.z * radius;
  const length = Math.hypot(qx, qz);
  if (length < 1e-4) return false;
  const cos = qx / length;
  const sin = qz / length;
  const { a, phaseA, b, phaseB } = BED_SHAPE;
  const first = sin * Math.cos(phaseA) + cos * Math.sin(phaseA);
  const second =
    2 * sin * cos * Math.cos(phaseB) + (1 - 2 * sin * sin) * Math.sin(phaseB);
  return length > radius * (1 + a * first + b * second) + margin;
}

/** Is a point inside the bed, leaving `margin` metres of mulch around it? */
export function insideBed(x, z, margin = 0, radius = BED_RADIUS) {
  return depthInBed(x, z, radius) >= margin;
}

/**
 * Build the bed's placements.
 *
 * Bands are filled biggest species first, so the hydrangeas claim the middle
 * cleanly and the smaller plants pack around what is already standing rather
 * than the other way round. Every candidate is rejected against everything
 * already placed, boulders included, which is what lets the fill run dense
 * enough to leave no bare mulch without plants growing through each other.
 *
 * @param {object} [options]
 * @param {number} [options.radius]
 * @param {number} [options.seed]
 * @param {(x: number, z: number) => number} options.groundAt Terrain height.
 * @returns {{species: object[], outline: number[][], plantCount: number}}
 */
export function createBedLayout({
  radius = BED_RADIUS,
  seed = BED_SEED,
  groundAt,
} = {}) {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError('Bed radius must be a positive finite number.');
  }
  if (typeof groundAt !== 'function') {
    throw new TypeError('The bed layout needs a terrain height function.');
  }

  const random = mulberry32(seed);
  const polygon = outlineFor(radius);
  // Seeded with the boulders, so the first band already knows they are there.
  const placed = BED_BOULDERS.map((boulder) => ({
    x: boulder.x,
    z: boulder.z,
    footprint: boulder.radius,
  }));
  const bySpecies = new Map(
    BED_SPECIES_ORDER.map((id) => [id, { id, placements: [] }]),
  );

  let extent = 0;
  for (const [x, z] of polygon) {
    extent = Math.max(extent, Math.abs(x), Math.abs(z));
  }

  for (const band of BED_BANDS) {
    const planting = BED_PLANTING[band.id];
    if (!planting) throw new RangeError(`No planting rule for ${band.id}.`);
    const [minScale, maxScale] = planting.scaleRange;
    const step = planting.footprint * 2 * PACKING_FACTOR * CANDIDATE_PITCH;
    // A staggered lattice over the whole bed, filtered to the band. Offsetting
    // every other row by half a step is what makes a filled band look grown
    // rather than ruled, before any jitter is applied.
    const rows = Math.ceil((extent * 2) / (step * 0.87)) + 2;
    const columns = Math.ceil((extent * 2) / step) + 2;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const offset = row % 2 === 0 ? 0 : step / 2;
        const x =
          -extent + column * step + offset + (random() - 0.5) * step * 0.34;
        const z =
          -extent + row * step * 0.87 + (random() - 0.5) * step * 0.34;

        const depth = depthInBed(x, z, radius);
        if (depth < band.from || depth >= band.to) continue;

        let clear = true;
        for (const other of placed) {
          const minimum = (planting.footprint + other.footprint) * PACKING_FACTOR;
          if ((x - other.x) ** 2 + (z - other.z) ** 2 < minimum ** 2) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;

        const y = groundAt(x, z);
        if (!Number.isFinite(y)) {
          throw new RangeError(`Terrain height is not finite at (${x}, ${z}).`);
        }
        placed.push({ x, z, footprint: planting.footprint });
        bySpecies.get(band.id).placements.push({
          position: [x, y, z],
          rotationY: random() * Math.PI * 2,
          scale: minScale + random() * (maxScale - minScale),
        });
      }
    }
  }

  const species = BED_SPECIES_ORDER.map((id) => bySpecies.get(id));
  for (const entry of species) {
    if (entry.placements.length === 0) {
      throw new RangeError(`The bed layout placed no ${entry.id}.`);
    }
  }

  return {
    species,
    radius,
    outline: bedOutline(96, radius),
    boulders: BED_BOULDERS,
    plantCount: placed.length - BED_BOULDERS.length,
  };
}
