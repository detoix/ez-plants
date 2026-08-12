import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/** Convert supported vector-like values to an owned THREE.Vector3. */
export function vector(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(...value);
  if (value && Number.isFinite(value.x)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback.clone();
}

export const toVector3 = vector;

/**
 * Orient local +Y along forward while keeping local +Z as close as possible
 * to the preferred normal.
 */
export function makeBasisQuaternion(forward, preferredNormal = UP) {
  const y = forward.clone().normalize();
  let z = preferredNormal
    .clone()
    .sub(y.clone().multiplyScalar(preferredNormal.dot(y)));
  if (z.lengthSq() < 1e-5) z.set(0, 0, 1);
  z.normalize();
  const x = y.clone().cross(z).normalize();
  z = x.clone().cross(y).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

/** A unit cylinder aligned from local y=0 to local y=1. */
export function createUnitStemGeometry(radialSegments = 5) {
  const geometry = new THREE.CylinderGeometry(
    1,
    1,
    1,
    radialSegments,
    1,
    false,
  );
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/** Put a unit +Y segment between two points, with radius in world units. */
export function composeSegmentMatrix(target, start, end, radius = 1) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  target.position.copy(start);

  if (length < 1e-7) {
    target.quaternion.identity();
    target.scale.set(0, 0, 0);
  } else {
    target.quaternion.setFromUnitVectors(
      UP,
      direction.multiplyScalar(1 / length),
    );
    target.scale.set(radius, length, radius);
  }

  target.updateMatrix();
  return target.matrix;
}
