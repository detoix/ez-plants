/**
 * Generate the Lavandula angustifolia 'Hidcote' flower-spike plate.
 *
 * ---------------------------------------------------------------------------
 * Why a plate
 * ---------------------------------------------------------------------------
 * Library rule 9: fuzz is a texture, not geometry. A 'Hidcote' spike is five
 * to nine whorls of two-lipped corollas standing out of a column of woolly
 * calyces -- several hundred parts on a body four centimetres long -- and a
 * mature plant carries a hundred and fifty of them at once. Meshed even
 * coarsely that is tens of thousands of triangles spent on something that is
 * a violet smudge at two metres and sub-pixel fizz beyond it. On one tile it
 * is eight triangles a head, and mipmapping softens it exactly the way the
 * eye does.
 *
 * ---------------------------------------------------------------------------
 * What the tile carries, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * It carries **form**: the interrupted whorls, the woolly calyx column that
 * the whole spike's silhouette actually comes from, and the looser halo of
 * corollas standing out of it. It carries **value** -- calyces dark, corollas
 * bright -- because the paler corollas over a darker column is the one thing
 * that makes a lavender spike read as a lavender spike rather than as a
 * violet bar.
 *
 * It carries almost no **hue**. That belongs to the instance colour, and it
 * has to: the same tile draws the grey-green spike of mid-June, the deep
 * violet of July and the dark, dried head of early August. Bake July into the
 * plate and every other week of the year comes out with a violet cast under it.
 *
 * The one thing the tile cannot be is both smooth and fuzzy. It is drawn in
 * its **open** state, because that is the state the plant is grown for; the
 * model narrows the card before anthesis, which is what carries the slimmer
 * pre-flowering spike. A green spike here is therefore a little softer at the
 * edges than a real one, and that is a declared approximation rather than an
 * oversight.
 *
 *   node scripts/make-spike-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(process.cwd(), 'src/lib/plants/lavender/spike.webp');

/** Whorls up the spike. The cultivar profile's range is 5-9; this is mid. */
const WHORLS = 8;
/** Calyces stamped around one whorl, and corollas standing out of it. */
const CALYCES_PER_WHORL = 17;
const COROLLAS_PER_WHORL = 11;

/**
 * Everything the tile draws sits inside this half-width.
 *
 * The tile is drawn at the spike's own proportions -- a 4 cm head 1.1 cm
 * across is about 3.6 to 1 -- so that the card can be given the model's real
 * width and length without squashing a calyx into a sliver. `SPIKE_PLATE_FILL`
 * in `geometry.js` is this number doubled and must move with it.
 */
const HALF_FILL = 0.135;
/** The solid calyx column, as a share of the full half-width. */
const COLUMN_SHARE = 0.56;

const BASE_V = 0.05;
const TIP_V = 0.96;

/**
 * Where whorl `index` sits along the spike.
 *
 * Not evenly: a lavender spike is *interrupted*, and it is interrupted at the
 * bottom. The lowest one or two whorls stand alone with bare rachis showing
 * between them, and the rest crowd together into the solid head. An evenly
 * spaced spike reads as a ladder, which is the single most common way a
 * rendered lavender goes wrong.
 */
const whorlAt = (index) => 0.04 + 0.93 * Math.pow(index / (WHORLS - 1), 0.94);

// Near-neutral, warm-neutral for the dry parts. Hue comes from the instance.
// Dark and neutral rather than green. The rachis shows only in the gaps
// between the lower whorls, and it is tinted by the spike's own instance
// colour along with everything else on this tile -- so a green stem painted
// here would come out violet in July. Read as the shadow between whorls
// instead, which is most of what it is.
const RACHIS = [0.075, 0.075, 0.07];
const CALYX_DARK = [0.09, 0.085, 0.1];
const CALYX_LIGHT = [0.36, 0.35, 0.38];
const COROLLA = [0.97, 0.96, 1.0];
const COROLLA_EDGE = [0.66, 0.65, 0.72];

const alpha = new Float32Array(SIZE * SIZE);
const red = new Float32Array(SIZE * SIZE);
const green = new Float32Array(SIZE * SIZE);
const blue = new Float32Array(SIZE * SIZE);
const weight = new Float32Array(SIZE * SIZE);

