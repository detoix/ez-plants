import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const BROKEN_TEXTURE_SLOTS = [
  'map',
  'aoMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
];

const RUNTIME_USER_DATA_KEYS = new Set([
  'leafWindShader',
  'sculptRuntime',
  'shader',
]);

const INSTANCE_POOL_USER_DATA_KEYS = new Set([
  ...RUNTIME_USER_DATA_KEYS,
  'activeOrganCount',
  'capacity',
  'organCount',
]);

function canonicalJSON(value, omittedKeys = new Set(), ancestors = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return undefined;
  }
  if (value instanceof Date) return value.toJSON();
  if (value instanceof Map || value instanceof Set) return undefined;
  if (ancestors.has(value)) return undefined;

  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(
      (entry) => canonicalJSON(entry, omittedKeys, ancestors) ?? null,
    );
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (omittedKeys.has(key)) continue;
      let entry;
      try {
        entry = canonicalJSON(value[key], omittedKeys, ancestors);
      } catch {
        continue;
      }
      if (entry !== undefined) result[key] = entry;
    }
  }
  ancestors.delete(value);
  return result;
}

function sanitizeUserData(userData, omittedKeys = RUNTIME_USER_DATA_KEYS) {
  return canonicalJSON(userData, omittedKeys) ?? {};
}

function defaultSnapshot(root) {
  if (typeof root.serialize === 'function') return root.serialize();
  return {
    type: root.constructor?.name || root.type || 'Object3D',
    ...(root.name ? { name: root.name } : {}),
  };
}

function createExportMetadata(root, metadata) {
  const snapshot = canonicalJSON(metadata ?? defaultSnapshot(root));
  if (snapshot === undefined) {
    throw new TypeError('GLB export metadata must be JSON-compatible.');
  }
  const snapshotType =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot.type
      : undefined;
  return {
    snapshot,
    sourceType:
      snapshotType || root.constructor?.name || root.type || 'Object3D',
  };
}

function createExportState() {
  const state = {
    disposed: false,
    geometryCache: new WeakMap(),
    geometries: new Set(),
    instanceMeshes: new Set(),
    materialCache: new WeakMap(),
    materials: new Set(),
    scene: null,
  };

  state.dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.scene?.clear();
    for (const mesh of state.instanceMeshes) mesh.dispose();
    for (const geometry of state.geometries) geometry.dispose();
    for (const material of state.materials) material.dispose();
    state.instanceMeshes.clear();
    state.geometries.clear();
    state.materials.clear();
  };
  return state;
}

function createGeometryView(source, state) {
  if (!source?.isBufferGeometry) {
    throw new TypeError('GLB export requires THREE.BufferGeometry meshes.');
  }
  const cached = state.geometryCache.get(source);
  if (cached) return cached;

  // Share immutable attribute arrays, but give GLTFExporter its own geometry
  // shell. The exporter may temporarily replace normals or indices while
  // building accessors; those changes must never touch the live renderer.
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  if (source.index) geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.morphAttributes = Object.fromEntries(
    Object.entries(source.morphAttributes).map(([name, attributes]) => [
      name,
      [...attributes],
    ]),
  );
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.groups = source.groups.map((group) => ({ ...group }));
  geometry.drawRange = { ...source.drawRange };
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData = sanitizeUserData(source.userData);

  state.geometryCache.set(source, geometry);
  state.geometries.add(geometry);
  return geometry;
}

function cloneMaterial(source, state) {
  if (!source?.isMaterial) {
    throw new TypeError('GLB export requires Three.js materials.');
  }
  const cached = state.materialCache.get(source);
  if (cached) return cached;

  const userData = sanitizeUserData(source.userData);
  const safeSource = Object.create(source);
  Object.defineProperty(safeSource, 'userData', {
    value: userData,
    configurable: true,
    enumerable: true,
    writable: true,
  });

  let material;
  try {
    material = new source.constructor().copy(safeSource);
  } catch (error) {
    const cloneError = new TypeError(
      `GLB export could not clone material ${JSON.stringify(source.name)}.`,
    );
    cloneError.cause = error;
    throw cloneError;
  }
  if (!material?.isMaterial) {
    throw new TypeError(
      'GLB export material clones must be Three.js materials.',
    );
  }

  material.userData = userData;
  material.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
  material.customProgramCacheKey =
    THREE.Material.prototype.customProgramCacheKey;
  for (const slot of BROKEN_TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture?.isTexture && !texture.image) material[slot] = null;
  }

  state.materialCache.set(source, material);
  state.materials.add(material);
  return material;
}

function cloneMaterials(source, state) {
  return Array.isArray(source)
    ? source.map((material) => cloneMaterial(material, state))
    : cloneMaterial(source, state);
}

