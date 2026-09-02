import * as THREE from 'three';

import { keyedRandom } from '../../keyed-random.js';
import { LeafWind } from '../../leaf-wind.js';

const THUJA_WIND_SHADER_VERSION = 'ez-plants-thuja-wind-v3';
// The library and WebGPU field are separate bundles. A versioned registry
// symbol lets the field recognize this known deformation without depending on
// shared module identity or attempting to translate an opaque GLSL callback.
const THUJA_WIND_INSTALLATION = Symbol.for(
  '@detoix/ez-plants/thuja-wind/installation/v1',
);
const FAMILY_CODE_COUNT = 63;
const PAYLOAD_LEVELS = 32;
const LOD_LEVELS = 3;
const BIOLOGICAL_PAYLOAD_COUNT = PAYLOAD_LEVELS * PAYLOAD_LEVELS;
const PAYLOAD_COUNT = BIOLOGICAL_PAYLOAD_COUNT * LOD_LEVELS;
const PACKED_STATE_COUNT = FAMILY_CODE_COUNT * PAYLOAD_COUNT;
// Keep the metadata depth axis smaller than the visible spray width so it can
// never enlarge InstancedMesh2's max-axis culling sphere. Earlier versions put
// the family in the integer portion and inflated that sphere by up to 63x.
// This interval still leaves ~27 Float32 values between adjacent states.
const PAYLOAD_BASE = 0.25;
const PAYLOAD_RANGE = 0.625;
// The volumetric inner shell has equal x/z scale and carries no packed spray
// metadata. Ratio 1 is deliberately outside the payload interval.
const SHELL_SENTINEL = 1;
const GOLDEN_RATIO_CONJUGATE = 0.61803398875;

export const THUJA_WIND_LOD_PROFILES = Object.freeze([
  Object.freeze({ crown: 1, flutter: 1 }),
  Object.freeze({ crown: 0.82, flutter: 0.46 }),
  Object.freeze({ crown: 0.62, flutter: 0 }),
]);

/** Return the live Thuja wind controller installed on a material, if any. */
export function thujaWindForMaterial(material) {
  return material?.[THUJA_WIND_INSTALLATION] ?? null;
}

const THUJA_WIND_HELPERS = /* glsl */ `
vec3 thujaWindCounterRotate(mat4 transformMatrix, vec3 direction) {
  vec3 axisX = normalize(transformMatrix[0].xyz);
  vec3 axisY = normalize(transformMatrix[1].xyz);
  vec3 axisZ = normalize(transformMatrix[2].xyz);
  return vec3(
    dot(axisX, direction),
    dot(axisY, direction),
    dot(axisZ, direction)
  );
}

void thujaWindDecode(
  float packedValue,
  out float familyCode,
  out float exposure,
  out float crownHeight,
  out float lodLevel
) {
  if (abs(packedValue - ${SHELL_SENTINEL.toFixed(1)}) < 0.00001) {
    familyCode = 1.0;
    exposure = 0.0;
    crownHeight = 0.0;
    lodLevel = 0.0;
    return;
  }
  float packedState = floor(
    clamp(
      (packedValue - ${PAYLOAD_BASE.toFixed(6)}) / ${PAYLOAD_RANGE.toFixed(6)},
      0.0,
      0.999999
    ) * ${PACKED_STATE_COUNT.toFixed(1)}
  );
  familyCode = floor(packedState / ${PAYLOAD_COUNT.toFixed(1)}) + 1.0;
  float payload = packedState -
    (familyCode - 1.0) * ${PAYLOAD_COUNT.toFixed(1)};
  lodLevel = floor(payload / ${BIOLOGICAL_PAYLOAD_COUNT.toFixed(1)});
  float biologicalPayload = payload -
    lodLevel * ${BIOLOGICAL_PAYLOAD_COUNT.toFixed(1)};
  float heightCode = floor(
    biologicalPayload / ${PAYLOAD_LEVELS.toFixed(1)}
  );
  float exposureCode = biologicalPayload -
    heightCode * ${PAYLOAD_LEVELS.toFixed(1)};
  crownHeight = heightCode / ${(PAYLOAD_LEVELS - 1).toFixed(1)};
  exposure = exposureCode / ${(PAYLOAD_LEVELS - 1).toFixed(1)};
}
`;

