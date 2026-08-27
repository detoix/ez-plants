import * as THREE from 'three';

/**
 * Procedural bark maps, shared by every woody plant in this library.
 *
 * Library rule 7 requires a plant to render correctly with no assets supplied
 * by the caller. A leaf plate is cultivar-specific art and so travels in the
 * plant's own folder, but bark is not: all three shrubs borrow one generic
 * texture set. Generating it costs about two kilobytes of code instead of the
 * 840 kB the photographed set weighs, and it needs no image decoder, so it
 * works in Node and in any bundler.
 *
 * The recipe is the standard one rather than anything invented here:
 *
 *   - Value noise summed over octaves as fractional Brownian motion, with the
 *     usual lacunarity 2 / gain 0.5 (Perlin; The Book of Shaders ch. 13).
 *   - Sampled anisotropically, the vertical axis compressed, so features are
 *     stretched along the stem the way real bark runs.
 *   - Turbulence phase-shifts a sine across the circumference — Ebert et al.'s
 *     marble/wood formula `sin(f * (x + a * turbulence(p)))`, which is what
 *     turns smooth noise into parallel furrows.
 *   - `1 - |ridge|` sharpens the sine's zero crossings into creases, the ridged
 *     multifractal trick (Musgrave).
 *   - The furrow field is warped by a second, coarser noise before it is used,
 *     so ridges wander and fork instead of running dead straight (Quilez,
 *     "Domain warping").
 *
 * A single height field is built once; colour, normal and roughness are all
 * derived from it, so the three maps agree by construction.
 *
 * References:
 *   https://thebookofshaders.com/13/          (fBm)
 *   https://iquilezles.org/articles/warp/     (domain warping)
 *   https://www.ibiblio.org/e-notes/Splines/tree/bark.htm  (noise + sin strips)
 */

// Bark is tiled hard on a shrub stem -- EZ-Tree wraps it about 250 times per
// metre of radius -- so a small map is resolved far below a pixel anyway.
const WIDTH = 96;
const HEIGHT = 256;

// Vertical features are ~8x longer than they are wide.
const VERTICAL_STRETCH = 8;
const FURROWS = 4;
const WARP_STRENGTH = 0.55;
const OCTAVES = 4;

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Deterministic integer value hash. No RNG: the same bark every run, on every
 * machine. Integer mixing rather than the usual `fract(sin(dot(..)) * k)` --
 * this is called about a million times building the field, and `Math.sin`
 * dominates the cost when it is.
 */
function hash(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise that tiles exactly over `periodX` by `periodY`, so the map wraps
 * around a stem and along it without a seam. Both periods must be integers.
 */
function noise(x, y, periodX, periodY) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const wrap = (v, period) => ((v % period) + period) % period;
  const x0 = wrap(xi, periodX);
  const x1 = wrap(xi + 1, periodX);
  const y0 = wrap(yi, periodY);
  const y1 = wrap(yi + 1, periodY);
  return lerp(
    lerp(hash(x0, y0), hash(x1, y0), xf),
    lerp(hash(x0, y1), hash(x1, y1), xf),
    yf,
  );
}

/**
 * Fractional Brownian motion: lacunarity 2, gain 0.5. Doubling the period with
 * the frequency is what keeps every octave tiling on the same boundary.
 */
function fbm(x, y, periodX, periodY, octaves = OCTAVES) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      amplitude *
      noise(
        x * frequency,
        y * frequency,
        periodX * frequency,
        periodY * frequency,
      );
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * The bark height field in 0..1: 0 is the floor of a furrow, 1 a ridge crest.
 * Everything else in this module is derived from these numbers.
 */
function heightField() {
  const field = new Float32Array(WIDTH * HEIGHT);
  // Integer noise cell counts across the map, so every octave wraps. Few cells
  // around the stem and many up it is the anisotropy that makes bark grain.
  const cellsX = 6;
  const cellsY = cellsX * (HEIGHT / WIDTH / VERTICAL_STRETCH);

  for (let py = 0; py < HEIGHT; py += 1) {
    const y = (py / HEIGHT) * cellsY;
    for (let px = 0; px < WIDTH; px += 1) {
      const u = px / WIDTH;
      const x = u * cellsX;

      // The furrows must close on themselves around the stem, so the phase
      // advances a whole number of sine periods across the width.
      const warp = fbm(x + 5, y + 1, cellsX, cellsY, 3) - 0.5;
      const turbulence = fbm(x, y, cellsX, cellsY) - 0.5;

      // Ebert's marble phase shift. The displacement is scaled by one furrow
      // period, so ridges wander by a fraction of their own width instead of
      // being scrambled across several.
      const wander = (WARP_STRENGTH * warp + 0.35 * turbulence) / FURROWS;
      const phase = (u + wander) * 2 * Math.PI * FURROWS;
      // `1 - |sin|` creases the zero crossings into ridges (Musgrave).
      const ridge = 1 - Math.abs(Math.sin(phase));

      // A little fine noise keeps the ridges from looking extruded.
      const grain = fbm(x * 3, y * 3, cellsX * 3, cellsY * 3, 3) - 0.5;
      field[py * WIDTH + px] = Math.max(
        0,
        Math.min(1, ridge * 0.85 + 0.075 + grain * 0.3),
      );
    }
  }
  return field;
}