const fract = (value) => value - Math.floor(value);
/** Deterministic unit value: the same plate every run, on every machine. */
const rand = (sequence, salt) => fract((sequence + 1.7) * salt);

/**
 * Stamp one soft elliptical dab.
 *
 * Coverage takes the maximum, so a calyx overlapping another does not read as
 * twice as solid. Colour composites -- source-over, in drawing order --
 * rather than averaging: a weighted mean is right for a mass of hairs that
 * are all the same thing, and wrong here, because it dilutes the one contrast
 * this tile exists to carry. A pale corolla stamped over the dark calyx
 * column has to *cover* it, or a lavender spike comes out as one flat value
 * with no flowers on it. Rachis first, then calyces, then corollas.
 */
function dab(cx, cy, rx, ry, angle, colour, opacity, softness) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const reach = Math.max(rx, ry) * 1.6;
  const x0 = Math.max(0, Math.floor((cx - reach) * SIZE));
  const x1 = Math.min(SIZE - 1, Math.ceil((cx + reach) * SIZE));
  const y0 = Math.max(0, Math.floor((cy - reach) * SIZE));
  const y1 = Math.min(SIZE - 1, Math.ceil((cy + reach) * SIZE));

  for (let py = y0; py <= y1; py += 1) {
    for (let px = x0; px <= x1; px += 1) {
      const dx = (px + 0.5) / SIZE - cx;
      const dy = (py + 0.5) / SIZE - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      const d = Math.hypot(u, v);
      if (d >= 1) continue;
      const cover = Math.pow(1 - d, softness) * opacity;
      if (cover <= 0.002) continue;
      const index = py * SIZE + px;
      if (cover > alpha[index]) alpha[index] = cover;
      const keep = 1 - cover;
      red[index] = red[index] * keep + colour[0] * cover;
      green[index] = green[index] * keep + colour[1] * cover;
      blue[index] = blue[index] * keep + colour[2] * cover;
      weight[index] = 1;
    }
  }
}

/** Half-width of the spike at t (0 = base, 1 = tip). */
function profileAt(t) {
  // A blunt shoulder low down, held nearly parallel, then drawn out to a
  // point. Lavender spikes are cylinders with a cone on top, not spindles.
  const shoulder = Math.pow(Math.min(1, t / 0.12), 0.55);
  const taper = t < 0.66 ? 1 : Math.pow((1 - t) / 0.34, 0.55);
  return HALF_FILL * shoulder * taper;
}

/** Half-height of a whorl, in t, so the rachis knows where it is covered. */
const WHORL_HALF = 0.062;

// The rachis, drawn only where no whorl covers it. Stamping it the whole way
// up and letting the calyces bury it does not work: coverage takes a maximum
// but colour is a weighted mean, so a buried line still tints the bright
// front of every whorl and leaves a seam straight down the head. Where it
// does show -- the gaps between the lower whorls -- is the whole reason a
// lavender spike reads as interrupted rather than as one plug.
for (let step = 0; step <= 1600; step += 1) {
  const t = step / 1600;
  let covered = false;
  for (let whorl = 0; whorl < WHORLS; whorl += 1) {
    if (Math.abs(t - whorlAt(whorl)) < WHORL_HALF) covered = true;
  }
  if (covered) continue;
  const v = BASE_V + (TIP_V - BASE_V) * t;
  dab(0.5, 1 - v, 0.0042, 0.0042, 0, RACHIS, 1, 0.5);
}

