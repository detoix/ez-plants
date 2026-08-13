/**
 * Generate the Forsythia x intermedia 'Lynwood' leaf plate.
 *
 * Same approach as `leaves/blackcurrant-tisel.webp`: a project asset drawn from
 * botanical references rather than an upstream EZ-Tree texture. Baking it to a
 * WebP (instead of drawing it into a canvas at runtime) keeps the library's
 * asset pipeline uniform -- every plant's foliage is a plate loaded through
 * `getLeafMap`, so the packaged component works without the demo app.
 *
 * Blade morphology, per Trees and Shrubs Online and NC State Extension:
 * ovate to broad-lanceolate, 4-10 x 2-5 cm, cuneate base, acute apex, and
 * toothed on the upper half with an entire lower margin.
 *
 *   node scripts/make-leaf-texture.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 1024;
const OUT = path.join(
  process.cwd(),
  'src/app/public/textures/leaves/forsythia-lynwood.webp',
);

const WIDEST_AT = 0.38;
const BASE_WIDTH = 0.11;
// The plate carries the blade's TRUE proportions, like the other leaf plates
// in this folder, so the instance matrix can scale the card uniformly. Full
// width therefore spans ~0.44 of the texture: a 2.2:1 length-to-width leaf.
const FILL = 0.22;
const TEETH = 12;

/** Half-width of the blade at t (0 = petiole, 1 = tip), in texture units. */
function halfWidthAt(t) {
  if (t <= 0 || t >= 1) return 0;
  const shape =
    t < WIDEST_AT
      ? BASE_WIDTH + (1 - BASE_WIDTH) * Math.pow(t / WIDEST_AT, 0.62)
      : Math.pow((1 - t) / (1 - WIDEST_AT), 0.88);
  return FILL * shape;
}

/** Shallow forward-leaning teeth, confined to the upper margin. */
function serrationAt(t) {
  const start = 0.38;
  const full = 0.52;
  const fade = 0.93;
  if (t < start) return 0;
  const ramp = Math.min(1, (t - start) / (full - start));
  const out = t > fade ? Math.max(0, 1 - (t - fade) / (1 - fade)) : 1;
  const phase = (t - start) * TEETH;
  const frac = phase - Math.floor(phase);
  return ramp * out * Math.pow(frac, 0.6) * (1 - frac) * (0.14 * FILL);
}

const margin = (t) => halfWidthAt(t) + serrationAt(t);

/** Cheap value noise for blade mottling. */
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
  const a = noise(xi, yi);
  const b = noise(xi + 1, yi);
  const c = noise(xi, yi + 1);
  const d = noise(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** Distance from (u,v) to the nearest point on a vein, for shading. */
function veinFactor(u, v) {
  // Midrib.
  let best = Math.abs(u - 0.5) / 0.006;
  if (v > 0.965) best = 1e9;
  // Pinnate laterals, angled forward toward the tip.
  const pairs = 7;
  for (let pair = 1; pair <= pairs; pair += 1) {
    const t0 = 0.08 + (pair / (pairs + 1)) * 0.8;
    const reach = halfWidthAt(t0) * 0.88;
    for (const dir of [-1, 1]) {
      // Parameterise the vein as a quadratic from midrib outward.
      for (let s = 0; s <= 1; s += 0.005) {
        const vx = 0.5 + dir * reach * s;
        const vy = t0 + 0.095 * s * s + 0.03 * s;
        const d = Math.hypot((u - vx) / 0.004, (v - vy) / 0.006);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

const SS = 3; // supersampling factor for a clean alpha edge
const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let covered = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const u = (px + (sx + 0.5) / SS) / SIZE;
        // Canvas rows run downward; uv.y = 1 is the tip, so flip.
        const v = 1 - (py + (sy + 0.5) / SS) / SIZE;
        if (Math.abs(u - 0.5) <= margin(v)) covered += 1;
      }
    }
    const alpha = covered / (SS * SS);
    const i = (py * SIZE + px) * 4;
    if (alpha <= 0) continue;

    const u = (px + 0.5) / SIZE;
    const v = 1 - (py + 0.5) / SIZE;

    // Deep, faintly blue green; paler and warmer toward the base.
    const base = [0.105, 0.215, 0.055];
    const tip = [0.082, 0.178, 0.044];
    const mix = Math.pow(v, 0.8);
    let r = base[0] + (tip[0] - base[0]) * mix;
    let g = base[1] + (tip[1] - base[1]) * mix;
    let b = base[2] + (tip[2] - base[2]) * mix;

    // Mottling so the blade is not a flat wash.
    const n = smoothNoise(u * 26, v * 34) - 0.5;
    r += n * 0.045;
    g += n * 0.06;
    b += n * 0.03;

    // Veins: pale, slightly yellow-green.
    const vd = veinFactor(u, v);
    if (vd < 1.6) {
      const w = Math.max(0, 1 - vd / 1.6) * 0.55;
      r += (0.3 - r) * w;
      g += (0.42 - g) * w;
      b += (0.16 - b) * w;
    }

    // Darken very slightly toward the margin for a rounded read.
    const edge = Math.min(1, Math.abs(u - 0.5) / Math.max(1e-6, margin(v)));
    const shade = 1 - 0.14 * Math.pow(edge, 3);

    const enc = (x) => {
      const c = Math.max(0, Math.min(1, x * shade));
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
