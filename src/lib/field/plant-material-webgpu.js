import * as THREE from 'three';
import {
  Fn,
  abs,
  attribute,
  clamp,
  dot,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalViewGeometry,
  normalize,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { setWebGPUInstancePositionNode } from '@detoix/instanced-mesh/webgpu';

import {
  keepsAuthoredNormalsOnBackFaces,
  leafBackfaceNormalPolicyForMaterial,
} from '../leaf-material.js';
import {
  leafWindForMaterial,
  leafWindMetadataForMaterial,
} from '../leaf-wind.js';
import {
  instanceDeformationForMaterial,
  MAGNUS_HEAD_DEFORMATION,
} from '../instance-deformation.js';
import {
  readThujaWindMetadataFromMatrix,
  thujaWindForMaterial,
} from '../plants/thuja/wind.js';

const GOLDEN_RATIO_CONJUGATE = 0.61803398875;

// This is the same Ashima 3D simplex function used by leaf-wind.js, expressed
// as nodes rather than a second, approximate wind model. Keeping the signal
// identical matters when the same plant is shown in a WebGL editor and in a
// WebGPU field: only the backend should change, not its motion.
const permute = Fn(([value]) => mod(value.mul(value).mul(34).add(value), 289), {
  value: 'vec4',
  return: 'vec4',
});

const simplex3 = Fn(
  ([value]) => {
    const c = vec2(1 / 6, 1 / 3);
    const d = vec4(0, 0.5, 1, 2);
    const i = floor(value.add(dot(value, c.yyy))).toVar();
    const x0 = value.sub(i).add(dot(i, c.xxx));
    const g = step(x0.yzx, x0.xyz);
    const l = vec3(1).sub(g);
    const i1 = min(g.xyz, l.zxy);
    const i2 = max(g.xyz, l.zxy);
    const x1 = x0.sub(i1).add(c.xxx);
    const x2 = x0.sub(i2).add(c.yyy);
    const x3 = x0.sub(d.yyy);

    i.assign(mod(i, 289));
    const p = permute(
      permute(
        permute(i.z.add(vec4(0, i1.z, i2.z, 1)))
          .add(i.y)
          .add(vec4(0, i1.y, i2.y, 1)),
      )
        .add(i.x)
        .add(vec4(0, i1.x, i2.x, 1)),
    );

    const ns = d.wyz.mul(0.142857142857).sub(d.xzx);
    const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49));
    const xIndex = floor(j.mul(ns.z));
    const yIndex = floor(j.sub(xIndex.mul(7)));
    const x = xIndex.mul(ns.x).add(ns.yyyy);
    const y = yIndex.mul(ns.x).add(ns.yyyy);
    const h = vec4(1).sub(abs(x)).sub(abs(y));
    const b0 = vec4(x.xy, y.xy);
    const b1 = vec4(x.zw, y.zw);
    const s0 = floor(b0).mul(2).add(1);
    const s1 = floor(b1).mul(2).add(1);
    const sh = step(h, vec4(0)).negate();
    const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy));
    const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww));

    const g0 = vec3(a0.xy, h.x).toVar();
    const g1 = vec3(a0.zw, h.y).toVar();
    const g2 = vec3(a1.xy, h.z).toVar();
    const g3 = vec3(a1.zw, h.w).toVar();
    const squaredLengths = vec4(
      dot(g0, g0),
      dot(g1, g1),
      dot(g2, g2),
      dot(g3, g3),
    );
    const norm = vec4(1.79284291400159).sub(
      squaredLengths.mul(0.85373472095314),
    );
    g0.mulAssign(norm.x);
    g1.mulAssign(norm.y);
    g2.mulAssign(norm.z);
    g3.mulAssign(norm.w);

    const m = max(
      vec4(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))),
      0,
    ).toVar();
    m.mulAssign(m);
    return dot(
      m.mul(m),
      vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3)),
    ).mul(42);
  },
  { value: 'vec3', return: 'float' },
);

function liveUniform(initialValue, read) {
  return uniform(initialValue).onRenderUpdate(read);
}