// Depth-scale metadata must not leak into lighting. Three's regular instanced
// normal path quite correctly accounts for non-uniform scale, but our z scale
// is a data channel rather than geometry. Restore it to the visible x width
// before transforming authored spray normals and tangents.
const THUJA_WIND_NORMAL_VERTEX = /* glsl */ `
vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
  vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
  mat3 bm = mat3(batchingMatrix);
  transformedNormal /= vec3(
    dot(bm[0], bm[0]),
    dot(bm[1], bm[1]),
    dot(bm[2], bm[2])
  );
  transformedNormal = bm * transformedNormal;
  #ifdef USE_TANGENT
    transformedTangent = bm * transformedTangent;
  #endif
#endif
#if defined(USE_INSTANCING) || defined(USE_INSTANCING_INDIRECT)
  mat3 im = mat3(instanceMatrix);
  float thujaNormalWidth = max(length(im[0]), 0.000001);
  float thujaNormalDepth = max(length(im[2]), 0.000001);
  im[2] = im[2] * (thujaNormalWidth / thujaNormalDepth);
  transformedNormal /= vec3(
    dot(im[0], im[0]),
    dot(im[1], im[1]),
    dot(im[2], im[2])
  );
  transformedNormal = im * transformedNormal;
  #ifdef USE_TANGENT
    transformedTangent = im * transformedTangent;
  #endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
  transformedNormal = -transformedNormal;
#endif
#ifdef USE_TANGENT
  transformedTangent = (
    modelViewMatrix * vec4(transformedTangent, 0.0)
  ).xyz;
  #ifdef FLIP_SIDED
    transformedTangent = -transformedTangent;
  #endif
#endif
`;

