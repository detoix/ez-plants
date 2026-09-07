import * as THREE from 'three';

/** Five-sepal pendant bell with green body and mauve reflexed tips. */
export function createFlowerGeometry() {
  const positions = [];
  const colors = [];
  const segments = 5;
  const green = new THREE.Color(0x8ca960);
  const mauve = new THREE.Color(0x8e5266);

  const pushTriangle = (a, b, c, colorA, colorB, colorC) => {
    for (const point of [a, b, c]) positions.push(point.x, point.y, point.z);
    for (const color of [colorA, colorB, colorC])
      colors.push(color.r, color.g, color.b);
  };

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const am = (a0 + a1) * 0.5;
    const top0 = new THREE.Vector3(Math.cos(a0) * 0.11, 0, Math.sin(a0) * 0.11);
    const top1 = new THREE.Vector3(Math.cos(a1) * 0.11, 0, Math.sin(a1) * 0.11);
    const rim0 = new THREE.Vector3(
      Math.cos(a0) * 0.25,
      -0.52,
      Math.sin(a0) * 0.25,
    );
    const rim1 = new THREE.Vector3(
      Math.cos(a1) * 0.25,
      -0.52,
      Math.sin(a1) * 0.25,
    );
    const tip = new THREE.Vector3(
      Math.cos(am) * 0.37,
      -0.78,
      Math.sin(am) * 0.37,
    );

    pushTriangle(top0, rim0, top1, green, green, green);
    pushTriangle(top1, rim0, rim1, green, green, green);
    pushTriangle(rim0, tip, rim1, green, mauve, green);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A dormant or unopened bud: a small pointed spindle.
 *
 * This is not a berry, and until now it was one. `buds` and `flowerBuds` were
 * both instanced from `createBerryGeometry`, which is a 10x7 sphere at 120
 * triangles -- borrowed for its shape and not even for its colour, since both
 * bud materials are flat and ignore the vertex colours it carries. On a
 * three-year bush that was 39,840 triangles of dormant bud on bare wood in
 * December and 102,720 triangles of flower bud at the spring flush, for organs
 * two and three millimetres long.
 *
 * At 6x3 this is 24 triangles and a better likeness: a currant bud is an
 * ovoid that narrows to a point, not a sphere.
 *
 * Authored in the same frame as the berry it replaces -- origin-centred, one
 * unit tall, half a unit across -- because the placements are already written
 * against that frame and a bud must land exactly where the sphere did.
 */
export function createBudGeometry({ segments = 6, rings = 3 } = {}) {
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError('A bud needs at least 3 segments.');
  }
  if (!Number.isInteger(rings) || rings < 2) {
    throw new RangeError('A bud needs at least 2 rings.');
  }

  const positions = [];
  const indices = [];
  const pushVertex = (x, y, z) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  const base = pushVertex(0, -0.5, 0);
  const rows = [];
  for (let ring = 1; ring < rings; ring += 1) {
    const t = ring / rings;
    // Fullest below the middle and drawn out to the tip, which is the profile
    // of a currant bud; a plain sine would give a symmetric rugby ball.
    const radius = 0.5 * Math.pow(Math.sin(Math.PI * t), 0.62) * (1 - 0.3 * t);
    const row = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      row.push(
        pushVertex(Math.cos(angle) * radius, t - 0.5, Math.sin(angle) * radius),
      );
    }
    rows.push(row);
  }
  const tip = pushVertex(0, 0.5, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(base, rows[0][next], rows[0][segment]);
  }
  for (let ring = 0; ring < rows.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = rows[ring][segment];
      const b = rows[ring][next];
      const c = rows[ring + 1][segment];
      const d = rows[ring + 1][next];
      indices.push(a, b, c, b, d, c);
    }
  }
  const last = rows[rows.length - 1];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(last[segment], last[next], tip);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBerryGeometry() {
  const geometry = new THREE.SphereGeometry(0.5, 10, 7);
  const position = geometry.getAttribute('position');
  const colors = [];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const wobble = 1 + 0.025 * Math.sin(x * 19 + y * 13 + z * 23);
    position.setXYZ(i, x * wobble, y * wobble * 0.96, z * wobble);
    const bloom =
      0.72 +
      0.22 * (0.5 + 0.5 * Math.sin(x * 53.1 + y * 91.7 + z * 37.3 + i * 1.91));
    colors.push(bloom * 0.92, bloom * 0.95, bloom);
  }

  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-8) {
      normal.setXYZ(i, nx / length, ny / length, nz / length);
      continue;
    }

    // SphereGeometry duplicates its poles for UV continuity. After the
    // currant-specific wobble those degenerate pole faces can still produce a
    // zero normal, so fall back to the outward radial direction.
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const radialLength = Math.hypot(px, py, pz) || 1;
    normal.setXYZ(i, px / radialLength, py / radialLength, pz / radialLength);
  }
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** Retained five-pointed calyx at the distal end of every berry. */
export function createCalyxStarGeometry() {
  const positions = [0, 0.015, 0];
  const normals = [0, 1, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  const points = 10;

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radius = i % 2 === 0 ? 0.5 : 0.18;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    normals.push(0, 1, 0);
    uvs.push(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
  }

  for (let i = 0; i < points; i++) {
    indices.push(0, i + 1, ((i + 1) % points) + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
