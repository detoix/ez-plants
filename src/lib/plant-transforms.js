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

/**
 * A unit cylinder aligned from local y=0 to local y=1.
 *
 * `openEnded` drops the end caps, which on a stem are half the triangles for
 * nothing: a petiole is capped by the twig it leaves and the blade it carries,
 * a peduncle by the shoot below and the head above. A five-sided capped tube
 * costs 20 triangles; a three-sided open one costs 6, and at the width these
 * organs are actually drawn -- one to three millimetres -- nothing downstream
 * can tell the difference.
 */
export function createUnitStemGeometry(radialSegments = 5, openEnded = false) {
  const geometry = new THREE.CylinderGeometry(
    1,
    1,
    1,
    radialSegments,
    1,
    openEnded,
  );
  geometry.translate(0, 0.5, 0);
  return geometry;
}

/**
 * A unit stem as a flat card, aligned from local y=0 to local y=1.
 *
 * The coarse rung of a stem that must stay in the same place at every band.
 *
 * A stem drawn as instanced segments has only two levers: how many segments it
 * spends on its curve, and how many triangles each segment costs. Spending
 * fewer segments at a coarse band re-places every one of them -- a coarser
 * segment starts where a finer one started but spans several, so it is longer
 * and points along a different chord. That makes a coarse band something other
 * than the fine band with organs culled, which is the relation a field needs in
 * order to allocate the kind once instead of once per band.
 *
 * So the segments stay put and the triangles go instead. Two triangles rather
 * than a three-sided tube's six, spanning the same footprint the tube did, so
 * the same instance matrix places it. Use it with a double-sided material: a
 * card has no inside, and at the distance this rung is for a stem is a
 * millimetre or two of silhouette that must not disappear when it is seen from
 * behind.
 */
export function createUnitStemCardGeometry() {
  const geometry = new THREE.PlaneGeometry(2, 1);
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