// The deformation is deliberately installed immediately before projection.
// At this point `transformed` has morph/displacement applied, while the code
// can still move the final plant-local position after its spray instance
// matrix. Doing the bend here keeps its amplitude in metres rather than
// accidentally multiplying it by the tiny spray scale.
const THUJA_WIND_PROJECT_VERTEX = /* glsl */ `
vec4 thujaWindPosition = vec4(transformed, 1.0);
vec4 thujaWindOrigin = vec4(0.0, 0.0, 0.0, 1.0);

#ifdef USE_BATCHING
  thujaWindPosition = batchingMatrix * thujaWindPosition;
  thujaWindOrigin = batchingMatrix * thujaWindOrigin;
#endif

float thujaWindPacked = 1.0;
#if defined(USE_INSTANCING) || defined(USE_INSTANCING_INDIRECT)
  float thujaWindWidthScale = max(length(instanceMatrix[0].xyz), 0.000001);
  thujaWindPacked =
    length(instanceMatrix[2].xyz) / thujaWindWidthScale;
  thujaWindPosition = instanceMatrix * thujaWindPosition;
  thujaWindOrigin = instanceMatrix * thujaWindOrigin;
#endif

float thujaWindFamilyCode;
float thujaWindExposure;
float thujaWindCrownHeight;
float thujaWindLODLevel;
thujaWindDecode(
  thujaWindPacked,
  thujaWindFamilyCode,
  thujaWindExposure,
  thujaWindCrownHeight,
  thujaWindLODLevel
);
vec2 thujaWindLODResponse = uThujaLODNear;
if (thujaWindLODLevel > 0.5) {
  thujaWindLODResponse = uThujaLODMiddle;
}
if (thujaWindLODLevel > 1.5) {
  thujaWindLODResponse = uThujaLODFar;
}

// Packed origin height remains stable in a baked field. The small vertex
// delta restores the continuous bend along each frond rather than translating
// the entire spray as a rigid card.
float thujaWindVertexRise = max(
  0.0,
  (thujaWindPosition.y - thujaWindOrigin.y) / uThujaCrownHeight
);
float thujaWindHeight = clamp(
  thujaWindCrownHeight + thujaWindVertexRise,
  0.0,
  1.0
);
float thujaWindHeightGate = smoothstep(0.08, 0.94, thujaWindHeight);
float thujaWindExposureGate = mix(
  0.16,
  1.0,
  thujaWindExposure * thujaWindExposure
);
float thujaWindMobility = thujaWindHeightGate * thujaWindExposureGate;
float thujaWindStiffness = clamp(1.0 - thujaWindMobility, 0.1, 0.98);
thujaWindMobility = 1.0 - thujaWindStiffness;

float thujaWindFamilyPhase = 6.28318530718 * fract(
  thujaWindFamilyCode * ${GOLDEN_RATIO_CONJUGATE.toFixed(11)}
);
float thujaWindGlobalSignal =
  0.64 * sin(uTime * uWindFrequency) +
  0.24 * sin(uTime * uWindFrequency * 0.57 + 1.9) +
  0.12 * sin(uTime * uWindFrequency * 1.71 + 0.4);
float thujaWindFamilySignal = sin(
  uTime * uWindFrequency * 1.19 + thujaWindFamilyPhase
);

vec3 thujaWindLocalVector = thujaWindCounterRotate(
  modelMatrix,
  uWindStrength
);
float thujaWindMagnitude = length(thujaWindLocalVector.xz);
vec2 thujaWindDirection = thujaWindMagnitude > 0.000001
  ? thujaWindLocalVector.xz / thujaWindMagnitude
  : vec2(1.0, 0.0);
vec2 thujaWindCrossDirection = vec2(
  -thujaWindDirection.y,
  thujaWindDirection.x
);

float thujaWindBendWeight =
  thujaWindHeight * thujaWindHeight *
  thujaWindMobility * thujaWindLODResponse.x;
// The woody scaffold is deliberately not shader-deformed. Pin every spray at
// its attachment and let the shared crown signal flex its distal surface; this
// keeps foliage and bark connected while preserving coherent family motion.
float thujaWindAttachmentWeight = smoothstep(0.0, 0.72, uv.y);
thujaWindBendWeight *= thujaWindAttachmentWeight;
float thujaWindCrownSignal =
  0.82 * thujaWindGlobalSignal +
  mix(0.08, 0.24, thujaWindExposure) * thujaWindFamilySignal;
thujaWindPosition.xz +=
  thujaWindDirection * thujaWindMagnitude *
  thujaWindBendWeight * thujaWindCrownSignal;
thujaWindPosition.xz +=
  thujaWindCrossDirection * thujaWindMagnitude * 0.16 *
  thujaWindBendWeight * thujaWindFamilySignal;

// Scale-leaf branchlets flutter only at their flexible distal edge. The far
// LOD removes this high-frequency term entirely; its silhouette still follows
// the inexpensive crown and scaffold signals above.
float thujaWindTipWeight = smoothstep(0.38, 1.0, uv.y);
float thujaWindFlutterSignal =
  sin(
    uTime * uThujaFlutterFrequency +
    thujaWindFamilyPhase * 1.73 +
    uv.y * 2.4
  ) *
  sin(uTime * uThujaFlutterFrequency * 0.43 + thujaWindFamilyPhase);
float thujaWindFlutter =
  uThujaFlutterStrength * thujaWindLODResponse.y *
  thujaWindTipWeight * thujaWindHeightGate *
  thujaWindExposure * thujaWindExposure * thujaWindFlutterSignal;
thujaWindPosition.xz += thujaWindCrossDirection * thujaWindFlutter;
thujaWindPosition.y += abs(thujaWindFlutter) * 0.12;

vec4 mvPosition = modelViewMatrix * thujaWindPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// Shadow coordinates, distance-shadow depth and environment mapping all read
// `worldPosition` after projection. Reusing the already-deformed position here
// prevents shadows from lagging behind the moving surface.
const THUJA_WIND_WORLD_POSITION_VERTEX = /* glsl */ `
#if defined(USE_ENVMAP) || defined(DISTANCE) || defined(USE_SHADOWMAP) || defined(USE_TRANSMISSION) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = modelMatrix * thujaWindPosition;
#endif
`;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value, 0), 0, 1);
}

function quantize01(value) {
  return Math.round(clamp01(value) * (PAYLOAD_LEVELS - 1));
}

function normaliseFamilyCode(value) {
  if (!Number.isInteger(value) || value < 1 || value > FAMILY_CODE_COUNT) {
    throw new RangeError(
      `Thuja wind familyCode must be an integer from 1 to ${FAMILY_CODE_COUNT}.`,
    );
  }
  return value;
}

function normaliseLODLevel(value) {
  if (!Number.isInteger(value) || value < 0 || value >= LOD_LEVELS) {
    throw new RangeError(
      `Thuja wind lodLevel must be an integer from 0 to ${LOD_LEVELS - 1}.`,
    );
  }
  return value;
}

function normaliseLODProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new TypeError('Thuja wind needs at least one LOD profile.');
  }
  return Object.freeze(
    profiles.map((profile, index) => {
      const crown = finite(profile?.crown, NaN);
      const flutter = finite(profile?.flutter, NaN);
      if (
        !Number.isFinite(crown) ||
        !Number.isFinite(flutter) ||
        crown < 0 ||
        flutter < 0
      ) {
        throw new RangeError(
          `Thuja wind LOD profile ${index} needs non-negative crown and flutter values.`,
        );
      }
      return Object.freeze({ crown, flutter });
    }),
  );
}

function injectThujaWind(vertexShader) {
  if (
    !vertexShader.includes('void main() {') ||
    !vertexShader.includes('#include <project_vertex>')
  ) {
    throw new Error(
      'Thuja wind requires Three.js main and project shader chunks.',
    );
  }

  return /* glsl */ `
