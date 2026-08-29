/**
 * Generate the Miscanthus sinensis 'Malepartus' raceme plate.
 *
 * Same pipeline as the leaf and floret plates: a project asset drawn from
 * botanical references and baked to a WebP so the plant folder stays portable.
 *
 * ---------------------------------------------------------------------------
 * Why a plate at all
 * ---------------------------------------------------------------------------
 * The ornamental display of a Miscanthus head is silky hair. The previous
 * model drew it as geometry — 1,260 single-triangle hairs per head, 1,428
 * triangles, and another 1,428 for the spikelets buried underneath them —
 * which came to 145,656 triangles of hair and flower across a mature clump,
 * against a library budget of 25,000 for the entire plant.
 *
 * Hair is the worst possible case for geometry and the best possible case for
 * alpha. A hair is under a millimetre across: as a triangle it is sub-pixel at
 * any sane viewing distance, so it aliases into a crawling sparkle and costs a
 * triangle to do it. As a texel it is exactly what mipmapping is for, and
 * minifies into the soft haze a real plume actually reads as.
 *
 * So one tile holds one whole raceme — axis, paired spikelets and the hair
 * tufts along it — and the head is built from about fifteen crossed cards, one
 * per raceme, for 120 triangles instead of 3,620.
 *
 * ---------------------------------------------------------------------------
 * Morphology, per the cultivar sources
 * ---------------------------------------------------------------------------
 * Racemes are finger-like and near-digitate, thrown out almost to the
 * horizontal in an open, airy whisk. Spikelets are paired at each node — one
 * sessile, one pedicelled, the arrangement across the whole Andropogoneae
 * tribe — and each sits in a tuft of long hairs angled forward toward the
 * raceme's tip.
 *
 * The plate is deliberately near-neutral. 'Malepartus' runs wine-red through
 * coppery to silver and then to winter straw, and that whole sequence arrives
 * as a per-instance colour multiplied over these pixels. What the plate
 * carries is *form*: the axis, the spikelet bodies, and the hair.
 *
 *   node scripts/make-raceme-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(process.cwd(), 'src/lib/plants/miscanthus/raceme.webp');

/** Spikelet-bearing nodes along the raceme, base to tip. */
const NODES = 17;
/** Hairs drawn at each node. */
const HAIRS_PER_NODE = 26;

// Near-neutral. Every trace of hue belongs to the instance colour, or a winter
// straw head would keep a coppery cast from its own plate.
const AXIS_COLOUR = [0.72, 0.69, 0.56];
const SPIKELET_COLOUR = [0.82, 0.7, 0.66];
const HAIR_BASE_COLOUR = [0.86, 0.84, 0.81];
const HAIR_TIP_COLOUR = [1.0, 1.0, 1.0];

function fract(value) {
  return value - Math.floor(value);
}

/** Deterministic unit value from an integer sequence. */
function rand(sequence, salt) {
  return fract((sequence + 1) * salt);
}

const alpha = new Float32Array(SIZE * SIZE);
const red = new Float32Array(SIZE * SIZE);
const green = new Float32Array(SIZE * SIZE);
const blue = new Float32Array(SIZE * SIZE);
const weight = new Float32Array(SIZE * SIZE);

/**
 * Stamp one soft round dab.
 *
 * Coverage takes the maximum rather than a sum, so a hair crossing another
 * hair does not read as twice as solid; colour is a weighted mean, so a pale
 * tip laid over a darker axis blends instead of replacing it.
 */
function stamp(u, v, radius, colour, opacity) {
  const px = u * SIZE;
  const py = (1 - v) * SIZE;
  const r = radius * SIZE;
  const x0 = Math.max(0, Math.floor(px - r));
  const x1 = Math.min(SIZE - 1, Math.ceil(px + r));
  const y0 = Math.max(0, Math.floor(py - r));
  const y1 = Math.min(SIZE - 1, Math.ceil(py + r));

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - px;
      const dy = y + 0.5 - py;
      const distance = Math.hypot(dx, dy) / r;
      if (distance >= 1) continue;
      // Smoothstep falloff, so the alpha edge is antialiased rather than
      // stair-stepped once the plate is minified.
      const soft = 1 - distance * distance;
      const w = soft * soft * opacity;
      const index = y * SIZE + x;
      if (w > alpha[index]) alpha[index] = w;
      red[index] += colour[0] * w;
      green[index] += colour[1] * w;
      blue[index] += colour[2] * w;
      weight[index] += w;
    }
  }
}

/** Stamp a tapered stroke from (u0,v0) to (u1,v1). */
function stroke(u0, v0, u1, v1, radius0, radius1, colour0, colour1, opacity) {
  const length = Math.hypot((u1 - u0) * SIZE, (v1 - v0) * SIZE);
  const steps = Math.max(2, Math.ceil(length / 1.5));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    stamp(
      u0 + (u1 - u0) * t,
      v0 + (v1 - v0) * t,
      radius0 + (radius1 - radius0) * t,
      [
        colour0[0] + (colour1[0] - colour0[0]) * t,
        colour0[1] + (colour1[1] - colour0[1]) * t,
        colour0[2] + (colour1[2] - colour0[2]) * t,
      ],
      opacity,
    );
  }
}

