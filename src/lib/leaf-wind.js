import * as THREE from 'three';

const WIND_SHADER_VERSION = 'ez-tree-leaf-wind-v1';
const WIND_INSTALLATION = Symbol('ezTreeLeafWind');

const SIMPLEX_NOISE_3D = /* glsl */ `
// GLSL Simplex Noise 3D
// Source: https://github.com/ashima/webgl-noise
vec3 leafWindMod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 leafWindMod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 leafWindPermute(vec4 x) {
  return leafWindMod289(((x * 34.0) + 1.0) * x);
}

vec4 leafWindTaylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float leafWindSimplex3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = leafWindMod289(i);
  vec4 p = leafWindPermute(
    leafWindPermute(
      leafWindPermute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)
    ) + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 g0 = vec3(a0.xy, h.x);
  vec3 g1 = vec3(a0.zw, h.y);
  vec3 g2 = vec3(a1.xy, h.z);
  vec3 g3 = vec3(a1.zw, h.w);
  vec4 norm = leafWindTaylorInvSqrt(
    vec4(dot(g0, g0), dot(g1, g1), dot(g2, g2), dot(g3, g3))
  );
  g0 *= norm.x;
  g1 *= norm.y;
  g2 *= norm.z;
  g3 *= norm.w;

  vec4 m = max(
    0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)),
    0.0
  );
  m *= m;
  return 42.0 * dot(
    m * m,
    vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3))
  );
}
`;

const WIND_TRANSFORM_HELPERS = /* glsl */ `
vec3 leafWindCounterRotate(mat4 transformMatrix, vec3 direction) {
  vec3 axisX = normalize(transformMatrix[0].xyz);
  vec3 axisY = normalize(transformMatrix[1].xyz);
  vec3 axisZ = normalize(transformMatrix[2].xyz);
  return vec3(
    dot(axisX, direction),
    dot(axisY, direction),
    dot(axisZ, direction)
  );
}
`;

const WIND_BEFORE_PROJECT_VERTEX = /* glsl */ `
vec4 leafWindPhasePosition = vec4(transformed, 1.0);

#ifdef USE_BATCHING
  leafWindPhasePosition = batchingMatrix * leafWindPhasePosition;
#endif

#ifdef USE_INSTANCING
  leafWindPhasePosition = instanceMatrix * leafWindPhasePosition;
#endif

float leafWindOffset = 2.0 * 3.14 * leafWindSimplex3(
  leafWindPhasePosition.xyz / uWindScale
);
float leafWindSignal =
  0.5 * sin(uTime * uWindFrequency + leafWindOffset) +
  0.3 * sin(2.0 * uTime * uWindFrequency + 1.3 * leafWindOffset) +
  0.2 * sin(5.0 * uTime * uWindFrequency + 1.5 * leafWindOffset);

// EZ-Tree's baked leaf vertices all receive wind in tree-local space. Undo
// only each clone's rotation here so the normal Three.js projection path
// reapplies its scale and rotation without turning that shared wind direction.
// Keeping scale out of this inverse also preserves the original card-relative
// sway magnitude used by uniformly scaled instanced and batched leaves.
#if defined(USE_INSTANCING) || defined(USE_BATCHING)
  vec3 leafWindLocalStrength = uWindStrength;

  #ifdef USE_INSTANCING
    leafWindLocalStrength = leafWindCounterRotate(
      instanceMatrix,
      leafWindLocalStrength
    );
  #endif

  #ifdef USE_BATCHING
    leafWindLocalStrength = leafWindCounterRotate(
      batchingMatrix,
      leafWindLocalStrength
    );
  #endif

  transformed += uv.y * leafWindLocalStrength * leafWindSignal;
#else
  // Keep EZ-Tree's original baked-geometry path literally unchanged.
  transformed += uv.y * uWindStrength * leafWindSignal;
#endif

#include <project_vertex>
`;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function windVector(value) {
  if (value?.isVector3) return value.clone();
  return new THREE.Vector3(
    finite(value?.x, 0.5),
    finite(value?.y, 0),
    finite(value?.z, 0.5),
  );
}

