import * as THREE from 'three';

/** End-cap policy for a woody branch tube. */
export const BranchCap = Object.freeze({
  None: 'none',
  Start: 'start',
  End: 'end',
  Both: 'both',
});

/** Create the flat arrays consumed by EZ-Tree's combined branch mesh. */
export function createBranchGeometryData() {
  return {
    verts: [],
    normals: [],
    indices: [],
    uvs: [],
  };
}

function sampleRadiusProfile(radii, position) {
  if (Number.isFinite(radii)) return radii;
  if (!Array.isArray(radii) || radii.length === 0) {
    throw new TypeError(
      'Branch radii must be a finite number or non-empty array.',
    );
  }
  if (!radii.every((radius) => Number.isFinite(radius) && radius >= 0)) {
    throw new RangeError(
      'Every branch radius must be finite and non-negative.',
    );
  }
  if (radii.length === 1) return radii[0];

  const scaledPosition = position * (radii.length - 1);
  const lower = Math.floor(scaledPosition);
  const upper = Math.min(radii.length - 1, lower + 1);
  return THREE.MathUtils.lerp(
    radii[lower],
    radii[upper],
    scaledPosition - lower,
  );
}

/**
 * Thin adapter from a Catmull-Rom centreline to sections consumed by the
 * shared EZ-Tree tube mesher. It creates no vertices, indices or geometry.
 */
export function createCurveBranchSections(
  controlPoints,
  radii,
  { tubularSegments = 10, minimumRadius = 0.0001 } = {},
) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    throw new TypeError('A branch curve requires at least two control points.');
  }
  if (!Number.isInteger(tubularSegments) || tubularSegments < 1) {
    throw new RangeError('tubularSegments must be a positive integer.');
  }
  if (!Number.isFinite(minimumRadius) || minimumRadius < 0) {
    throw new RangeError('minimumRadius must be finite and non-negative.');
  }

  const points = controlPoints.map((point) => {
    if (point?.isVector3) return point.clone();
    if (Array.isArray(point) && point.length >= 3) {
      return new THREE.Vector3(point[0], point[1], point[2]);
    }
    throw new TypeError(
      'Every branch control point must be a Vector3 or xyz array.',
    );
  });
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
  const frames = curve.computeFrenetFrames(tubularSegments, false);

  return Array.from({ length: tubularSegments + 1 }, (_, index) => {
    const position = index / tubularSegments;
    return {
      origin: curve.getPointAt(position),
      tangent: frames.tangents[index].clone(),
      normal: frames.normals[index].clone(),
      binormal: frames.binormals[index].clone(),
      radius: Math.max(minimumRadius, sampleRadiusProfile(radii, position)),
    };
  });
}

function validateGeometryData(data) {
  for (const key of ['verts', 'normals', 'indices', 'uvs']) {
    if (!Array.isArray(data?.[key])) {
      throw new TypeError(`Branch geometry data requires an array at ${key}.`);
    }
  }
}

function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new TypeError('At least one branch section is required.');
  }
  for (const section of sections) {
    const hasEulerFrame = section?.orientation?.isEuler;
    const hasVectorFrame =
      section?.tangent?.isVector3 &&
      section?.normal?.isVector3 &&
      section?.binormal?.isVector3;
    if (
      !section?.origin?.isVector3 ||
      (!hasEulerFrame && !hasVectorFrame) ||
      !Number.isFinite(section.radius) ||
      section.radius < 0
    ) {
      throw new TypeError(
        'Each branch section requires a Vector3 origin, an Euler orientation or tangent/normal/binormal frame, and a non-negative radius.',
      );
    }
  }
}

function getSectionFrame(section) {
  if (section.orientation?.isEuler) {
    const quaternion = new THREE.Quaternion().setFromEuler(section.orientation);
    const tangent = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    const normal = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    return {
      quaternion,
      tangent,
      normal,
      binormal: tangent.clone().cross(normal).normalize(),
    };
  }

  const tangent = section.tangent.clone().normalize();
  const normal = section.normal
    .clone()
    .addScaledVector(tangent, -section.normal.dot(tangent))
    .normalize();
  const binormal = tangent.clone().cross(normal).normalize();
  const rotation = new THREE.Matrix4().makeBasis(
    normal,
    tangent,
    binormal.clone().negate(),
  );
  return {
    quaternion: new THREE.Quaternion().setFromRotationMatrix(rotation),
    tangent,
    normal,
    binormal,
  };
}

function getRadialVector(section, frame, x, z) {
  if (section.orientation?.isEuler) {
    // Retain the exact arithmetic used by EZ-Tree before extraction.
    return new THREE.Vector3(x, 0, z).applyEuler(section.orientation);
  }
  // Three.js Frenet frames define binormal = tangent x normal. EZ-Tree's
  // side-index winding therefore uses the opposite binormal around each ring.
  return frame.normal
    .clone()
    .multiplyScalar(x)
    .addScaledVector(frame.binormal, -z);
}

function capEnabled(caps, end) {
  return caps === BranchCap.Both || caps === end;
}