function createLeafWindPositionFactory(wind) {
  const time = liveUniform(wind.time, () => wind.time);
  const strength = liveUniform(
    wind.uniforms.uWindStrength.value,
    () => wind.uniforms.uWindStrength.value,
  );
  const frequency = liveUniform(
    wind.uniforms.uWindFrequency.value,
    () => wind.uniforms.uWindFrequency.value,
  );
  const scale = liveUniform(
    wind.uniforms.uWindScale.value,
    () => wind.uniforms.uWindScale.value,
  );

  return ({ positionNode, instanceMatrix }) => {
    const phasePosition = instanceMatrix.mul(vec4(positionNode, 1)).xyz;
    const offset = simplex3(phasePosition.div(scale)).mul(2 * 3.14);
    const clock = time.mul(frequency);
    const signal = sin(clock.add(offset))
      .mul(0.5)
      .add(sin(clock.mul(2).add(offset.mul(1.3))).mul(0.3))
      .add(sin(clock.mul(5).add(offset.mul(1.5))).mul(0.2));

    // Counter-rotate the world-coherent wind through the normalized columns of
    // the full per-organ matrix. This exactly mirrors leafWindCounterRotate in
    // the GLSL path: instance scale does not inflate the local sway vector.
    const axisX = normalize(instanceMatrix.element(0).xyz);
    const axisY = normalize(instanceMatrix.element(1).xyz);
    const axisZ = normalize(instanceMatrix.element(2).xyz);
    const localStrength = vec3(
      dot(axisX, strength),
      dot(axisY, strength),
      dot(axisZ, strength),
    );

    return positionNode.add(localStrength.mul(signal).mul(uv().y));
  };
}