function injectLeafWind(vertexShader) {
  if (
    !vertexShader.includes('void main() {') ||
    !vertexShader.includes('#include <project_vertex>')
  ) {
    throw new Error(
      'Leaf wind requires Three.js main and project shader chunks.',
    );
  }

  return /* glsl */ `
uniform float uTime;
uniform vec3 uWindStrength;
uniform float uWindFrequency;
uniform float uWindScale;
${vertexShader}`
    .replace(
      'void main() {',
      `${SIMPLEX_NOISE_3D}\n${WIND_TRANSFORM_HELPERS}\nvoid main() {`,
    )
    .replace('#include <project_vertex>', WIND_BEFORE_PROJECT_VERTEX);
}

/**
 * Shared controller for EZ-Tree's original multi-frequency simplex leaf wind.
 * It supports regular, batched and instanced leaves on one absolute clock.
 */
export class LeafWind {
  constructor({
    time = 0,
    strength = new THREE.Vector3(0.5, 0, 0.5),
    frequency = 0.5,
    scale = 70,
  } = {}) {
    this.uniforms = {
      uTime: { value: finite(time, 0) },
      uWindStrength: { value: windVector(strength) },
      uWindFrequency: { value: Math.max(0, finite(frequency, 0.5)) },
      uWindScale: { value: Math.max(1e-6, finite(scale, 70)) },
    };
  }

  get time() {
    return this.uniforms.uTime.value;
  }

  setTime(elapsedSeconds = 0) {
    this.uniforms.uTime.value = finite(elapsedSeconds, 0);
    return this;
  }

  advance(deltaSeconds = 0, elapsedSeconds) {
    return this.setTime(
      Number.isFinite(elapsedSeconds)
        ? elapsedSeconds
        : this.time + finite(deltaSeconds, 0),
    );
  }

  apply(material, { variant = 'surface', afterCompile } = {}) {
    if (!material?.isMaterial) {
      throw new TypeError('LeafWind.apply requires a Three.js material.');
    }
    if (material[WIND_INSTALLATION] === this) return material;
    if (material[WIND_INSTALLATION]) {
      throw new Error(
        'This material already has a different leaf wind controller.',
      );
    }

    const previousCompile = material.onBeforeCompile.bind(material);
    const previousCacheKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = injectLeafWind(shader.vertexShader);
      afterCompile?.(shader, renderer);
      // Keep the live renderer shader available for diagnostics without
      // leaking uniforms/source into GLTFExporter material extras.
      Object.defineProperty(material.userData, 'leafWindShader', {
        value: shader,
        configurable: true,
        enumerable: false,
        writable: true,
      });
    };
    material.customProgramCacheKey = () =>
      `${previousCacheKey()}|${WIND_SHADER_VERSION}|${variant}`;
    material[WIND_INSTALLATION] = this;
    material.needsUpdate = true;
    return material;
  }
}

/** Create shadow-pass materials driven by the exact same wind uniforms. */
export function createLeafWindShadowMaterials(
  wind,
  { map = null, alphaTest = 0, side = THREE.FrontSide, variant = 'leaf' } = {},
) {
  if (!(wind instanceof LeafWind)) {
    throw new TypeError('A LeafWind controller is required.');
  }

  const depth = new THREE.MeshDepthMaterial({
    name: `${variant}-wind-depth`,
    map,
    alphaTest,
    side,
    depthPacking: THREE.RGBADepthPacking,
  });
  const distance = new THREE.MeshDistanceMaterial({
    name: `${variant}-wind-distance`,
    map,
    alphaTest,
    side,
  });
  wind.apply(depth, { variant: `${variant}-depth` });
  wind.apply(distance, { variant: `${variant}-distance` });
  return { depth, distance };
}
