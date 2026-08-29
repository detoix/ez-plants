/**
 * Generate the Hydrangea paniculata 'Limelight' sterile-floret plate.
 *
 * Same pipeline as the leaf plates: a project asset drawn from botanical
 * references and baked to a WebP so the plant folder stays portable.
 *
 * ---------------------------------------------------------------------------
 * Why a plate at all
 * ---------------------------------------------------------------------------
 * 'Limelight' carries 850-1200 flowers per panicle and is 80-100% sterile, so
 * the head is a solid mass of four-sepal florets. Meshing them defeats itself:
 * the previous model spent 24 triangles on each of 212 florets -- 5,088 per
 * head, 195,408 across a five-year shrub -- and *still* had to draw each
 * floret at 4-6 cm, well over the 2.7-4.7 cm of the patent, because 212 is a
 * fifth of the real count and anything smaller read as a sparse wire cone.
 *
 * A plate inverts that. One tile holds a cluster of five overlapping florets,
 * so a 2-triangle card carries five flowers at their true size, and the ~45
 * cards that clothe a head show ~220 of them for 90 triangles. The florets
 * that are hidden inside a real panicle stay hidden here too -- they were
 * never the reason the head reads as dense.
 *
 * ---------------------------------------------------------------------------
 * Morphology, per the cultivar description and the RHS trial
 * ---------------------------------------------------------------------------
 * Four enlarged, petal-like sepals per sterile floret -- not petals -- each a
 * shallowly cupped ovate face, narrowed where it meets the throat, leaving the
 * dark cross-shaped centre that close photographs show.
 *
 * The plate is deliberately near-neutral. 'Limelight' runs lime -> cream ->
 * blush -> dusty rose -> parchment across one season, and that whole sequence
 * arrives as a per-instance colour multiplied over these pixels; baking any
 * real hue in here would fight it. What the plate carries is *form*: the
 * throat shadow, the cupping gradient, the pale margin and the depth ordering
 * between overlapping florets.
 *
 *   node scripts/make-floret-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(process.cwd(), 'src/lib/plants/hydrangea/floret.webp');

/**
 * Florets in the tile, as [x, y, radius, rotation, depth]; y is up.
 *
 * Nine, packed and overlapping, and every one of them wholly inside the tile.
 *
 * Inside the tile, because a floret running off the edge is cut by the tile
 * border, and a card whose alpha ends in a straight line stops being a cluster
 * of flowers and becomes a visible flat plate. Ending every sepal inside makes
 * the card's outline a lobed cluster, so overlapping cards read as a mass
 * rather than as facets.
 *
 * Overlapping to the point that the middle of the tile is solid, because the
 * gaps between florets are gaps in the head. A rosette of four or five leaves
 * each card about 60% opaque, and on the plant that comes out as lace: you see
 * the shrub's shaded interior straight through the flowers. 'Limelight' is
 * 80-100% sterile and photographs as a solid cone. Only a card's *outline*
 * needs to be flower-shaped -- that is the part that lands on the head's
 * silhouette -- and its middle should simply be flowers all the way down.
 *
 * Nine also sets the scale. A card is about 0.42 panicle lengths at the
 * shoulder, so on a 20 cm head it is roughly 8.4 cm across; at radius 0.25 a
 * floret spans 4.2 cm -- inside the 2.7-4.7 cm the cultivar description gives,
 * and without the size inflation the meshed florets needed to look dense.
 */
const FLORETS = [
  [0.26, 0.25, 0.25, 0.4, 0.55],
  [0.5, 0.26, 0.25, 1.15, 0.72],
  [0.74, 0.25, 0.24, 2.0, 0.6],
  [0.25, 0.5, 0.25, 0.75, 0.66],
  [0.5, 0.5, 0.26, 2.7, 1.0],
  [0.75, 0.5, 0.25, 1.55, 0.74],
  [0.26, 0.75, 0.24, 0.28, 0.62],
  [0.5, 0.74, 0.25, 1.85, 0.8],
  [0.74, 0.75, 0.25, 0.95, 0.68],
];

const SEPAL_HALF_WIDTH = 0.42;
/** The throat half of each sepal is narrowed, making it ovate not a disc. */
const THROAT_NARROWING = 0.76;