function createThujaWindPositionFactory(wind) {
  const time = liveUniform(wind.time, () => wind.time);
  const strength = liveUniform(
    wind.uniforms.uWindStrength.value,
    () => wind.uniforms.uWindStrength.value,
  );
  const frequency = liveUniform(
    wind.uniforms.uWindFrequency.value,
    () => wind.uniforms.uWindFrequency.value,
  );
  const crownHeight = liveUniform(
    wind.uniforms.uThujaCrownHeight.value,
    () => wind.uniforms.uThujaCrownHeight.value,
  );
  const flutterStrength = liveUniform(
    wind.uniforms.uThujaFlutterStrength.value,
    () => wind.uniforms.uThujaFlutterStrength.value,
  );
  const flutterFrequency = liveUniform(
    wind.uniforms.uThujaFlutterFrequency.value,
    () => wind.uniforms.uThujaFlutterFrequency.value,
  );
  const lodNear = liveUniform(
    wind.uniforms.uThujaLODNear.value,
    () => wind.uniforms.uThujaLODNear.value,
  );
  const lodMiddle = liveUniform(
    wind.uniforms.uThujaLODMiddle.value,
    () => wind.uniforms.uThujaLODMiddle.value,
  );
  const lodFar = liveUniform(
    wind.uniforms.uThujaLODFar.value,
    () => wind.uniforms.uThujaLODFar.value,
  );

  return ({ positionNode, instanceMatrix }) => {
    // prepareWebGPUPlantInstance stores the decoded biological channels in the
    // unused affine bottom row after restoring the metadata-bearing z scale.
    const familyCode = instanceMatrix.element(0).w;
    const crownFraction = instanceMatrix.element(1).w;
    const lodAndExposure = instanceMatrix.element(2).w;
    const lodLevel = floor(lodAndExposure.div(2));
    const exposure = lodAndExposure.sub(lodLevel.mul(2));

    const positionInField = instanceMatrix.mul(vec4(positionNode, 1)).xyz;
    const originInField = instanceMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const vertexRise = max(
      0,
      positionInField.y.sub(originInField.y).div(crownHeight),
    );
    const height = clamp(crownFraction.add(vertexRise), 0, 1);
    const heightGate = smoothstep(0.08, 0.94, height);
    const exposureGate = mix(0.16, 1, exposure.mul(exposure));
    const mobility = max(0.02, min(0.9, heightGate.mul(exposureGate)));

    const familyPhase = fract(familyCode.mul(GOLDEN_RATIO_CONJUGATE)).mul(
      Math.PI * 2,
    );
    const clock = time.mul(frequency);
    const globalSignal = sin(clock)
      .mul(0.64)
      .add(sin(clock.mul(0.57).add(1.9)).mul(0.24))
      .add(sin(clock.mul(1.71).add(0.4)).mul(0.12));
    const familySignal = sin(clock.mul(1.19).add(familyPhase));

    const windMagnitude = length(strength.xz);
    const windDirection = strength.xz.div(max(windMagnitude, 0.000001));
    const crossDirection = vec2(windDirection.y.negate(), windDirection.x);
    const middleGate = step(0.5, lodLevel);
    const farGate = step(1.5, lodLevel);
    const crownResponse = mix(
      mix(lodNear.x, lodMiddle.x, middleGate),
      lodFar.x,
      farGate,
    );
    const flutterResponse = mix(
      mix(lodNear.y, lodMiddle.y, middleGate),
      lodFar.y,
      farGate,
    );

    const attachmentWeight = smoothstep(0, 0.72, uv().y);
    const bendWeight = height
      .mul(height)
      .mul(mobility)
      .mul(crownResponse)
      .mul(attachmentWeight);
    const crownSignal = globalSignal
      .mul(0.82)
      .add(mix(0.08, 0.24, exposure).mul(familySignal));
    const bend = windMagnitude.mul(bendWeight).mul(crownSignal);
    const crossBend = windMagnitude.mul(0.16).mul(bendWeight).mul(familySignal);

    const tipWeight = smoothstep(0.38, 1, uv().y);
    const flutterSignal = sin(
      time
        .mul(flutterFrequency)
        .add(familyPhase.mul(1.73))
        .add(uv().y.mul(2.4)),
    ).mul(sin(time.mul(flutterFrequency).mul(0.43).add(familyPhase)));
    const flutter = flutterStrength
      .mul(flutterResponse)
      .mul(tipWeight)
      .mul(heightGate)
      .mul(exposure)
      .mul(exposure)
      .mul(flutterSignal);
    const lateral = crossBend.add(flutter);
    const displacement = vec3(
      windDirection.x.mul(bend).add(crossDirection.x.mul(lateral)),
      abs(flutter).mul(0.12),
      windDirection.y.mul(bend).add(crossDirection.y.mul(lateral)),
    );

    // The WebGL path bends after the organ matrix, in plant-local metres. TSL
    // supplies a pre-instance position node, so counter-transform that desired
    // displacement through the orthogonal matrix columns before returning it.
    const columnX = instanceMatrix.element(0).xyz;
    const columnY = instanceMatrix.element(1).xyz;
    const columnZ = instanceMatrix.element(2).xyz;
    const scaleX = max(length(columnX), 0.000001);
    const scaleY = max(length(columnY), 0.000001);
    const scaleZ = max(length(columnZ), 0.000001);
    const localDisplacement = vec3(
      dot(columnX.div(scaleX), displacement).div(scaleX),
      dot(columnY.div(scaleY), displacement).div(scaleY),
      dot(columnZ.div(scaleZ), displacement).div(scaleZ),
    );
    return positionNode.add(localDisplacement);
  };
}

function deformMagnusHead({ positionNode, instanceMatrix }) {
  const headWeight = attribute('magnusHead', 'float');
  const rayWeight = attribute('magnusRay', 'float');
  // PlantField's WebGPU instance adapter stores the two values in the unused
  // bottom row of an otherwise affine matrix. The indexed-instancing backend
  // consumes only the transformed xyz, so these channels do not alter the
  // placement transform itself.
  const headVisibility = instanceMatrix.element(0).w;
  const rayVisibility = instanceMatrix.element(1).w;
  const headScale = mix(1, headVisibility, headWeight);
  const rayScale = mix(1, mix(0.34, 1, rayVisibility), rayWeight);
  return vec3(
    positionNode.x.mul(headScale).mul(rayScale),
    mix(positionNode.y, 1, headWeight.mul(headVisibility.oneMinus())),
    positionNode.z.mul(headScale).mul(rayScale),
  );
}

