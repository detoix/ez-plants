import * as THREE from 'three';

/**
 * Mark only the active prefix of a GPU attribute as dirty.
 *
 * This preserves the compatibility path used by the blackcurrant renderer for
 * Three.js releases that predate clearUpdateRanges()/addUpdateRange().
 */
export function markAttributeRange(attribute, componentCount) {
  if (!attribute || componentCount <= 0) return;
  if (
    typeof attribute.clearUpdateRanges === 'function' &&
    typeof attribute.addUpdateRange === 'function'
  ) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, componentCount);
  } else if (attribute.updateRange) {
    attribute.updateRange.offset = 0;
    attribute.updateRange.count = componentCount;
  }
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
    this.capacities = { ...capacities };
    this.meshes = {};
    this.cursors = {};
  }

  add(kind, { name, geometry, material, organCount, group, capacity } = {}) {
    if (!kind) throw new TypeError('An instance-pool kind is required.');
    if (this.meshes[kind]) {
      throw new Error(`Instance pool already contains kind: ${kind}`);
    }

    const historicalCount = Number.isFinite(organCount) ? organCount : 0;
    const activeCapacity = capacity ?? this.capacities[kind] ?? historicalCount;
    const mesh = configureDynamicInstanceMesh(
      new THREE.InstancedMesh(geometry, material, Math.max(1, activeCapacity)),
    );
    mesh.name = name ?? String(kind);
    mesh.count = 0;
    mesh.userData.organCount = historicalCount;
    mesh.userData.capacity = activeCapacity;
    mesh.userData.activeOrganCount = 0;

    this.meshes[kind] = mesh;
    this.cursors[kind] = 0;
    group?.add(mesh);
    return mesh;
  }

  beginFrame() {
    for (const kind of Object.keys(this.meshes)) {
      this.cursors[kind] = 0;
      this.meshes[kind].count = 0;
      this.meshes[kind].userData.activeOrganCount = 0;
    }
    return this;
  }

  allocate(kind) {
    const mesh = this.meshes[kind];
    if (!mesh) throw new RangeError(`Unknown instance-pool kind: ${kind}`);

    const index = this.cursors[kind];
    const capacity = mesh.userData.capacity;
    if (index >= capacity) {
      throw new RangeError(
        `${mesh.name} active instance capacity exceeded (${capacity}).`,
      );
    }
    this.cursors[kind] = index + 1;
    return index;
  }

  commitFrame() {
    for (const [kind, mesh] of Object.entries(this.meshes)) {
      const activeCount = this.cursors[kind];
      mesh.count = activeCount;
      mesh.userData.activeOrganCount = activeCount;
      if (activeCount > 0) {
        markAttributeRange(mesh.instanceMatrix, activeCount * 16);
        markAttributeRange(mesh.instanceColor, activeCount * 3);
      }
    }
    return this;
  }
}