let sequence = 0;
for (let whorl = 0; whorl < WHORLS; whorl += 1) {
  const t = whorlAt(whorl);
  const v = BASE_V + (TIP_V - BASE_V) * t;
  const half = profileAt(t);
  const column = half * COLUMN_SHARE;

  for (let index = 0; index < CALYCES_PER_WHORL; index += 1) {
    sequence += 1;
    const spread = (index / (CALYCES_PER_WHORL - 1)) * 2 - 1;
    // Round the band off: a whorl seen flat is a ring, so the calyces at its
    // edges sit slightly lower and are foreshortened.
    const depth = Math.sqrt(Math.max(0, 1 - spread * spread));
    const cx = 0.5 + spread * column * 1.06;
    const cy =
      1 - (v + (rand(sequence, 91.7) - 0.5) * 0.03 - (1 - depth) * 0.012);
    const size = 0.048 + 0.012 * depth + rand(sequence, 41.3) * 0.006;
    // Held low and narrow. The calyces are the dark body of the spike --
    // photographs of the cultivar in flower show a near-black violet column
    // with the pale corollas standing out of it -- so the shading here is a
    // rounding cue, not a value range.
    // The calyces are the dark body of the spike: photographs of the
    // cultivar in flower show a near-black violet column with the pale
    // corollas standing out of it, and the tile has to carry that three-to-one
    // ratio or the instance tint cannot recover it.
    const shade = 0.2 + 0.8 * depth * (0.74 + 0.26 * rand(sequence, 13.9));
    const colour = [
      CALYX_DARK[0] + (CALYX_LIGHT[0] - CALYX_DARK[0]) * shade,
      CALYX_DARK[1] + (CALYX_LIGHT[1] - CALYX_DARK[1]) * shade,
      CALYX_DARK[2] + (CALYX_LIGHT[2] - CALYX_DARK[2]) * shade,
    ];
    // Calyces are narrow tubes standing up against the rachis, so the dab is
    // taller than it is wide and tilts outward with its own position.
    // Wide and overlapping: a lavender calyx column is a tight tube, and
    // dabs that only just touch turn it into a blackberry.
    // Narrow upright tubes rather than round blobs: a calyx is 5 mm long and
    // 1.5 mm across, and dabs that are as wide as they are tall turn the
    // column into a blackberry.
    dab(cx, cy, size * 0.36, size * 0.9, spread * 0.12, colour, 1, 0.5);
  }

  // Corollas: fewer, brighter, standing out beyond the column and angled up.
  // Only a share of a whorl is ever open at once, so they are scattered
  // rather than ringed -- which is also what stops the spike reading as a
  // stack of pom-poms.
  for (let index = 0; index < COROLLAS_PER_WHORL; index += 1) {
    sequence += 1;
    if (rand(sequence, 57.1) < 0.16) continue;
    const spread = (rand(sequence, 23.7) * 2 - 1) * 1.05;
    const out = column + (half - column) * (0.35 + 0.65 * Math.abs(spread));
    const cx =
      0.5 + Math.sign(spread || 1) * out * (0.55 + 0.45 * rand(sequence, 77.3));
    const lift = -0.012 + rand(sequence, 33.1) * 0.062;
    const cy = 1 - (v + lift);
    const size = 0.024 + rand(sequence, 61.7) * 0.014;
    const tilt = Math.sign(spread || 1) * (0.5 + rand(sequence, 19.3) * 0.6);
    dab(cx, cy, size * 0.8, size * 0.62, tilt, COROLLA, 0.96, 0.55);
    // A darker lower lip under each, so a corolla has a body rather than
    // being a bright blob.
    dab(
      cx - Math.sin(tilt) * size * 0.4,
      cy + Math.cos(tilt) * size * 0.4,
      size * 0.56,
      size * 0.4,
      tilt,
      COROLLA_EDGE,
      0.7,
      0.6,
    );
  }
}

// A last few corollas crowning the tip, where the whorls run together.
for (let index = 0; index < 9; index += 1) {
  sequence += 1;
  const t = 0.86 + rand(sequence, 87.1) * 0.12;
  const v = BASE_V + (TIP_V - BASE_V) * t;
  const half = profileAt(t);
  const cx = 0.5 + (rand(sequence, 29.9) * 2 - 1) * half * 0.8;
  dab(
    cx,
    1 - v,
    0.016 + rand(sequence, 44.7) * 0.008,
    0.013,
    (rand(sequence, 66.3) - 0.5) * 1.2,
    COROLLA,
    0.9,
    0.55,
  );
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const encode = (value) => {
  const c = Math.max(0, Math.min(1, value));
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(e * 255);
};

for (let index = 0; index < SIZE * SIZE; index += 1) {
  const cover = Math.min(1, alpha[index]);
  if (cover <= 0.004 || weight[index] <= 0) continue;
  const offset = index * 4;
  rgba[offset] = encode(red[index] / weight[index]);
  rgba[offset + 1] = encode(green[index] / weight[index]);
  rgba[offset + 2] = encode(blue[index] / weight[index]);
  rgba[offset + 3] = Math.round(cover * 255);
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
