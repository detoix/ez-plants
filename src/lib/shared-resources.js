/**
 * One allocation per distinct resource, however many plants ask for it.
 *
 * Two plants of the same species used to share nothing: each ran its own
 * material and geometry factories and paid for the result again. A leaf card
 * is a leaf card whether it is the first plant in the scene or the five
 * hundredth, so it is built once and handed out.
 *
 * `bark-plate.js` already worked this way for its textures; this generalises
 * the same memoisation and adds the two things a general cache needs — a
 * collision guard, and an explicit ownership rule.
 *
 * ## What may be shared, and what may never be
 *
 * Only resources that are **never mutated after construction**. That is a real
 * constraint, not a formality: a plant's leaf material has its colour rewritten
 * every time the day of year changes, so two plants sharing one would drag each
 * other's foliage through the seasons. Geometry is safe — the instance pools
 * write matrices, never vertices — and so is bark, which no plant recolours.
 *
 * When in doubt, don't. A per-plant allocation is a few hundred kilobytes; a
 * shared mutable is a bug that only appears with two plants on screen.
 *
 * ## Ownership
 *
 * **The cache owns what it hands out, and no plant may dispose it.** A shared
 * resource deliberately never reaches a plant's `ResourceTracker`, so one
 * plant's `dispose()` leaves every sibling fully renderable. Nothing is
 * reference counted: the set of distinct resources is bounded by the library's
 * own factories, so it is small and it stops growing. `disposeSharedResources()`
 * exists for tearing down a whole application, not for retiring one plant.
 */

/** namespace -> Map(key -> { value, factory }) */
const registries = new Map();

/** Everything the cache has ever handed out, for `isSharedResource`. */
const handedOut = new WeakSet();

const objectIds = new WeakMap();
let nextObjectId = 0;

/**
 * A stable id for something that has identity rather than value — a
 * caller-supplied texture, say. Two calls with the same object agree; two
 * structurally identical objects do not, which is the correct answer for a
 * resource that a caller might later mutate or dispose.
 */
function identityId(value) {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = `#${(nextObjectId += 1)}`;
    objectIds.set(value, id);
  }
  return id;
}

/**
 * Deterministic key for a factory's options.
 *
 * Object keys are sorted, so `{ a, b }` and `{ b, a }` agree. Anything with GPU
 * identity — a texture, a material, an Object3D — is keyed by identity instead
 * of by shape, because two textures with the same settings are still two
 * textures.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableKey(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return String(value);
  }
  if (type === 'string') return JSON.stringify(value);
  if (type === 'symbol' || type === 'function') return identityId(value);

  if (Array.isArray(value)) {
    return `[${value.map(stableKey).join(',')}]`;
  }

  // Anything three considers a resource keeps its identity. `isTexture` and
  // friends are the library-wide way of asking, and it costs one property read.
  if (
    value.isTexture ||
    value.isMaterial ||
    value.isBufferGeometry ||
    value.isObject3D
  ) {
    return identityId(value);
  }

  // Vector2/3, Color and similar answer usefully here; a plain object falls
  // through to its own entries.
  if (typeof value.toArray === 'function') {
    return `${value.constructor?.name ?? 'v'}(${stableKey(value.toArray())})`;
  }

  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, entry]) => `${JSON.stringify(name)}:${stableKey(entry)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Fetch a shared resource, building it on first request.
 *
 * @param {string} namespace Resource family, e.g. `'geometry'`.
 * @param {string} id Stable identifier, namespaced by whoever owns the
 *   factory: `'forsythia/flower'` for a geometry defined in the forsythia
 *   folder, `'shared/leaf-card'` for one in `src/lib/`. The namespace prefix is
 *   what stops two species' `createFlowerGeometry` from colliding.
 * @param {object} options Serialisable options; part of the key, so distinct
 *   options produce distinct resources.
 * @param {(options: object) => T} factory Built once per distinct key.
 * @returns {T}
 * @template T
 */
export function sharedResource(namespace, id, options, factory) {
  if (typeof id !== 'string' || !id.includes('/')) {
    throw new TypeError(
      `A shared-resource id must be namespaced, like 'forsythia/flower'. Got: ${id}`,
    );
  }
  if (typeof factory !== 'function') {
    throw new TypeError('A shared-resource factory function is required.');
  }

  let registry = registries.get(namespace);
  if (!registry) {
    registry = new Map();
    registries.set(namespace, registry);
  }

  const key = `${id}|${stableKey(options ?? {})}`;
  const existing = registry.get(key);
  if (existing) {
    // Two different factories behind one id would hand a plant another
    // species' organ, and it would look plausible. Factories are module-level
    // constants, so identity is a reliable test, and failing here means the
    // clash is caught the first time two plants coexist rather than in a
    // screenshot.
    if (existing.factory !== factory) {
      throw new Error(
        `Shared ${namespace} id "${id}" is claimed by two different factories. ` +
          `Namespace it by the folder that owns the factory.`,
      );
    }
    return existing.value;
  }

  const value = factory(options ?? {});
  registry.set(key, { value, factory });
  if (value !== null && typeof value === 'object') handedOut.add(value);
  return value;
}

/**
 * Whether the cache owns this resource — and therefore whether a plant is
 * forbidden from disposing it. The question a `dispose()` test needs to ask.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSharedResource(value) {
  return value !== null && typeof value === 'object' && handedOut.has(value);
}

/** Shared geometry. Safe: instance pools write matrices, never vertices. */
export function sharedGeometry(id, options, factory) {
  return sharedResource('geometry', id, options, factory);
}

/**
 * Shared material. Safe only for a material nothing recolours or reconfigures
 * after construction — bark, not foliage. See the module comment.
 */
export function sharedMaterial(id, options, factory) {
  return sharedResource('material', id, options, factory);
}

/** Shared texture, for maps a plant generates rather than loads. */
export function sharedTexture(id, options, factory) {
  return sharedResource('texture', id, options, factory);
}

/** What the cache currently holds, per namespace. For tests and diagnostics. */
export function sharedResourceStats() {
  return Object.fromEntries(
    [...registries].map(([namespace, registry]) => [namespace, registry.size]),
  );
}

/**
 * Dispose and forget every shared resource.
 *
 * For tearing down an application or isolating a test — never for retiring one
 * plant, which must leave its siblings renderable. Any plant still in a scene
 * after this call is holding disposed resources.
 *
 * @param {string} [namespace] Limit to one family; omit for all of them.
 */
export function disposeSharedResources(namespace) {
  const targets = namespace ? [namespace] : [...registries.keys()];
  for (const name of targets) {
    const registry = registries.get(name);
    if (!registry) continue;
    for (const { value } of registry.values()) value?.dispose?.();
    registry.clear();
    registries.delete(name);
  }
}