function copyObjectState(source, target, omittedKeys) {
  target.name = source.name;
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.matrix.copy(source.matrix);
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.visible = true;
  target.userData = sanitizeUserData(source.userData, omittedKeys);
}

function copyInstanceColor(source, target, count) {
  const attribute = source.instanceColor;
  if (!attribute) return;
  if (!attribute.array || attribute.count < count) {
    throw new RangeError('InstancedMesh color capacity is below mesh.count.');
  }
  const length = count * attribute.itemSize;
  const values = attribute.array.slice(0, length);
  const copy = new THREE.InstancedBufferAttribute(
    values,
    attribute.itemSize,
    attribute.normalized,
    attribute.meshPerAttribute,
  );
  copy.name = attribute.name;
  copy.gpuType = attribute.gpuType;
  target.instanceColor = copy;
}

function createObjectProxy(source, state) {
  if (source.isBatchedMesh) {
    throw new TypeError(
      'GLB current-state export does not support THREE.BatchedMesh. Use ordinary compact Mesh geometry.',
    );
  }
  if (!source.visible) return null;

  let target;
  if (source.isInstancedMesh) {
    const count = source.count;
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        'InstancedMesh count must be a non-negative integer.',
      );
    }
    if (count === 0) return null;
    if (!source.instanceMatrix || source.instanceMatrix.count < count) {
      throw new RangeError(
        'InstancedMesh matrix capacity is below mesh.count.',
      );
    }

    target = new THREE.InstancedMesh(
      createGeometryView(source.geometry, state),
      cloneMaterials(source.material, state),
      count,
    );
    state.instanceMeshes.add(target);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < count; index++) {
      source.getMatrixAt(index, matrix);
      target.setMatrixAt(index, matrix);
    }
    copyInstanceColor(source, target, count);
    copyObjectState(source, target, INSTANCE_POOL_USER_DATA_KEYS);
  } else if (source.isSkinnedMesh) {
    throw new TypeError(
      'GLB proxy snapshots do not support SkinnedMesh objects.',
    );
  } else if (source.isMesh) {
    target = new THREE.Mesh(
      createGeometryView(source.geometry, state),
      cloneMaterials(source.material, state),
    );
    if (source.morphTargetInfluences) {
      target.morphTargetInfluences = [...source.morphTargetInfluences];
      target.morphTargetDictionary = { ...source.morphTargetDictionary };
    }
    copyObjectState(source, target, RUNTIME_USER_DATA_KEYS);
  } else {
    target = new THREE.Group();
    copyObjectState(source, target, RUNTIME_USER_DATA_KEYS);
  }

  for (const child of source.children) {
    const childProxy = createObjectProxy(child, state);
    if (childProxy) target.add(childProxy);
  }
  return target;
}

/**
 * Create an export-owned, current-visible-state proxy without mutating `root`.
 * The returned cleanup function is idempotent and never disposes source assets.
 */
export function createGLBExportSnapshot(root, options = {}) {
  if (!root?.isObject3D) {
    throw new TypeError('GLB export requires a THREE.Object3D root.');
  }
  if (
    options == null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('GLB export options must be an object.');
  }

  const state = createExportState();
  try {
    const name = String(options.name ?? (root.name || 'EZTree_CurrentState'));
    const { snapshot, sourceType } = createExportMetadata(
      root,
      options.metadata,
    );
    const scene = new THREE.Scene();
    scene.name = name;
    scene.userData = {
      ezTree: {
        schemaVersion: 1,
        exportMode: 'current-state',
        generator: '@dgreenheck/ez-tree',
        source: {
          type: String(sourceType),
          name: root.name || name,
        },
        snapshot,
      },
    };
    state.scene = scene;

    const rootProxy = createObjectProxy(root, state);
    if (rootProxy) scene.add(rootProxy);
    return { scene, dispose: state.dispose };
  } catch (error) {
    state.dispose();
    throw error;
  }
}

/** Export the visible current state of an EZ-Tree object as a binary GLB. */
export async function exportGLB(root, options = {}) {
  const maxTextureSize = options?.maxTextureSize ?? Infinity;
  if (
    maxTextureSize !== Infinity &&
    (!Number.isFinite(maxTextureSize) || maxTextureSize <= 0)
  ) {
    throw new RangeError('maxTextureSize must be positive or Infinity.');
  }

  const snapshot = createGLBExportSnapshot(root, options);
  try {
    const result = await new GLTFExporter().parseAsync(snapshot.scene, {
      binary: true,
      onlyVisible: true,
      maxTextureSize,
      includeCustomExtensions: false,
    });
    if (!(result instanceof ArrayBuffer)) {
      throw new TypeError('GLTFExporter did not return a binary ArrayBuffer.');
    }
    return result;
  } finally {
    snapshot.dispose();
  }
}
