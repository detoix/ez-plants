import * as THREE from 'three';

import {
  finishGeometry,
  validatePositiveInteger,
} from '../../organ-geometry.js';

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

const BLADE_LAMINA = new THREE.Color(0.92, 0.96, 0.88);
const BLADE_MARGIN = new THREE.Color(0.72, 0.78, 0.68);
const HEAD_BASE = new THREE.Color(0.78, 0.74, 0.62);
const HEAD_TIP = new THREE.Color(1, 1, 0.96);

/** Erect young blade, mature arch, and recurved outside blade. */
export const BLADE_ARCH_VARIANTS = Object.freeze([0.42, 1.05, 1.4]);
export const BLADE_BAKED_ARCH = BLADE_ARCH_VARIANTS[1];
export const BLADE_TWIST_VARIANTS = Object.freeze([0.12, 0.3, 0.52]);

/** Full blade width as a fraction of arc length. */
export const BLADE_WIDTH_RATIOS = Object.freeze([0.015, 0.013, 0.0115]);

export function bladeVariantFor(arch) {
  let best = 0;
  for (let index = 1; index < BLADE_ARCH_VARIANTS.length; index += 1) {
    if (
      Math.abs(BLADE_ARCH_VARIANTS[index] - arch) <
      Math.abs(BLADE_ARCH_VARIANTS[best] - arch)
    ) {
      best = index;
    }
  }
  return best;
}

function integrateBladeTip(arch, segments = 24) {
  const tipAngle = arch * (Math.PI * 0.5 + 0.38);
  let across = 0;
  let along = 0;
  for (let index = 1; index <= segments; index += 1) {
    const previous = tipAngle * Math.pow((index - 1) / segments, 1.55);
    const current = tipAngle * Math.pow(index / segments, 1.55);
    const step = 1 / segments;
    across += ((Math.sin(previous) + Math.sin(current)) / 2) * step;
    along += ((Math.cos(previous) + Math.cos(current)) / 2) * step;
  }
  return { along, across };
}

function bladeTipAngle(arch) {
  const tip = integrateBladeTip(arch);
  return Math.atan2(tip.across, tip.along);
}

export function bladeTipOffset(arch) {
  const baked = integrateBladeTip(BLADE_BAKED_ARCH);
  const reach = Math.hypot(baked.along, baked.across);
  const angle = bladeTipAngle(arch);
  return { along: reach * Math.cos(angle), across: reach * Math.sin(angle) };
}

export function bladeArchTilt(arch) {
  return bladeTipAngle(arch) - bladeTipAngle(BLADE_BAKED_ARCH);
}

function bladeHalfWidth(s) {
  const opening = THREE.MathUtils.smoothstep(s, 0, 0.12);
  const taper = Math.pow(clamp01((1 - s) / 0.9), 0.55);
  return 0.5 * (0.48 + opening * 0.52) * taper;
}

/**
 * Unit-length, two-sided ribbon for Hameln's fine blades. Its deep arch is
 * baked into the centreline; one instance scale gives it its real length.
 */
