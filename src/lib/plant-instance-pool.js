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

/**
 * Configure an InstancedMesh for repeatedly repacked plant-organ prefixes.
 *
 * Shadow flags are arguments rather than constants: casting is an extra draw
 * per shadow-casting light, and whether a given organ kind is worth that at a
 * given LOD band is a decision for the caller, not for the pool. See
 * `ShadowCast` and `PlantRenderer._applyShadowDetail`.
 */
export function configureDynamicInstanceMesh(
  mesh,
  { castShadow = true, receiveShadow = true } = {},
) {
  if (!mesh?.isInstancedMesh) {
    throw new TypeError('Expected a THREE.InstancedMesh.');
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
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
    this._shadowEligible = {};
    this._suppressed = new Set();
  }

  /**
   * @param {string} kind
   * @param {object} [options]
   * @param {boolean} [options.castsShadow] Whether this organ kind is ever
   *   worth a shadow-map draw. A per-kind capability, fixed at construction —
   *   petioles and other hidden structure can opt out permanently. The LOD
   *   band decides whether an eligible kind casts *right now*.
   */
  add(
    kind,
    { name, geometry, material, group, capacity, castsShadow = true } = {},
  ) {
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
      { castShadow: castsShadow },
    );
    mesh.name = name ?? String(kind);
    mesh.count = 0;

    this._capacities[kind] = activeCapacity;
    this._meshes[kind] = mesh;
    this._kindByMesh.set(mesh, kind);
    this._cursors[kind] = 0;
    this._identityAt[kind] = [];
    this._shadowEligible[kind] = castsShadow;
    group?.add(mesh);
    return mesh;
  }

  /**
   * Apply one LOD band's shadow policy across every pooled organ kind.
   *
   * `cast` is the band's answer; a kind that opted out at construction stays
   * out regardless. Flipping these flags is free — no buffer touches the GPU,
   * three simply stops collecting the mesh for the shadow pass.
   *
   * @param {{ cast?: boolean, receive?: boolean }} policy
   */
  applyShadowPolicy({ cast = true, receive = true } = {}) {
    for (const [kind, mesh] of Object.entries(this._meshes)) {
      mesh.castShadow = cast && this._shadowEligible[kind] !== false;
      mesh.receiveShadow = receive;
    }
    return this;
  }

  /**
   * Kinds that draw nothing until told otherwise, whatever the plant emits.
   *
   * Suppression lands in `commitFrame` rather than `allocate` so no caller can
   * be broken by it: the plant still computes its petioles, they simply are not
   * drawn. That costs a little CPU at coarse bands and keeps this a property of
   * the pool instead of a branch in every plant.
   *
   * @param {Iterable<string>} [kinds]
   */
  suppress(kinds = []) {
    this._suppressed = new Set(kinds);
    return this;
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
      const activeCount = this._suppressed.has(kind) ? 0 : this._cursors[kind];
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

  /** The organ kind a pooled mesh was registered under, or null. */
  kindOf(mesh) {
    return this._kindByMesh.get(mesh) ?? null;
  }

  activeMeshes() {
    return Object.values(this._meshes);
  }
}
