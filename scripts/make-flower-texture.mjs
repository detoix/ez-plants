/**
 * Generate the Forsythia x intermedia 'Lynwood' corolla plate.
 *
 * Same pipeline as the leaf and floret plates: a project asset drawn from
 * botanical references and baked to a WebP so the plant folder stays portable.
 *
 * ---------------------------------------------------------------------------
 * Why a plate at all
 * ---------------------------------------------------------------------------
 * A forsythia's cost is its flowers, and there is no thinning them: the display
 * IS the cultivar, and the reference photographs show every leaf-scar carrying
 * three to six corollas along the whole length of every cane. The meshed
 * corolla spent 66 triangles on four lobes and a floored tube, so 2,895 of them
 * came to 191,070 -- seven times the entire band-0 budget, for a flower 3.5 cm
 * across.
 *
 * What a corolla actually is, is a flat four-armed yellow star with wide gaps
 * between the arms. That is the best case for alpha and the worst case for
 * triangles, exactly as rule 9 says of dense small florets. As a plate it is
 * two triangles, so the same budget buys nearly twice the flowers the meshed
 * version could, which is what the photographs demand.
 *
 * ---------------------------------------------------------------------------
 * Morphology, per Bean and the cultivar description
 * ---------------------------------------------------------------------------
 * A corolla to 4 cm across, four deeply divided oblong lobes -- "often revolute
 * and twisted" -- on a short tube, with 'Lynwood Variety' carrying broader,
 * less curled and lighter lobes than its 'Spectabilis' parent.
 *
 * The lobes are drawn as straps, narrowed where they leave the throat, broadest
 * through the middle and rounded off at the tip. They are NOT at a clean 90
 * degrees to each other and are NOT the same length: a stamped cross is the one
 * artefact a single-tile flower must avoid, because every card on the plant is
 * cut from this one image and the eye finds a repeated symmetry instantly.
 *
 * The yellow is baked in rather than left near-neutral the way the hydrangea
 * floret plate is. A hydrangea runs lime to rose across one season and needs
 * the hue to arrive per instance; forsythia is yellow for the fortnight it
 * flowers and then stops, so the per-instance colour is left to carry only the
 * flower-to-flower variation and the fade.
 *
 *   node scripts/make-flower-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(process.cwd(), 'src/lib/plants/forsythia/flower.webp');

/**
 * The four lobes, as [angle, reach, halfWidth, curve].
 *
 * Angles are deliberately off the quadrants and reaches deliberately unequal.
 * `curve` sweeps the lobe sideways along its own length, standing in for the
 * twist that keeps a real corolla from lying in one plane.
 *
 * Every tip stays inside the tile: a lobe running off the edge is cut by the
 * tile border, and a card whose alpha ends in a straight line stops being a
 * flower and becomes a visible flat plate.
 */
const LOBES = [
  [0.06, 0.462, 0.086, 0.12],
  [1.66, 0.418, 0.092, -0.16],
  [3.21, 0.47, 0.083, 0.07],
  [4.83, 0.386, 0.09, -0.1],
];

/** Where the lobes leave the throat, and how far the amber eye reaches. */
const THROAT_RADIUS = 0.046;
const EYE_RADIUS = 0.19;

/**
 * Photo-calibrated: a clear golden yellow, lighter than 'Spectabilis'.
 *
 * Linear, and deliberately well below the white point. The demo scene -- like
 * most real ones -- tone-maps with ACES, which desaturates as it rolls off, so
 * an albedo authored at the brightness the flower LOOKS in a photograph comes
 * out of a 3.1-intensity key light far above 1.0 and lands in the part of the
 * curve where yellow turns to pale khaki. Authoring the plate darker and more
 * saturated puts the lit result back where the photographs are.
 */
const LOBE_YELLOW = [0.6, 0.37, 0.004];
const LOBE_TIP = [0.7, 0.48, 0.014];
const THROAT_AMBER = [0.5, 0.26, 0.012];
const EYE_BROWN = [0.3, 0.15, 0.015];

/** Cheap value noise, matching the leaf and floret plates. */
function noise(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (
    noise(xi, yi) * (1 - u) * (1 - v) +
    noise(xi + 1, yi) * u * (1 - v) +
    noise(xi, yi + 1) * (1 - u) * v +
    noise(xi + 1, yi + 1) * u * v
  );
}

/**
 * Half-width of a lobe at s, 0 at the throat and 1 at the tip.
 *
 * Oblong: narrowed where it meets the throat, near parallel-sided through the
 * middle, then rounded off. A lobe that swells evenly reads as a broad petal,
 * which is a buttercup or a kerria -- forsythia lobes are straps.
 */
function lobeHalfWidth(s, halfWidth) {
  return halfWidth * Math.pow(Math.sin(Math.PI * (0.13 + 0.8 * s)), 0.5);
}