export function createBladeGeometry({
  arch = BLADE_BAKED_ARCH,
  twist = BLADE_TWIST_VARIANTS[1],
  widthRatio = BLADE_WIDTH_RATIOS[1],
  segments = 9,
  columns = 2,
} = {}) {
  validatePositiveInteger(segments, 'segments');
  if (segments < 4) throw new RangeError('A blade needs at least 4 segments.');
  if (![2, 3].includes(columns)) {
    throw new RangeError('A blade needs 2 or 3 columns.');
  }
  if (!Number.isFinite(arch) || arch < 0 || arch > 1.4) {
    throw new RangeError('arch must be a finite number from 0 to 1.4.');
  }
  if (!Number.isFinite(twist) || Math.abs(twist) > 3) {
    throw new RangeError('twist must be a finite number from -3 to 3.');
  }
  if (!Number.isFinite(widthRatio) || widthRatio <= 0 || widthRatio > 0.1) {
    throw new RangeError('widthRatio must be a finite number from 0 to 0.1.');
  }

  const offsets = columns === 3 ? [-0.5, 0, 0.5] : [-0.5, 0.5];
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const rows = [];
  const tipAngle = arch * (Math.PI * 0.5 + 0.38);
  let x = 0;
  let y = 0;

  for (let index = 0; index <= segments; index += 1) {
    const s = index / segments;
    const angle = tipAngle * Math.pow(s, 1.55);
    const tangent = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    if (index > 0) {
      const previous = tipAngle * Math.pow((index - 1) / segments, 1.55);
      const step = 1 / segments;
      x += ((Math.sin(previous) + tangent.x) / 2) * step;
      y += ((Math.cos(previous) + tangent.y) / 2) * step;
    }

    const halfWidth = bladeHalfWidth(s) * widthRatio;
    const roll = twist * Math.pow(s, 1.35);
    const row = [];
    for (const offset of offsets) {
      const across = offset * halfWidth * 2;
      const z = across * Math.cos(roll);
      const lift = across * Math.sin(roll);
      positions.push(x - tangent.y * lift, y + tangent.x * lift, z);
      const tone = Math.max(0.78, 0.88 + s * 0.12);
      const colour = (Math.abs(offset) > 0.45 ? BLADE_MARGIN : BLADE_LAMINA)
        .clone()
        .multiplyScalar(tone);
      colors.push(colour.r, colour.g, colour.b);
      uvs.push(offset + 0.5, s);
      row.push(positions.length / 3 - 1);
    }
    rows.push(row);
  }

  for (let index = 0; index < segments; index += 1) {
    for (let column = 0; column < offsets.length - 1; column += 1) {
      const a = rows[index][column];
      const b = rows[index][column + 1];
      const c = rows[index + 1][column];
      const d = rows[index + 1][column + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  return finishGeometry({
    positions,
    colors,
    indices,
    uvs,
    userData: {
      organ: 'fountain-grass-blade',
      arch,
      twist,
      widthRatio,
      unitLength: 1,
    },
  });
}

/**
 * Procedural alpha plate for the dense bristles. The texture is neutral so
 * instance colour can carry the cultivar's seasonal cream-to-brown sequence.
 */
export function createBottlebrushTexture({ width = 64, height = 128 } = {}) {
  validatePositiveInteger(width, 'width');
  validatePositiveInteger(height, 'height');
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const endTaper = Math.pow(Math.sin(Math.PI * v), 0.58);
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const distance = Math.abs(u - 0.5) / 0.5;
      const verticalFade =
        THREE.MathUtils.smoothstep(v, 0, 0.075) *
        (1 - THREE.MathUtils.smoothstep(v, 0.925, 1));
      const coreRadius = 0.16 + endTaper * 0.3;
      const core =
        1 - THREE.MathUtils.smoothstep(distance, coreRadius * 0.58, coreRadius);
      const bristleEdge = 0.28 + endTaper * 0.66;
      const bristle =
        1 -
        THREE.MathUtils.smoothstep(distance, bristleEdge - 0.13, bristleEdge);
      const hash = Math.sin((x * 12.9898 + y * 78.233) * 0.73) * 43758.5453;
      const grain = hash - Math.floor(hash);
      const striation = 0.72 + 0.28 * Math.sin(y * 1.7 + x * 0.34) ** 2;
      // A bottlebrush is a mass of spikelets and radiating bristles, not an
      // opaque club. Keep a broken central spine and resolve the outer half as
      // short slanting filaments; crossed planes fill the volume without
      // filling every gap.
      const filament = Math.pow(
        Math.abs(Math.cos(y * 1.31 + distance * 8.4 + x * 0.07)),
        9,
      );
      const coreGrain = core * (grain > 0.22 ? 0.55 + grain * 0.45 : 0.06);
      const bristleGrain =
        Math.max(0, bristle - core) *
        (grain > 0.28 ? filament * striation * 0.92 : 0.025);
      const alpha = verticalFade * clamp01(coreGrain + bristleGrain);
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 248;
      data[index + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = 'Pennisetum_Hameln_Bottlebrush';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A bottlebrush is a narrow bristled cylinder, represented by crossed alpha
 * ribbons. The plate carries the sub-pixel bristles; geometry only carries
 * the volume and bendable length.
 */
export function createBottlebrushGeometry({ planes = 3, segments = 3 } = {}) {
  validatePositiveInteger(planes, 'planes');
  validatePositiveInteger(segments, 'segments');
  if (planes < 2 || planes > 4) {
    throw new RangeError('planes must be an integer from 2 to 4.');
  }
  if (segments < 1 || segments > 6) {
    throw new RangeError('segments must be an integer from 1 to 6.');
  }

  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  for (let plane = 0; plane < planes; plane += 1) {
    const angle = (plane / planes) * Math.PI;
    const across = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const base = positions.length / 3;
    for (let row = 0; row <= segments; row += 1) {
      const v = row / segments;
      const centreBulge = 0.9 + 0.1 * Math.sin(Math.PI * v);
      // A small baked bow makes each brush continue the curved peduncle rather
      // than ending as a rigid capsule. Because instance X is scaled by head
      // width, the offset stays subtle across the cultivar's size range.
      const centreBend = 0.22 * Math.pow(v, 1.8);
      for (const side of [-1, 1]) {
        const radius = side * 0.5 * centreBulge;
        positions.push(centreBend + across.x * radius, v, across.z * radius);
        const colour = HEAD_BASE.clone().lerp(HEAD_TIP, 0.28 + v * 0.32);
        colors.push(colour.r, colour.g, colour.b);
        uvs.push(side < 0 ? 0 : 1, v);
      }
    }
    for (let row = 0; row < segments; row += 1) {
      const a = base + row * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  return finishGeometry({
    positions,
    colors,
    indices,
    uvs,
    userData: {
      organ: 'bottlebrush-inflorescence',
      planes,
      segments,
      unitLength: 1,
    },
  });
}
