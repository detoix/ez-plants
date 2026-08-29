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
    this._shadowReceiving = {};
    this._suppressed = new Set();
    this._geometries = {};
    this._organLevel = 0;
  }

  /**
   * @param {string} kind
   * @param {object} [options]
   * @param {boolean} [options.castsShadow] Whether this organ kind is ever
   *   worth a shadow-map draw. A per-kind capability, fixed at construction —
   *   petioles and other hidden structure can opt out permanently. The LOD
   *   band decides whether an eligible kind casts *right now*.
   * @param {boolean} [options.receivesShadow] Whether the kind should be
   *   shadowed at all. The opt-out is for organs meshed as a shell of cards
   *   standing in for a solid mass: the cards shadow each other, and because
   *   they are a sparse approximation of something dense the result is hard
   *   mottling across a surface that should read as one soft body. Such a kind
   *   still *casts* — a flower head shadowing the leaves below it is real.
   */
  add(
    kind,
    {
      name,
      geometry,
      geometries,
      material,
      group,
      capacity,
      castsShadow = true,
      receivesShadow = true,
    } = {},
  ) {
    if (!kind) throw new TypeError('An instance-pool kind is required.');
    if (this._meshes[kind]) {
      throw new Error(`Instance pool already contains kind: ${kind}`);
    }

    // An organ kind may bring a whole ladder instead of one mesh. Thinning
    // counts and dropping kinds are the only LOD levers a pool used to have,
    // and neither helps an organ that is both irreducible and the reason the
    // plant is worth drawing -- a hydrangea's panicle cannot be thinned away
    // and cannot be dropped, so it has to get simpler instead.
    const ladder = geometries ?? [geometry];
    if (!ladder.length) {
      throw new TypeError(`Instance-pool kind ${kind} needs geometry.`);
    }
    geometry = ladder[0];

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
    this._geometries[kind] = ladder;
    this._meshes[kind] = mesh;
    this._kindByMesh.set(mesh, kind);
    this._cursors[kind] = 0;
    this._identityAt[kind] = [];
    this._shadowEligible[kind] = castsShadow;
    this._shadowReceiving[kind] = receivesShadow;
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
      mesh.receiveShadow = receive && this._shadowReceiving[kind] !== false;
    }
    return this;
  }

  /**
   * Select one rung of every organ kind's geometry ladder.
   *
   * A kind that supplied a single geometry ignores this, and a kind whose
   * ladder is shorter than the requested level clamps to its last rung -- so a
   * plant only describes the organs it actually wants to simplify, and a band
   * past the end of a ladder keeps the coarsest version rather than failing.
   *
   * Swapping `mesh.geometry` is all this costs: the matrices already written
   * for the kind stay valid, because every rung of a ladder is authored in the
   * same unit frame.
   *
   * @param {number} level
   */
  setOrganLevel(level = 0) {
    if (!Number.isInteger(level) || level < 0) {
      throw new RangeError('Organ level must be a non-negative integer.');
    }
    this._organLevel = level;
    for (const [kind, mesh] of Object.entries(this._meshes)) {
      const ladder = this._geometries[kind];
      mesh.geometry = ladder[Math.min(level, ladder.length - 1)];
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