function createPositionFactory(wind, deformation) {
  const windFactory = wind ? createLeafWindPositionFactory(wind) : null;
  return (context) => {
    let positionNode = context.positionNode;
    if (deformation?.kind === MAGNUS_HEAD_DEFORMATION) {
      positionNode = deformMagnusHead({ ...context, positionNode });
    }
    return windFactory
      ? windFactory({ ...context, positionNode })
      : positionNode;
  };
}

/**
 * Move Magnus's packed visibility values into matrix metadata for WebGPU.
 * Surface tint is restored before the color enters Three's material graph.
 */
export function prepareWebGPUPlantInstance(material, matrix, color) {
  const thujaWind = thujaWindForMaterial(material);
  if (thujaWind) {
    const metadata = readThujaWindMetadataFromMatrix(matrix);
    const elements = matrix.elements;
    const width = Math.hypot(elements[0], elements[1], elements[2]);
    const depth = Math.hypot(elements[8], elements[9], elements[10]);
    const restore = width / depth;
    elements[8] *= restore;
    elements[9] *= restore;
    elements[10] *= restore;
    elements[3] = metadata.familyCode;
    elements[7] = metadata.crownFraction;
    elements[11] = metadata.lodLevel * 2 + metadata.exposure;
    return;
  }

  const deformation = instanceDeformationForMaterial(material);
  if (!deformation) return;
  if (deformation.kind !== MAGNUS_HEAD_DEFORMATION) {
    throw new Error(`Unsupported instance deformation: ${deformation.kind}.`);
  }
  if (!color) {
    throw new Error('Magnus head deformation requires an instance color.');
  }

  matrix.elements[3] = Math.floor(color.r * 0.5);
  matrix.elements[7] = Math.floor(color.b * 0.5) / 255;
  color.r %= 2;
  color.b %= 2;
}

/**
 * Clone one plant material into a clean WebGPU/TSL source material.
 *
 * Source plants remain ordinary Three.js/WebGL renderers. Their known shader
 * semantics are carried across explicitly: leaf wind and Thuja's hierarchical
 * crown motion become instance-aware TSL position stages, and rounded
 * card/floret normals retain their authored direction on back faces. Unknown
 * GLSL hooks are rejected so the WebGPU field can never appear to work while
 * silently dropping an effect.
 */
export function prepareWebGPUPlantMaterial(material) {
  if (!material?.isMaterial) {
    throw new TypeError('prepareWebGPUPlantMaterial requires a material.');
  }

  const wind = leafWindForMaterial(material);
  const thujaWind = thujaWindForMaterial(material);
  const windMetadata = leafWindMetadataForMaterial(material);
  const authoredNormals = keepsAuthoredNormalsOnBackFaces(material);
  const normalPolicy = leafBackfaceNormalPolicyForMaterial(material);
  const deformation = instanceDeformationForMaterial(material);
  const hasGLSLHook =
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
  if (hasGLSLHook && !wind && !thujaWind && !authoredNormals && !deformation) {
    throw new Error(
      `Material "${material.name || material.type}" has an unsupported GLSL ` +
        'onBeforeCompile customization. Port it to TSL before using WebGPU.',
    );
  }
  if (windMetadata?.hasAfterCompile && normalPolicy === null) {
    throw new Error(
      `Material "${material.name || material.type}" combines leaf wind with ` +
        'an unsupported GLSL customization. Port that customization to TSL.',
    );
  }
  if (deformation && deformation.kind !== MAGNUS_HEAD_DEFORMATION) {
    throw new Error(
      `Material "${material.name || material.type}" has an unsupported ` +
        `instance deformation: ${deformation.kind}.`,
    );
  }

  const prepared = material.clone();
  // Material.clone currently omits callbacks, but make the compatibility
  // boundary explicit rather than relying on that undocumented detail.
  prepared.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
  prepared.customProgramCacheKey =
    THREE.Material.prototype.customProgramCacheKey;

  if (authoredNormals) prepared.normalNode = normalViewGeometry;
  if (wind || thujaWind || deformation) {
    setWebGPUInstancePositionNode(
      prepared,
      thujaWind
        ? createThujaWindPositionFactory(thujaWind)
        : createPositionFactory(wind, deformation),
    );
  }
  return prepared;
}