/**
 * Sample the corolla at (u, v), returning the lobe-local coordinates needed to
 * shade it, or null outside every lobe.
 *
 * `along` runs 0 at the throat to 1 at the tip and `lateral` is the signed
 * distance across the lobe normalised to its own half-width, so the caller can
 * shade the midline highlight and the rolled-back margins without knowing
 * which lobe it landed on.
 */
function sampleCorolla(u, v) {
  const dx = u - 0.5;
  const dy = v - 0.5;
  let best = null;

  for (const [angle, reach, halfWidth, curve] of LOBES) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const axial = dx * dirX + dy * dirY;
    if (axial < 0) continue;
    const span = reach - THROAT_RADIUS;
    const along = (axial - THROAT_RADIUS) / span;
    if (along < -THROAT_RADIUS / span || along > 1) continue;

    // The lobe's own centre line bows sideways along its length.
    const side = -dx * dirY + dy * dirX;
    const bow = curve * halfWidth * Math.sin(Math.PI * Math.max(0, along));
    const offset = side - bow;
    const width = lobeHalfWidth(Math.max(0, along), halfWidth);
    if (Math.abs(offset) > width) continue;

    const lateral = offset / width;
    if (!best || along > best.along) {
      best = { along, lateral, edge: 1 - Math.abs(lateral) };
    }
  }
  return best;
}

const SS = 3; // supersampling factor for a clean alpha edge
const rgba = Buffer.alloc(SIZE * SIZE * 4);

const covers = (u, v) =>
  sampleCorolla(u, v) != null ||
  Math.hypot(u - 0.5, v - 0.5) <= THROAT_RADIUS * 1.12;

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let covered = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const u = (px + (sx + 0.5) / SS) / SIZE;
        const v = 1 - (py + (sy + 0.5) / SS) / SIZE;
        if (covers(u, v)) covered += 1;
      }
    }
    const alpha = covered / (SS * SS);
    if (alpha <= 0) continue;

    const i = (py * SIZE + px) * 4;
    const u = (px + 0.5) / SIZE;
    const v = 1 - (py + 0.5) / SIZE;
    const radius = Math.hypot(u - 0.5, v - 0.5);
    const lobe = sampleCorolla(u, v);

    // Base hue: yellow out along the lobe, warming to a pale tip.
    const along = lobe ? Math.max(0, lobe.along) : 0;
    const mix = Math.pow(along, 0.85);
    let r = LOBE_YELLOW[0] + (LOBE_TIP[0] - LOBE_YELLOW[0]) * mix;
    let g = LOBE_YELLOW[1] + (LOBE_TIP[1] - LOBE_YELLOW[1]) * mix;
    let b = LOBE_YELLOW[2] + (LOBE_TIP[2] - LOBE_YELLOW[2]) * mix;

    // The eye: deeper gold in the throat only. Letting it spread turns the
    // whole flower orange, and forsythia yellow is what the cultivar is for.
    const eye = Math.max(0, 1 - radius / EYE_RADIUS);
    const throat = Math.pow(eye, 2.1);
    r += (THROAT_AMBER[0] - r) * throat;
    g += (THROAT_AMBER[1] - g) * throat;
    b += (THROAT_AMBER[2] - b) * throat;
    const centre = Math.pow(Math.max(0, 1 - radius / (THROAT_RADIUS * 2.1)), 2);
    r += (EYE_BROWN[0] - r) * centre;
    g += (EYE_BROWN[1] - g) * centre;
    b += (EYE_BROWN[2] - b) * centre;

    // A pale midline and a slightly shaded margin, which is what the eye reads
    // as a lobe rolling back on itself.
    if (lobe) {
      const midline = Math.pow(
        Math.max(0, 1 - Math.abs(lobe.lateral) / 0.5),
        2,
      );
      const margin = Math.pow(Math.abs(lobe.lateral), 3.2);
      const lift = 0.1 * midline - 0.16 * margin;
      r += lift;
      g += lift * 0.9;
      b += lift * 0.12;

      // Faint longitudinal veining, and the mottle every plate in this folder
      // carries so a face is not a flat wash.
      const veins = Math.cos(lobe.lateral * Math.PI * 3.2) * 0.022 * along;
      const n = (smoothNoise(u * 30, v * 30) - 0.5) * 0.04;
      r += veins + n;
      g += veins * 0.9 + n * 0.9;
      b += n * 0.1;
    }

    const enc = (x) => {
      const c = Math.max(0, Math.min(1, x));
      const e =
        c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(e * 255);
    };
    rgba[i] = enc(r);
    rgba[i + 1] = enc(g);
    rgba[i + 2] = enc(b);
    rgba[i + 3] = Math.round(alpha * 255);
  }
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
    '82',
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
