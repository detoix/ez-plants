/**
 * Tracks renderer-owned GPU resources and disposes every unique allocation
 * exactly once.
 */
export class ResourceTracker {
  constructor() {
    this.instancedMeshes = new Set();
    this.geometries = new Set();
    this.materials = new Set();
    this.disposed = false;
  }

  _assertActive() {
    if (this.disposed) {
      throw new Error('Cannot track a resource after disposal.');
    }
  }

  trackInstancedMesh(mesh) {
    this._assertActive();
    if (!mesh?.isInstancedMesh) {
      throw new TypeError('Expected a THREE.InstancedMesh.');
    }
    this.instancedMeshes.add(mesh);
    return mesh;
  }

  trackGeometry(geometry) {
    this._assertActive();
    if (!geometry?.isBufferGeometry) {
      throw new TypeError('Expected a THREE.BufferGeometry.');
    }
    this.geometries.add(geometry);
    return geometry;
  }

  /**
   * Stop owning and dispose a geometry immediately. Releasing replacement
   * buffers here prevents the final tracker disposal from disposing them a
   * second time.
   */
  releaseGeometry(geometry) {
    this._assertActive();
    if (!this.geometries.delete(geometry)) return false;
    geometry.dispose();
    return true;
  }

  /** Replace a tracked mesh geometry while preserving exact-once ownership. */
  replaceGeometry(mesh, geometry) {
    this._assertActive();
    if (!mesh?.isMesh) {
      throw new TypeError('Expected a THREE.Mesh.');
    }
    if (!geometry?.isBufferGeometry) {
      throw new TypeError('Expected a THREE.BufferGeometry.');
    }
    if (mesh.geometry === geometry) {
      this.trackGeometry(geometry);
      return geometry;
    }

    this.trackGeometry(geometry);
    this.releaseGeometry(mesh.geometry);
    mesh.geometry = geometry;
    return geometry;
  }

  trackMaterial(material) {
    this._assertActive();
    if (!material?.isMaterial) {
      throw new TypeError('Expected a THREE.Material.');
    }
    this.materials.add(material);
    return material;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const mesh of this.instancedMeshes) mesh.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();

    this.instancedMeshes.clear();
    this.geometries.clear();
    this.materials.clear();
  }
}
