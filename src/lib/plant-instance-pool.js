import * as THREE from 'three';

/**
 * Mark only the active prefix of a GPU attribute as dirty.
 *
 * This renderer targets Three.js r167+, where update ranges are explicit.
 */
export function markAttributeRange(attribute, componentCount) {
  if (!attribute || componentCount <= 0) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, componentCount);
  attribute.needsUpdate = true;
}

/** Configure an InstancedMesh for repeatedly repacked plant-organ prefixes. */
export function configureDynamicInstanceMesh(mesh) {
  if (!mesh?.isInstancedMesh) {
    throw new TypeError('Expected a THREE.InstancedMesh.');
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Compact instance pools keyed by organ kind.
 *
 * Each frame starts at cursor zero, allocates a dense active prefix, then marks
 * only that prefix for upload. Capacity may be lower than historical organ
 * count when the caller has calculated a safe concurrency bound.
 */
export class PlantInstancePool {
  constructor({ capacities = {} } = {}) {
    this._capacities = { ...capacities };
    this._meshes = {};
    this._kindByMesh = new WeakMap();
    this._cursors = {};
    this._identityAt = {};
  }

  add(kind, { name, geometry, material, group, capacity } = {}) {
    if (!kind) throw new TypeError('An instance-pool kind is required.');
    if (this._meshes[kind]) {
      throw new Error(`Instance pool already contains kind: ${kind}`);
    }

    const activeCapacity = capacity ?? this._capacities[kind] ?? 0;
    if (!Number.isInteger(activeCapacity) || activeCapacity < 0) {
      throw new RangeError(
        `Instance-pool capacity for ${kind} must be a non-negative integer.`,
      );
    }
    const mesh = configureDynamicInstanceMesh(
      new THREE.InstancedMesh(geometry, material, Math.max(1, activeCapacity)),
    );
    mesh.name = name ?? String(kind);
    mesh.count = 0;

    this._capacities[kind] = activeCapacity;
    this._meshes[kind] = mesh;
    this._kindByMesh.set(mesh, kind);
    this._cursors[kind] = 0;
    this._identityAt[kind] = [];
    group?.add(mesh);
    return mesh;
  }

  beginFrame() {
    for (const kind of Object.keys(this._meshes)) {
      this._cursors[kind] = 0;
      this._meshes[kind].count = 0;
      this._identityAt[kind].length = 0;
    }
    return this;
  }

  allocate(kind, identity = null) {
    const mesh = this._meshes[kind];
    if (!mesh) throw new RangeError(`Unknown instance-pool kind: ${kind}`);

    const index = this._cursors[kind];
    const capacity = this._capacities[kind];
    if (index >= capacity) {
      throw new RangeError(
        `${mesh.name} active instance capacity exceeded (${capacity}).`,
      );
    }
    this._cursors[kind] = index + 1;
    this._identityAt[kind][index] = identity;
    return index;
  }

  /** Write one logical organ into the current dense prefix. */
  write(kind, identity, matrix, color = null) {
    const mesh = this._meshes[kind];
    const index = this.allocate(kind, identity);
    mesh.setMatrixAt(index, matrix);
    if (color != null) mesh.setColorAt(index, color);
    return index;
  }

  /** Resolve a transient GPU slot back to its stable application identity. */
  identityFor(mesh, instanceId) {
    const kind = this._kindByMesh.get(mesh);
    if (kind == null || !Number.isInteger(instanceId) || instanceId < 0) {
      return null;
    }
    return this._identityAt[kind][instanceId] ?? null;
  }

  commitFrame() {
    for (const [kind, mesh] of Object.entries(this._meshes)) {
      const activeCount = this._cursors[kind];
      mesh.count = activeCount;
      if (activeCount > 0) {
        markAttributeRange(mesh.instanceMatrix, activeCount * 16);
        markAttributeRange(mesh.instanceColor, activeCount * 3);
      }
    }
    return this;
  }

  mesh(kind) {
    const mesh = this._meshes[kind];
    if (!mesh) throw new RangeError(`Unknown instance-pool kind: ${kind}`);
    return mesh;
  }

  activeMeshes() {
    return Object.values(this._meshes);
  }
}
