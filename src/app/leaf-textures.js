import * as THREE from 'three';

const cache = new Map();

/**
 * Half-width profile of one blade, from base (t=0) to tip (t=1), in units of
 * the texture's width.
 *
 * Forsythia x intermedia leaves are ovate to broad-lanceolate: a short wedge
 * base, the widest point below the middle, then a long taper to the point.
 *
 * `fill` is how much of the texture the widest point spans, NOT the leaf's
 * length-to-width ratio. That ratio is carried by the instance matrix, which
 * scales the unit leaf card to the blade's real metres; the drawing here just
 * has to fill the card it is mapped onto, or the blade renders narrower than
 * the geometry claims and the card's empty margins waste overdraw.
 */
const WIDEST_AT = 0.38;
// The blade still has width where it meets the petiole. Tapering to a needle
// point there would draw a symmetric spindle rather than an ovate leaf.
const BASE_WIDTH = 0.11;

function halfWidthAt(t, fill) {
  if (t <= 0 || t >= 1) return 0;
  const shape =
    t < WIDEST_AT
      ? // Cuneate base with a convex lower margin: the blade is noticeably
        // broader below the middle, which is what makes it read as ovate
        // rather than lanceolate.
        BASE_WIDTH + (1 - BASE_WIDTH) * Math.pow(t / WIDEST_AT, 0.62)
      : // Gradual, slightly convex taper to an acute apex.
        Math.pow((1 - t) / (1 - WIDEST_AT), 0.88);
  return fill * shape;
}

/**
 * Shallow forward-leaning teeth on the upper margin.
 *
 * The published description is "toothed on the upper half, entire toward the
 * base", so the teeth fade in above the widest point and fade out again at the
 * apex. They are deliberately shallow: deep regular sawteeth read as a fern
 * frond rather than a forsythia blade.
 */
function serrationAt(t, teeth) {
  const start = 0.38;
  const full = 0.52;
  const fade = 0.93;
  if (t < start) return 0;
  const ramp = Math.min(1, (t - start) / (full - start));
  const out = t > fade ? Math.max(0, 1 - (t - fade) / (1 - fade)) : 1;
  const phase = (t - start) * teeth;
  const frac = phase - Math.floor(phase);
  // Quick rise then a slow fall, so each tooth points toward the tip.
  const tooth = Math.pow(frac, 0.6) * (1 - frac);
  return ramp * out * tooth * 0.065;
}

function bladeOutline(steps, fill, teeth) {
  const left = [];
  const right = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const half = halfWidthAt(t, fill) + serrationAt(t, teeth);
    left.push([0.5 - half, t]);
    right.push([0.5 + half, t]);
  }
  return { left, right };
}

/**
 * Draw one forsythia leaf into a canvas texture.
 *
 * The repository ships photographic leaf plates for the EZ-Tree species and
 * for the blackcurrant, but has none for forsythia. Drawing the blade keeps
 * the silhouette faithful to the botanical description (opposite, ovate to
 * broad-lanceolate, serrate above, entire toward the base) without adding a
 * binary asset whose provenance could not be cited.
 */
export function createForsythiaLeafTexture({
  size = 512,
  fill = 0.46,
  teeth = 12,
  autumn = false,
} = {}) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), {
          width: size,
          height: size,
        });
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);

  // Canvas v grows downward; the card's uv.y=1 is the tip, so the blade is
  // drawn upside down here and read the right way up by the leaf material.
  const toCanvas = ([u, v]) => [u * size, (1 - v) * size];
  const { left, right } = bladeOutline(96, fill, teeth);

  context.beginPath();
  const outline = [...right, ...left.slice().reverse()];
  outline.forEach((point, index) => {
    const [x, y] = toCanvas(point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();

  const blade = context.createLinearGradient(0, size, 0, 0);
  if (autumn) {
    blade.addColorStop(0, '#8a7328');
    blade.addColorStop(0.55, '#b9922f');
    blade.addColorStop(1, '#c9a24a');
  } else {
    // A fairly deep, slightly blue green, paler at the base.
    blade.addColorStop(0, '#4e6b34');
    blade.addColorStop(0.45, '#3f5e2c');
    blade.addColorStop(1, '#365326');
  }
  context.fillStyle = blade;
  context.fill();

  // Midrib.
  context.strokeStyle = autumn
    ? 'rgba(226, 204, 150, 0.55)'
    : 'rgba(190, 214, 150, 0.45)';
  context.lineWidth = size * 0.012;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(...toCanvas([0.5, 0.0]));
  context.lineTo(...toCanvas([0.5, 0.97]));
  context.stroke();

  // Pinnate lateral veins, angled forward toward the tip.
  context.lineWidth = size * 0.005;
  context.strokeStyle = autumn
    ? 'rgba(226, 204, 150, 0.34)'
    : 'rgba(180, 205, 140, 0.3)';
  const veinPairs = 6;
  for (let pair = 1; pair <= veinPairs; pair += 1) {
    const t = 0.1 + (pair / (veinPairs + 1)) * 0.78;
    const reach = halfWidthAt(t, fill) * 0.86;
    for (const direction of [-1, 1]) {
      context.beginPath();
      context.moveTo(...toCanvas([0.5, t]));
      context.quadraticCurveTo(
        ...toCanvas([0.5 + direction * reach * 0.55, t + 0.045]),
        ...toCanvas([0.5 + direction * reach, t + 0.085]),
      );
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Cached accessor so repeated plant rebuilds share one GPU texture. */
export function getForsythiaLeafMap(options = {}) {
  const key = JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, createForsythiaLeafTexture(options));
  return cache.get(key);
}