function appendCap(data, section, radialSegments, end) {
  const centerIndex = data.verts.length / 3;
  const frame = getSectionFrame(section);
  const normal = frame.tangent
    .clone()
    .multiplyScalar(end === BranchCap.Start ? -1 : 1);

  data.verts.push(section.origin.x, section.origin.y, section.origin.z);
  data.normals.push(normal.x, normal.y, normal.z);
  data.uvs.push(0.5, 0.5);

  for (let j = 0; j <= radialSegments; j++) {
    const angle = (2 * Math.PI * j) / radialSegments;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const vertex = getRadialVector(section, frame, x, z)
      .multiplyScalar(section.radius)
      .add(section.origin);
    data.verts.push(vertex.x, vertex.y, vertex.z);
    data.normals.push(normal.x, normal.y, normal.z);
    data.uvs.push(0.5 + 0.5 * x, 0.5 + 0.5 * z);
  }

  const rimOffset = centerIndex + 1;
  for (let j = 0; j < radialSegments; j++) {
    if (end === BranchCap.Start) {
      data.indices.push(centerIndex, rimOffset + j, rimOffset + j + 1);
    } else {
      data.indices.push(centerIndex, rimOffset + j + 1, rimOffset + j);
    }
  }
}

/**
 * Append EZ-Tree's branch rings and indices to a combined geometry buffer.
 * Every ring duplicates its first vertex at the UV seam, matching the original
 * EZ-Tree topology exactly for the default open-tube policy.
 */
export function appendBranchTube(
  data,
  sections,
  { radialSegments, textureWraps = 1, caps = BranchCap.None } = {},
) {
  validateGeometryData(data);
  validateSections(sections);
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError('radialSegments must be an integer of at least 3.');
  }
  if (!Number.isFinite(textureWraps) || textureWraps <= 0) {
    throw new RangeError('textureWraps must be a positive finite number.');
  }
  if (!Object.values(BranchCap).includes(caps)) {
    throw new RangeError(`Unknown branch cap policy: ${caps}.`);
  }

  const vertexOffset = data.verts.length / 3;
  const indexOffset = data.indices.length;
  const ringStride = radialSegments + 1;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const frame = getSectionFrame(section);
    let firstVertex;
    let firstNormal;

    for (let j = 0; j < radialSegments; j++) {
      const angle = (2 * Math.PI * j) / radialSegments;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const radial = getRadialVector(section, frame, x, z);
      const vertex = section.orientation?.isEuler
        ? new THREE.Vector3(x, 0, z)
            .multiplyScalar(section.radius)
            .applyEuler(section.orientation)
            .add(section.origin)
        : radial.clone().multiplyScalar(section.radius).add(section.origin);
      const normal = radial.normalize();
      const u = (j / radialSegments) * textureWraps;
      const v = i % 2 === 0 ? 0 : 1;

      data.verts.push(vertex.x, vertex.y, vertex.z);
      data.normals.push(normal.x, normal.y, normal.z);
      data.uvs.push(u, v);

      if (j === 0) {
        firstVertex = vertex;
        firstNormal = normal;
      }
    }

    data.verts.push(firstVertex.x, firstVertex.y, firstVertex.z);
    data.normals.push(firstNormal.x, firstNormal.y, firstNormal.z);
    data.uvs.push(textureWraps, i % 2 === 0 ? 0 : 1);
  }

  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const v1 = vertexOffset + i * ringStride + j;
      const v2 = v1 + 1;
      const v3 = v1 + ringStride;
      const v4 = v2 + ringStride;
      data.indices.push(v1, v3, v2, v2, v3, v4);
    }
  }

  if (capEnabled(caps, BranchCap.Start)) {
    appendCap(data, sections[0], radialSegments, BranchCap.Start);
  }
  if (capEnabled(caps, BranchCap.End)) {
    appendCap(
      data,
      sections[sections.length - 1],
      radialSegments,
      BranchCap.End,
    );
  }

  return {
    vertexOffset,
    vertexCount: data.verts.length / 3 - vertexOffset,
    indexOffset,
    indexCount: data.indices.length - indexOffset,
  };
}

/** Build a Three.js branch geometry, selecting 32-bit indices when required. */
export function createBranchBufferGeometry(data) {
  validateGeometryData(data);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(data.verts, 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(data.normals, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  // Passing the array lets Three.js choose Uint16 or Uint32 from its max index.
  geometry.setIndex(data.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Sample a parent branch's position, orientation and radius at normalized
 * distance `position`. Orientation interpolates from section A toward B.
 */
export function sampleBranchSection(sections, position, radiusScale = 1) {
  validateSections(sections);
  if (!Number.isFinite(position)) {
    throw new TypeError('Branch sample position must be finite.');
  }
  if (!Number.isFinite(radiusScale) || radiusScale < 0) {
    throw new RangeError(
      'Branch radius scale must be finite and non-negative.',
    );
  }

  const clampedPosition = THREE.MathUtils.clamp(position, 0, 1);
  const scaledPosition = clampedPosition * (sections.length - 1);
  const sectionIndex = Math.floor(scaledPosition);
  const nextSectionIndex = Math.min(sectionIndex + 1, sections.length - 1);
  const alpha = scaledPosition - sectionIndex;
  const sectionA = sections[sectionIndex];
  const sectionB = sections[nextSectionIndex];

  const quaternion = getSectionFrame(sectionA).quaternion.slerp(
    getSectionFrame(sectionB).quaternion,
    alpha,
  );
  const orientation = new THREE.Euler().setFromQuaternion(quaternion);
  const tangent = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const normal = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);

  return {
    origin: new THREE.Vector3().lerpVectors(
      sectionA.origin,
      sectionB.origin,
      alpha,
    ),
    orientation,
    tangent,
    normal,
    binormal: tangent.clone().cross(normal).normalize(),
    radius:
      THREE.MathUtils.lerp(sectionA.radius, sectionB.radius, alpha) *
      radiusScale,
  };
}