/** Height lookup that wraps on both axes, so the derived normal tiles too. */
function at(field, px, py) {
  const x = ((px % WIDTH) + WIDTH) % WIDTH;
  const y = ((py % HEIGHT) + HEIGHT) % HEIGHT;
  return field[y * WIDTH + x];
}

function texture(data, { srgb = false } = {}) {
  const map = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat);
  if (srgb) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

let cached = null;

/**
 * Builds (once) the `{ color, normal, roughness }` set that
 * `createBarkMaterial` expects. The maps are shared by every plant, so callers
 * must not dispose them; a caller-supplied bark set overrides them entirely.
 *
 * @returns {{ color: THREE.Texture, normal: THREE.Texture, roughness: THREE.Texture }}
 */
export function createBarkMaps() {
  if (cached) return cached;

  const field = heightField();
  const color = new Uint8Array(WIDTH * HEIGHT * 4);
  const normal = new Uint8Array(WIDTH * HEIGHT * 4);
  const roughness = new Uint8Array(WIDTH * HEIGHT * 4);

  // Grey-brown, warmer and lighter on the ridges that catch the light, cooler
  // and darker down in the furrows where the plant is still growing bark.
  const furrow = [0.106, 0.086, 0.071];
  const crest = [0.412, 0.361, 0.302];

  for (let py = 0; py < HEIGHT; py += 1) {
    for (let px = 0; px < WIDTH; px += 1) {
      const index = (py * WIDTH + px) * 4;
      const h = field[py * WIDTH + px];

      const shade = Math.pow(h, 1.15);
      for (let channel = 0; channel < 3; channel += 1) {
        const linear = lerp(furrow[channel], crest[channel], shade);
        // Linear -> sRGB, so the map reads correctly as an sRGB colour texture.
        const encoded =
          linear <= 0.0031308
            ? 12.92 * linear
            : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
        color[index + channel] = Math.round(encoded * 255);
      }
      color[index + 3] = 255;

      // Central differences on the height field give the tangent-space normal.
      const dx = (at(field, px + 1, py) - at(field, px - 1, py)) * 2.2;
      const dy = (at(field, px, py + 1) - at(field, px, py - 1)) * 2.2;
      const length = Math.hypot(dx, dy, 1);
      normal[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normal[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normal[index + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      normal[index + 3] = 255;

      // Furrows hold moisture and dust, so they read rougher than the crests.
      const rough = Math.round(lerp(255, 196, shade));
      roughness[index] = rough;
      roughness[index + 1] = rough;
      roughness[index + 2] = rough;
      roughness[index + 3] = 255;
    }
  }

  cached = {
    color: texture(color, { srgb: true }),
    normal: texture(normal),
    roughness: texture(roughness),
  };
  cached.color.name = 'ProceduralBark_Color';
  cached.normal.name = 'ProceduralBark_Normal';
  cached.roughness.name = 'ProceduralBark_Roughness';
  return cached;
}

const scaledSets = new Map();

/**
 * The shared set, prepared for one longitudinal repeat.
 *
 * `configureBarkTexture` writes `repeat` onto the texture it is handed, and
 * these textures are shared by every plant — so two plants asking for
 * different scales would otherwise fight over one `repeat`, last construction
 * winning for both. Each distinct scale gets its own clone instead. Clones
 * share the underlying `Source`, so this costs an object, not an upload, and
 * in practice there is exactly one scale in play.
 *
 * @param {number} [textureScaleY]
 * @returns {{ color: THREE.Texture, normal: THREE.Texture, roughness: THREE.Texture }}
 */
export function barkMapsForScale(textureScaleY = 1) {
  if (!Number.isFinite(textureScaleY) || textureScaleY <= 0) {
    throw new RangeError('Bark textureScale.y must be a positive number.');
  }

  const base = createBarkMaps();
  const existing = scaledSets.get(textureScaleY);
  if (existing) return existing;

  const set = Object.fromEntries(
    Object.entries(base).map(([slot, map]) => {
      const clone = map.clone();
      clone.name = `${map.name}@${textureScaleY}`;
      clone.repeat.set(1, 1 / textureScaleY);
      clone.needsUpdate = true;
      return [slot, clone];
    }),
  );
  scaledSets.set(textureScaleY, set);
  return set;
}