uniform float uTime;
uniform vec3 uWindStrength;
uniform float uWindFrequency;
uniform float uThujaCrownHeight;
uniform float uThujaFlutterStrength;
uniform float uThujaFlutterFrequency;
uniform vec2 uThujaLODNear;
uniform vec2 uThujaLODMiddle;
uniform vec2 uThujaLODFar;
${vertexShader}`
    .replace('void main() {', `${THUJA_WIND_HELPERS}\nvoid main() {`)
    .replace('#include <defaultnormal_vertex>', THUJA_WIND_NORMAL_VERTEX)
    .replace('#include <project_vertex>', THUJA_WIND_PROJECT_VERTEX)
    .replace('#include <worldpos_vertex>', THUJA_WIND_WORLD_POSITION_VERTEX);
}

/**
 * Pack one scaffold family, crown height and exposure into a positive scale
 * ratio. A planar spray can carry this in scale.z / scale.x because all of its
 * positions have z=0. The ratio survives baking and uniform field transforms.
 */
export function packThujaWindMetadata({
  familyCode,
  crownFraction = 0,
  exposure = 0,
  lodLevel = 0,
} = {}) {
  const family = normaliseFamilyCode(familyCode);
  const lod = normaliseLODLevel(lodLevel);
  const heightCode = quantize01(crownFraction);
  const exposureCode = quantize01(exposure);
  const payload =
    lod * BIOLOGICAL_PAYLOAD_COUNT + heightCode * PAYLOAD_LEVELS + exposureCode;
  const packedState = (family - 1) * PAYLOAD_COUNT + payload;
  return (
    PAYLOAD_BASE + ((packedState + 0.5) / PACKED_STATE_COUNT) * PAYLOAD_RANGE
  );
}

/** CPU mirror of the shader's scale-ratio decoder. */
export function decodeThujaWindMetadata(packedValue) {
  if (
    Number.isFinite(packedValue) &&
    Math.abs(packedValue - SHELL_SENTINEL) < 1e-5
  ) {
    return Object.freeze({
      familyCode: 1,
      crownFraction: 0,
      exposure: 0,
      lodLevel: 0,
      phase: GOLDEN_RATIO_CONJUGATE % 1,
      packed: packedValue,
    });
  }
  if (
    !Number.isFinite(packedValue) ||
    packedValue < PAYLOAD_BASE ||
    packedValue >= PAYLOAD_BASE + PAYLOAD_RANGE
  ) {
    throw new RangeError(
      `Packed Thuja wind metadata must be in [${PAYLOAD_BASE}, ${
        PAYLOAD_BASE + PAYLOAD_RANGE
      }) or the shell sentinel ${SHELL_SENTINEL}.`,
    );
  }
  const packedState = Math.min(
    PACKED_STATE_COUNT - 1,
    Math.floor(
      THREE.MathUtils.clamp(
        (packedValue - PAYLOAD_BASE) / PAYLOAD_RANGE,
        0,
        0.999999,
      ) * PACKED_STATE_COUNT,
    ),
  );
  const familyCode = Math.floor(packedState / PAYLOAD_COUNT) + 1;
  normaliseFamilyCode(familyCode);
  const payload = packedState - (familyCode - 1) * PAYLOAD_COUNT;
  const lodLevel = Math.floor(payload / BIOLOGICAL_PAYLOAD_COUNT);
  const biologicalPayload = payload - lodLevel * BIOLOGICAL_PAYLOAD_COUNT;
  const heightCode = Math.floor(biologicalPayload / PAYLOAD_LEVELS);
  const exposureCode = biologicalPayload - heightCode * PAYLOAD_LEVELS;
  return Object.freeze({
    familyCode,
    crownFraction: heightCode / (PAYLOAD_LEVELS - 1),
    exposure: exposureCode / (PAYLOAD_LEVELS - 1),
    lodLevel,
    phase: (familyCode * GOLDEN_RATIO_CONJUGATE) % 1,
    packed: packedValue,
  });
}

/**
 * Derive stable wind metadata for one spray. All sprays carrying the same
 * `familyId` receive exactly the same low-frequency scaffold phase.
 */
export function createThujaWindMetadata({
  seed = 'thuja',
  familyId,
  crownFraction = 0,
  shellFraction = 0,
  exposure,
  lodLevel = 0,
} = {}) {
  if (familyId == null || familyId === '') {
    throw new TypeError('Thuja wind metadata requires a scaffold familyId.');
  }
  const height = clamp01(crownFraction);
  const shell = clamp01(shellFraction);
  const resolvedExposure = clamp01(
    Number.isFinite(exposure) ? exposure : shell * 0.78 + height * 0.22,
  );
  const familyCode =
    1 +
    Math.floor(
      // Put the varying identity before the salt. FNV-style hashes avalanche
      // on the keys that follow, whereas sequential IDs in the final key can
      // otherwise remain numerically adjacent before quantisation.
      keyedRandom(seed, familyId, 'thuja-wind-family') * FAMILY_CODE_COUNT,
    );
  const packed = packThujaWindMetadata({
    familyCode,
    crownFraction: height,
    exposure: resolvedExposure,
    lodLevel,
  });
  return decodeThujaWindMetadata(packed);
}

/** The z scale that embeds metadata without moving a planar spray vertex. */
export function thujaWindDepthScale(widthScale, metadata) {
  const width = finite(widthScale, NaN);
  const packed = typeof metadata === 'number' ? metadata : metadata?.packed;
  if (!(width > 0)) {
    throw new RangeError('Thuja wind widthScale must be greater than zero.');
  }
  // Validate through the public decoder before the ratio reaches a matrix.
  decodeThujaWindMetadata(packed);
  return width * packed;
}

/** Decode metadata from a composed affine instance matrix. */
export function readThujaWindMetadataFromMatrix(matrix) {
  if (!matrix?.isMatrix4) {
    throw new TypeError('Expected a THREE.Matrix4 carrying Thuja wind data.');
  }
  const elements = matrix.elements;
  const width = Math.hypot(elements[0], elements[1], elements[2]);
  const depth = Math.hypot(elements[8], elements[9], elements[10]);
  if (!(width > 1e-8)) {
    throw new RangeError('Cannot decode Thuja wind from a zero-width matrix.');
  }
  return decodeThujaWindMetadata(depth / width);
}

/** Fail early if depth-scale packing would alter visible spray positions. */
export function assertThujaWindPlanarGeometry(geometry, epsilon = 1e-6) {
  if (!geometry?.isBufferGeometry) {
    throw new TypeError('Expected a THREE.BufferGeometry for Thuja wind.');
  }
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('Thuja wind planarity epsilon must be non-negative.');
  }
  const positions = geometry.getAttribute('position');
  if (!positions) {
    throw new TypeError('Thuja wind geometry needs a position attribute.');
  }
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getZ(index)) > epsilon) {
      throw new RangeError(
        'Thuja wind depth packing requires every spray position to have z=0.',
      );
    }
  }
  return geometry;
}

/**
 * Hierarchical wind for flattened Thuja scale-spray foliage.
 *
 * It subclasses LeafWind only to retain the shared absolute-time and material
 * APIs. The shader is species-specific: a low-frequency whole-crown bend, a
 * coherent scaffold-family signal, and restrained distal branchlet flutter.
 */
export class ThujaWind extends LeafWind {
  constructor({
    time = 0,
    strength = new THREE.Vector3(0.055, 0, 0.025),
    frequency = 0.38,
    crownHeight = 4.2,
    flutterStrength = 0.008,
    flutterFrequency = 2.4,
    lod = 0,
    lodProfiles = THUJA_WIND_LOD_PROFILES,
    enabled = true,
  } = {}) {
    super({ time, strength, frequency, scale: 1, enabled });
    this._lodProfiles = normaliseLODProfiles(lodProfiles);
    this._lod = -1;
    this.uniforms.uThujaCrownHeight = {
      value: Math.max(1e-6, finite(crownHeight, 4.2)),
    };
    this.uniforms.uThujaFlutterStrength = {
      value: Math.max(0, finite(flutterStrength, 0.008)),
    };
    this.uniforms.uThujaFlutterFrequency = {
      value: Math.max(0, finite(flutterFrequency, 2.4)),
    };
    const profile = (index) =>
      this._lodProfiles[Math.min(index, this._lodProfiles.length - 1)];
    this.uniforms.uThujaLODNear = {
      value: new THREE.Vector2(profile(0).crown, profile(0).flutter),
    };
    this.uniforms.uThujaLODMiddle = {
      value: new THREE.Vector2(profile(1).crown, profile(1).flutter),
    };
    this.uniforms.uThujaLODFar = {
      value: new THREE.Vector2(profile(2).crown, profile(2).flutter),
    };
    this.setLOD(lod);
  }

  get lod() {
    return this._lod;
  }

  setLOD(level = 0) {
    if (!Number.isInteger(level) || level < 0 || level >= LOD_LEVELS) {
      throw new RangeError(
        `Thuja wind LOD must be an integer from 0 to ${LOD_LEVELS - 1}.`,
      );
    }
    this._lod = level;
    return this;
  }

  setCrownHeight(height) {
    if (!Number.isFinite(height) || height <= 0) {
      throw new RangeError(
        'Thuja wind crown height must be greater than zero.',
      );
    }
    this.uniforms.uThujaCrownHeight.value = height;
    return this;
  }

  apply(material, { variant = 'surface', afterCompile } = {}) {
    if (!material?.isMaterial) {
      throw new TypeError('ThujaWind.apply requires a Three.js material.');
    }
    if (!this.enabled) return material;
    if (material[THUJA_WIND_INSTALLATION] === this) return material;
    if (material[THUJA_WIND_INSTALLATION]) {
      throw new Error(
        'This material already has a different Thuja wind controller.',
      );
    }

    const previousCompile = material.onBeforeCompile.bind(material);
    const previousCacheKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = injectThujaWind(shader.vertexShader);
      afterCompile?.(shader, renderer);
    };
    material.customProgramCacheKey = () =>
      `${previousCacheKey()}|${THUJA_WIND_SHADER_VERSION}|${variant}`;
    Object.defineProperty(material, THUJA_WIND_INSTALLATION, {
      configurable: true,
      value: this,
    });
    material.needsUpdate = true;
    return material;
  }
}