/** Cheap value noise, matching the leaf plate's mottling. */
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
 * Sample one floret at (u, v).
 *
 * Returns null outside every sepal, or the sepal-local coordinates needed to
 * shade it: `along` runs 0 at the throat to 1 at the tip, `lateral` is the
 * signed distance across the sepal normalised to its own half-width, and
 * `edge` is the radial distance to the sepal outline.
 */
function sampleFloret(u, v, [cx, cy, radius, rotation]) {
  let best = null;
  for (let sepal = 0; sepal < 4; sepal += 1) {
    const angle = rotation + (sepal * Math.PI) / 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    // Sepal centre sits half a sepal-length out from the floret's own centre.
    const scx = cx + dirX * radius * 0.5;
    const scy = cy + dirY * radius * 0.5;
    const dx = u - scx;
    const dy = v - scy;
    const a = dx * dirX + dy * dirY;
    const b = -dx * dirY + dy * dirX;

    const semiAlong = radius * 0.5;
    const semiLateral =
      radius * SEPAL_HALF_WIDTH * (a < 0 ? THROAT_NARROWING : 1);
    const ellipse = (a / semiAlong) ** 2 + (b / semiLateral) ** 2;
    if (ellipse > 1) continue;

    const candidate = {
      along: (a / semiAlong + 1) / 2,
      lateral: Math.abs(b / semiLateral),
      edge: Math.sqrt(ellipse),
      sepal,
    };
    // Overlapping sepals of one floret: the nearer-to-tip surface wins, which
    // keeps the cross-shaped throat readable instead of washing it out.
    if (!best || candidate.along > best.along) best = candidate;
  }
  return best;
}

const SS = 3; // supersampling, for a clean alpha edge
const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    // Coverage first, supersampled across every floret in the tile.
    let covered = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const u = (px + (sx + 0.5) / SS) / SIZE;
        const v = 1 - (py + (sy + 0.5) / SS) / SIZE;
        if (FLORETS.some((floret) => sampleFloret(u, v, floret))) covered += 1;
      }
    }
    const alpha = covered / (SS * SS);
    if (alpha <= 0) continue;

    const u = (px + 0.5) / SIZE;
    const v = 1 - (py + 0.5) / SIZE;

    // Shade from the frontmost floret covering this pixel. Painter ordering by
    // the authored depth is what gives the tile its layered, packed read.
    let front = null;
    let frontDepth = -1;
    for (const floret of FLORETS) {
      const hit = sampleFloret(u, v, floret);
      if (hit && floret[4] > frontDepth) {
        front = hit;
        frontDepth = floret[4];
      }
    }
    if (!front) continue;

    // Near-neutral, faintly green. The season's colour arrives per instance.
    const throat = [0.7, 0.75, 0.52];
    const face = [0.92, 0.93, 0.85];
    const margin = [1.0, 1.0, 0.97];

    // Cupping: dark in the throat, opening out to a pale, slightly reflexed
    // margin. `along` does most of the work; the rim lift is what stops a
    // floret reading as a flat disc once directional light hits the card.
    const openness = Math.pow(front.along, 0.48);
    let r = throat[0] + (face[0] - throat[0]) * openness;
    let g = throat[1] + (face[1] - throat[1]) * openness;
    let b = throat[2] + (face[2] - throat[2]) * openness;

    const rim = Math.pow(front.edge, 4) * 0.55 + front.lateral ** 3 * 0.25;
    r += (margin[0] - r) * rim;
    g += (margin[1] - g) * rim;
    b += (margin[2] - b) * rim;

    // A single pale midvein per sepal, as in close photographs.
    const vein = Math.max(0, 1 - front.lateral / 0.13) * 0.3 * front.along;
    r += (1 - r) * vein;
    g += (1 - g) * vein;
    b += (0.95 - b) * vein;

    // Depth: florets further back in the tile sit in the head's own shade.
    // Gently. A head is a translucent mass of pale sepals bouncing light into
    // itself, and a deep occlusion range here compounds with the shell's own
    // shading into hard grey blotches across what a photograph shows as one
    // soft cream body.
    const occlusion = 0.82 + 0.18 * frontDepth;
    const mottle = (smoothNoise(u * 30, v * 30) - 0.5) * 0.05;

    const enc = (x) => {
      const c = Math.max(0, Math.min(1, (x + mottle) * occlusion));
      const e =
        c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(e * 255);
    };
    const i = (py * SIZE + px) * 4;
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
    '84',
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
