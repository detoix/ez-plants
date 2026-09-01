/**
 * Generate the Lavandula angustifolia 'Hidcote' leaf plate.
 *
 * Same pipeline as the other foliage plates in this repo: a project asset
 * drawn from botanical references and baked to a WebP, so the plant folder
 * stays portable and works with no demo app behind it.
 *
 * ---------------------------------------------------------------------------
 * What is different about this leaf
 * ---------------------------------------------------------------------------
 * Three things, and all three show:
 *
 *   - It is **linear**, 2-6 cm long and 4-6 mm broad. That is an aspect ratio
 *     of about seven to one, against a forsythia blade's two. The plate keeps
 *     the true proportion, so the card can be scaled uniformly by leaf length
 *     and come out the right width on its own.
 *   - It is **sessile**. There is no petiole to paint into the bottom of the
 *     tile the way the forsythia plate does, because the leaf sits straight on
 *     the stem. What the bottom eighth of this tile carries instead is simply
 *     more blade.
 *   - Its margins are **revolute** — rolled under — and the underside is
 *     white-woolly, so both edges of the leaf show as a pale rim against a
 *     duller grey-green face. That rim is most of what makes lavender foliage
 *     read as silver rather than as green, and it is painted rather than
 *     modelled: a rolled edge is two more triangles a leaf on a plant carrying
 *     five thousand of them.
 *
 * The plate does double duty at coarse LOD bands. `LAVENDER.js` seats the
 * flower stems and the spikes themselves as cards cut from this same tile
 * once the spike mesh is dropped, which is why the blade is kept opaque and
 * clean down its middle: stretched thin it is a stem, stretched wide and
 * tinted violet it is a spike.
 *
 *   node scripts/make-lavender-leaf-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(process.cwd(), 'src/lib/plants/lavender/leaf.webp');

/**
 * Half the blade's widest point, in texture units.
 *
 * The published range is 2-6 cm long by 4-6 mm broad, which is anywhere from
 * five to fifteen to one; a 2.5 cm shoot leaf 2.4 mm across is
 * better than 10:1, so full width is 0.096 of the tile. Erring narrow is
 * deliberate: a lavender's foliage reads as a mass of fine needles, and a
 * blade even slightly too broad turns the mound into a small-leaved shrub. Keeping the true proportion here is what lets
 * the card be scaled uniformly by leaf length and come out the right width
 * with no second number to keep in step. `LEAF_PLATE_FILL` in `lavender.js`
 * is this number doubled and must move with it.
 */
const HALF_WIDTH = 0.048;
/** Where along the blade it is widest. A lavender leaf is widest above middle. */
const WIDEST_AT = 0.56;
/** Share of the half-width that reads as the rolled, white-woolly margin. */
const RIM_SHARE = 0.3;

/** Half-width of the blade at t (0 = base, 1 = tip), in texture units. */
function halfWidthAt(t) {
  if (t <= 0 || t >= 1) return 0;
  // Narrow and parallel-sided for most of its length, drawn into a blunt
  // rounded tip and tapering gently to the sessile base.
  const base = Math.pow(Math.min(1, t / 0.24), 0.62);
  // Obtuse rather than acute: a lavender leaf ends bluntly, and a plate that
  // draws it to a needle point reads as rosemary instead.
  const tip = Math.pow(Math.min(1, (1 - t) / 0.1), 0.34);
  const belly = 0.86 + 0.14 * Math.cos((t - WIDEST_AT) * Math.PI * 1.15);
  return HALF_WIDTH * base * tip * belly;
}

/** Cheap value noise for the dense stellate down. */
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

const SS = 3; // supersampling, for a clean alpha edge on a very narrow shape
const rgba = Buffer.alloc(SIZE * SIZE * 4);

// Linear-light colours. Grey-green face, paler and warmer along the rolled
// margins where the woolly underside shows, and a faintly sunken pale midrib.
// Green, with a grey bloom over it rather than instead of it.
//
// The literature calls this cultivar's foliage "silver-grey", and taking that
// at face value produced a plant the colour of wormwood. Photographs of
// 'Hidcote' actually growing show a fresh mid-green; the silver is a thin
// coat of white hairs and a pale rolled margin *on* that green, and it only
// takes over in winter. So the blade is green here and the greying is applied
// lightly on top, where the season tint can lift it in autumn.
const FACE_BASE = [0.212, 0.296, 0.152];
const FACE_TIP = [0.184, 0.268, 0.133];
const RIM = [0.372, 0.412, 0.306];
const MIDRIB = [0.3, 0.352, 0.232];

const encode = (value) => {
  const c = Math.max(0, Math.min(1, value));
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(e * 255);
};

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let covered = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const u = (px + (sx + 0.5) / SS) / SIZE;
        // Canvas rows run downward; uv.y = 1 is the tip, so flip.
        const v = 1 - (py + (sy + 0.5) / SS) / SIZE;
        if (Math.abs(u - 0.5) <= halfWidthAt(v)) covered += 1;
      }
    }
    const alpha = covered / (SS * SS);
    if (alpha <= 0) continue;

    const index = (py * SIZE + px) * 4;
    const u = (px + 0.5) / SIZE;
    const v = 1 - (py + 0.5) / SIZE;
    const half = Math.max(1e-6, halfWidthAt(v));
    const across = Math.min(1, Math.abs(u - 0.5) / half);

    const mix = Math.pow(v, 0.85);
    let r = FACE_BASE[0] + (FACE_TIP[0] - FACE_BASE[0]) * mix;
    let g = FACE_BASE[1] + (FACE_TIP[1] - FACE_BASE[1]) * mix;
    let b = FACE_BASE[2] + (FACE_TIP[2] - FACE_BASE[2]) * mix;

    // The rolled margin: a pale rim on both edges, showing the white-woolly
    // underside. This is the leaf's whole silver read.
    if (across > 1 - RIM_SHARE) {
      const w = Math.pow((across - (1 - RIM_SHARE)) / RIM_SHARE, 0.7);
      r += (RIM[0] - r) * w;
      g += (RIM[1] - g) * w;
      b += (RIM[2] - b) * w;
    }

    // Sunken midrib, pale and narrow, fading out before the tip.
    const rib = Math.max(0, 1 - across / 0.2) * (v < 0.93 ? 1 : 0);
    if (rib > 0) {
      const w = rib * 0.55;
      r += (MIDRIB[0] - r) * w;
      g += (MIDRIB[1] - g) * w;
      b += (MIDRIB[2] - b) * w;
    }

    // Dense stellate down: fine, high-frequency, and desaturating rather than
    // darkening, because that is what a coat of white hairs does to a colour.
    // Dense stellate down: fine, high-frequency and running lengthwise, and
    // it desaturates rather than darkens, because that is what a coat of
    // white hairs does to a colour.
    const down =
      (smoothNoise(u * 240, v * 30) - 0.5) * 0.7 +
      (smoothNoise(u * 90, v * 150) - 0.5) * 0.3;
    const grey = (r + g + b) / 3;
    const hairiness = 0.12 + 0.16 * down;
    r += (grey * 1.5 - r) * hairiness;
    g += (grey * 1.5 - g) * hairiness;
    b += (grey * 1.5 - b) * hairiness;

    rgba[index] = encode(r);
    rgba[index + 1] = encode(g);
    rgba[index + 2] = encode(b);
    rgba[index + 3] = Math.round(alpha * 255);
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
