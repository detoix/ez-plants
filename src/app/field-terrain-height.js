/**
 * Dependency-free scalar definition of the field surface.
 *
 * Keep this module free of three.js objects. The terrain mesh, plant scatter,
 * walker and GPU height bake all read this same numeric contract.
 */

/** Metres from the origin at which the displacement has faded to nothing. */
const TERRAIN_RADIUS = 120;
/** Where the fade starts. Between here and TERRAIN_RADIUS the hills flatten. */
const TERRAIN_FADE_FROM = 78;
/** Mathematical height limit before the user-controlled amplitude is applied. */
const TERRAIN_HEIGHT_LIMIT = 1.21;

export function terrainHeightBounds(amplitude = 1.15) {
  const extent = Math.abs(amplitude) * TERRAIN_HEIGHT_LIMIT;
  return Object.freeze({
    minimum: -extent,
    maximum: extent,
    span: extent * 2,
  });
}

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Value noise with a smoothstep interpolant: cheap, and C1 enough for normals. */
function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (
    a * (1 - ux) * (1 - uz) +
    b * ux * (1 - uz) +
    c * (1 - ux) * uz +
    d * ux * uz
  );
}

/** Four deliberately shallow octaves: a garden lawn, not a moor. */
function fbm(x, z) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, 1013 + octave);
    norm += amplitude;
    amplitude *= 0.48;
    frequency *= 2.07;
  }
  return sum / norm;
}

function smoothstep(value, minimum, maximum) {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const x = (value - minimum) / (maximum - minimum);
  return x * x * (3 - 2 * x);
}

/**
 * Ground height in metres at a world XZ.
 *
 * Zero outside `TERRAIN_RADIUS`, so the displaced middle meets the flat
 * backdrop plane without a step to fall off.
 */
export function terrainHeightAt(x, z, options = {}) {
  const amplitude = options.amplitude ?? 1.15;
  if (amplitude === 0) return 0;
  const distance = Math.hypot(x, z);
  if (distance >= TERRAIN_RADIUS) return 0;
  const fade =
    distance <= TERRAIN_FADE_FROM
      ? 1
      : 1 - smoothstep(distance, TERRAIN_FADE_FROM, TERRAIN_RADIUS);
  // Two bands: broad mounds you walk over, and a finer roll that keeps a
  // 4 cm blade from standing on what is effectively a plane.
  const broad = fbm(x * 0.017, z * 0.017) - 0.5;
  const fine = fbm(x * 0.062 + 11.3, z * 0.062 - 4.7) - 0.5;
  return (broad * 2.0 + fine * 0.42) * amplitude * fade;
}