// ---------------------------------------------------------------------------
// The raceme axis. Slightly off-vertical so a crossed pair of cards does not
// read as a perfect cross when seen from directly above.
// ---------------------------------------------------------------------------
const AXIS_BASE_U = 0.5;
const AXIS_TIP_U = 0.545;
const axisU = (v) =>
  AXIS_BASE_U + (AXIS_TIP_U - AXIS_BASE_U) * Math.pow(v, 1.3);

stroke(
  axisU(0.02),
  0.02,
  axisU(0.99),
  0.99,
  0.009,
  0.0028,
  AXIS_COLOUR,
  [0.86, 0.82, 0.68],
  1,
);

// ---------------------------------------------------------------------------
// Hair tufts first, then spikelets over them: the spikelet bodies sit at the
// node and the hairs spring from around their bases, so the flower reads as
// nested inside its own tuft rather than pasted on top of it.
// ---------------------------------------------------------------------------
for (let node = 0; node < NODES; node += 1) {
  const t = node / (NODES - 1);
  const v = 0.07 + 0.9 * t;
  const u = axisU(v);
  // Hairs shorten a little toward the tip, as the raceme itself narrows.
  const reach = 0.3 * (1 - 0.32 * t);

  for (let hair = 0; hair < HAIRS_PER_NODE; hair += 1) {
    const sequence = node * 131 + hair * 17;
    // Angle measured from the raceme's own tip direction. Hairs sweep forward
    // rather than standing square to the axis, which is what makes a plume
    // look combed toward its tip instead of like a bottlebrush.
    const side = hair % 2 === 0 ? 1 : -1;
    const spread =
      0.34 + 1.05 * rand(sequence, 0.7548776662) * rand(sequence, 0.618034);
    const angle = side * spread;
    const length = reach * (0.45 + 0.62 * rand(sequence, 0.3819660113));
    // A hair is not straight: it bows away from the axis under its own weight.
    const bow = 0.16 * rand(sequence, 0.569840291) * side;
    const midU = u + Math.sin(angle) * length * 0.5 + bow * length * 0.5;
    const midV = v + Math.cos(angle) * length * 0.5;
    const tipU = u + Math.sin(angle) * length;
    const tipV = v + Math.cos(angle) * length;

    // Kept high on purpose. A hair drawn faint is a hair the alpha test
    // deletes, and the hairs it deletes first are the pale outer tips -- so a
    // low-opacity fringe does not soften the plume, it strips it back to a
    // dark spiky core and leaves the head reading as a bottlebrush.
    const opacity = 0.82 + 0.18 * rand(sequence, 0.8191725134);
    stroke(
      u,
      v,
      midU,
      midV,
      0.0044,
      0.0034,
      HAIR_BASE_COLOUR,
      [0.93, 0.92, 0.9],
      opacity,
    );
    stroke(
      midU,
      midV,
      tipU,
      tipV,
      0.0034,
      0.0018,
      [0.93, 0.92, 0.9],
      HAIR_TIP_COLOUR,
      opacity,
    );
  }
}

for (let node = 0; node < NODES; node += 1) {
  const t = node / (NODES - 1);
  const v = 0.07 + 0.9 * t;
  const u = axisU(v);
  const size = 0.026 * (1 - 0.3 * t);

  // One sessile and one pedicelled spikelet at every node.
  for (const pedicel of [0, 1]) {
    const lean = pedicel ? 0.34 : -0.22;
    const offset = pedicel ? 0.016 : 0.004;
    stroke(
      u + offset * Math.sign(lean),
      v,
      u + offset * Math.sign(lean) + Math.sin(lean) * size,
      v + Math.cos(lean) * size,
      0.0065,
      0.0022,
      SPIKELET_COLOUR,
      [0.94, 0.88, 0.86],
      1,
    );
  }
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const encode = (value) => {
  const c = Math.max(0, Math.min(1, value));
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(e * 255);
};

for (let index = 0; index < SIZE * SIZE; index += 1) {
  const a = alpha[index];
  if (a <= 0) continue;
  const w = weight[index] || 1;
  const offset = index * 4;
  rgba[offset] = encode(red[index] / w);
  rgba[offset + 1] = encode(green[index] / w);
  rgba[offset + 2] = encode(blue[index] / w);
  rgba[offset + 3] = Math.round(Math.min(1, a) * 255);
}

const encoded = spawnSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pixel_format',
    'rgba',
    '-video_size',
    `${SIZE}x${SIZE}`,
    '-framerate',
    '1',
    '-i',
    'pipe:0',
    '-c:v',
    'libwebp',
    '-preset',
    'picture',
    '-quality',
    '86',
    '-compression_level',
    '6',
    '-frames:v',
    '1',
    OUT,
  ],
  { input: rgba, stdio: ['pipe', 'inherit', 'inherit'] },
);
if (encoded.error) {
  throw new Error(`Unable to run ffmpeg: ${encoded.error.message}`, {
    cause: encoded.error,
  });
}
if (encoded.status !== 0) {
  throw new Error(`ffmpeg failed with status ${encoded.status ?? 'unknown'}`);
}
console.log(
  `wrote ${OUT} (${SIZE}x${SIZE}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`,
);
