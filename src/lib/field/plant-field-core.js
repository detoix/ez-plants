import * as THREE from 'three';

/**
 * Many plants, few draw calls.
 *
 * ## The shape of the problem
 *
 * A single plant is already efficient — one instanced mesh per organ kind, one
 * merged mesh for wood, eight to ten draw calls however many thousand organs it
 * carries. What it does not do is share anything with the plant next to it. A
 * hundred plants is a hundred separate sets of meshes.
 *
 * The field closes that, and it does so differently for the two mesh families,
 * because they want opposite answers:
 *
 * **Organs — one mesh per compatible geometry rung for the whole field.** Most
 * organ LOD draws *fewer* instances and fattens the survivors, so every band
 * still shares one buffer and one draw. Plants such as Thuja and Echinacea use
 * genuinely different index buffers at distance; each distinct rung receives
 * its own pooled mesh without making draw count depend on plant count.
 *
 * **Wood — one mesh per prototype, with real geometry LODs.** Here the buffers
 * genuinely differ between bands: different vertex counts, different indices,
 * a real remesh. Those must be separate geometries, which is exactly what
 * `addLOD` is for, and the per-instance distance selection comes for free.
 *
 * ## What this class is not
 *
 * A thin adapter, deliberately. Everything specific to `@detoix/instanced-mesh`
 * lives in this file, so the dependency stays swappable, and nothing outside
 * `src/lib/field/` imports it. The dependency arrow points **field → plant, and
 * never plant → field**: that is what keeps `three` the only thing an extracted
 * plant needs.
 *
 * The field also knows nothing about which plants exist. It reads organ kinds
 * off what a prototype baked. A plant added to the library tomorrow works here
 * with no change to this file.
 *
 * ## It knows nothing about your camera either
 *
 * Levels are the caller's decision, exactly as they are for a single plant.
 * The field never measures a distance and never changes a level on its own:
 *
 * ```js
 * field.setLevels(levels);          // one index per placement
 * field.setLevelAt(index, 2);       // or one at a time
 * ```
 *
 * The budget is advisory for the same reason. If the levels you chose need
 * more instances than you budgeted for, the field draws them anyway and says
 * so in `stats().overBudget`. Silently coarsening a plant you explicitly asked
 * for would be the library overruling you, which is the thing this design is
 * built to avoid.
 */

/**
 * Organ instances the whole field may draw at once, across every organ kind.
 *
 * One field-wide number rather than one per kind, deliberately: band assignment
 * has to enforce it, and a placement is promoted or demoted as a whole plant —
 * its leaves and its petioles move together. Because the total is capped, no
 * single kind can exceed it either, which is what lets each buffer be allocated
 * once and never overflow.
 *
 * Roughly 32 MB of matrices. Raise it for a static hero shot, lower it for a
 * tight frame budget.
 *
 * **What this default actually buys, measured.** A mature Forsythia still draws
 * about 2,100 organ instances at its *coarsest* band — the far band coarsens
 * the wood but keeps every surviving leaf as real geometry. So this budget
 * seats somewhere around 230 of them before band assignment runs out of
 * demotions and the budget is simply exceeded, which `stats().overBudget`
 * reports. That ceiling is not a property of the budget; it is the missing
 * far/imposter band. Until the coarsest band becomes a card rather than a
 * canopy, a large field either costs proportionally more memory or loses its
 * furthest plants, and no choice of number here changes that.
 */
export const DEFAULT_INSTANCE_BUDGET = 500_000;

const matrix = new THREE.Matrix4();
const organMatrix = new THREE.Matrix4();
const colour = new THREE.Color();
const bounds = new THREE.Box3();
const placementBounds = new THREE.Box3();

/**
 * `InstancedMesh2.removeInstances` takes its ids as rest arguments, and one
 * mature forsythia carries more than four thousand organs of a single kind.
 * Spreading that many arguments is close enough to an engine's argument limit
 * to be worth chunking here rather than discovering the ceiling in someone
 * else's browser.
 */
const REMOVE_CHUNK = 4096;

function freeInstances(mesh, ids) {
  for (let start = 0; start < ids.length; start += REMOVE_CHUNK) {
    const end = Math.min(start + REMOVE_CHUNK, ids.length);
    mesh.removeInstances(...ids.subarray(start, end));
  }
}

/** Accept a Vector3, an array or an {x,y,z}. */
function toVector(value) {
  if (value == null) return new THREE.Vector3();
  if (value.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3().fromArray(value);
  return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

function organAt(prototype, level, kind) {
  return prototype.bands[level].baked.organs.find(
    (organ) => organ.kind === kind,
  );
}

function sameOrganVariant(a, b) {
  return (
    a.geometry === b.geometry &&
    a.castShadow === b.castShadow &&
    a.receiveShadow === b.receiveShadow
  );
}

export class PlantFieldCore extends THREE.Group {
  static InstancedMesh2 = null;
  static validateBackend() {}
  static prepareMaterial(material) {
    return material;
  }
  static prepareInstance() {}
  static useCustomShadowMaterials = true;

  /**
   * How a backend is told which band a wood instance is drawn at.
   *
   * The WebGL backend evaluates a callback per instance per frame. A GPU
   * backend cannot run JavaScript inside its culling kernel, so it overrides
   * these to write the same decision as per-instance state instead. Either
   * way the field decides; only the delivery differs.
   */
  static installWoodLODResolver(mesh, resolve) {
    mesh.resolveLODIndex = resolve;
  }

  static applyWoodLevel() {}

  /**
   * @param {object} options
   * @param {object[]} options.prototypes Same species, from
   *   `createPlantPrototype`. A field scatters placements across them.
   * @param {object[]} options.placements `{ position, rotationY?, scale?,
   *   prototype? }`. `prototype` is an index into `prototypes`; omitted, one is
   *   chosen deterministically from the placement's index.
   * @param {number} [options.budget] Peak organ instances for the whole
   *   field, across every organ kind.
   * @param {THREE.WebGLRenderer|import('three/webgpu').WebGPURenderer}
   *   [options.renderer] Renderer for the selected backend. Passing it is
   *   strongly recommended for WebGL: without it instanced-mesh initialises its
   *   buffers during the first render and draws nothing on frame one — invisible
   *   in a render loop, a blank image for a single-shot render such as a
   *   thumbnail or a poster. WebGPU storage buffers are initialized eagerly.
   * @param {boolean} [options.castShadow]
   * @param {boolean} [options.receiveShadow]
   * @param {boolean} [options.perInstanceCulling] Let instanced-mesh test every
   *   organ against the frustum, every frame. True by default, because a field
   *   whose caller does nothing must still not draw what is behind it -- but it
   *   is the wrong tool at field scale and measurably so. The test is per organ:
   *   400 plants at their coarsest band is 434,000 spheres per frame, twice over
   *   with shadows, costing ~36 ms to reject about three quarters of them. One
   *   sphere per plant reaches the same answer in 0.007 ms. If you cull whole
   *   plants yourself with `setVisibility`, turn this off; `placementSphere` gives
   *   you the bounds to test.
   */
  constructor({
    prototypes,
    placements,
    budget = DEFAULT_INSTANCE_BUDGET,
    renderer = null,
    castShadow = true,
    receiveShadow = true,
    perInstanceCulling = true,
    name = 'PlantField',
  } = {}) {
    super();

    // Fail here rather than render a field whose per-instance transforms never
    // reach the shader. See three-copy-guard.js for why this is not paranoia.
    this.constructor.validateBackend();
    if (typeof this.constructor.InstancedMesh2 !== 'function') {
      throw new TypeError('PlantField needs an InstancedMesh2 backend.');
    }

    if (!Array.isArray(prototypes) || prototypes.length === 0) {
      throw new TypeError('A field needs at least one prototype.');
    }
    if (!Array.isArray(placements) || placements.length === 0) {
      throw new TypeError('A field needs at least one placement.');
    }

    this.name = name;
    this._prototypes = prototypes;
    this._budget = budget;
    this._renderer = renderer;
    this._perInstanceCulling = perInstanceCulling;
    this._bandsPerPrototype = prototypes[0].bands.length;

    for (const prototype of prototypes) {
      if (prototype.bands.length !== this._bandsPerPrototype) {
        throw new RangeError(
          'Every prototype in a field must share the same LOD bands.',
        );
      }
    }

    this._placements = placements.map((placement, index) => {
      const which = placement.prototype ?? index % prototypes.length;
      const prototype = prototypes[which];
      if (!prototype) {
        throw new RangeError(`Placement ${index} names no known prototype.`);
      }
      const transform = new THREE.Matrix4().compose(
        toVector(placement.position),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          placement.rotationY ?? 0,
        ),
        new THREE.Vector3().setScalar(placement.scale ?? 1),
      );
      const level = placement.level ?? 0;
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level >= prototype.bands.length
      ) {
        throw new RangeError(
          `Placement ${index} asks for level ${level}; this prototype has ` +
            `${prototype.bands.length}.`,
        );
      }
      return { prototype, which, transform, level };
    });

    this._levels = Int32Array.from(this._placements.map((p) => p.level));
    this._organMeshes = new Map();
    this._woodMeshes = [];
    this._stats = {
      drawCalls: 0,
      organInstances: 0,
      overBudget: false,
      repacks: 0,
      instanceWrites: 0,
    };
    this._backendMaterialCache = new WeakMap();
    this._temporaryBackendMaterials = new Set();

    // One id list per placement per organ kind, and the reason a level change
    // costs one plant rather than the whole field. A placement's instances are
    // found by lookup instead of by re-deriving every offset from the counts of
    // every placement before it, which is what forced the old full rebuild.
    this._slots = this._placements.map(() => new Map());
    // Every placement starts drawn. Hiding is the caller's call, exactly as
    // choosing a level is -- the field still reads no camera.
    this._visible = new Uint8Array(this._placements.length).fill(1);

    try {
      this._createWoodMeshes({ castShadow, receiveShadow });
      this._createOrganMeshes({ castShadow, receiveShadow });
    } finally {
      // Backends clone the prepared source synchronously while constructing
      // each mesh. A WebGPU adapter can therefore hand over a clean TSL source
      // without mutating or taking ownership of the plant's WebGL material.
      for (const material of this._temporaryBackendMaterials) {
        material.dispose?.();
      }
      this._temporaryBackendMaterials.clear();
      this._backendMaterialCache = null;
    }
    for (let index = 0; index < this._placements.length; index += 1) {
      this._writePlacement(index, this._levels[index]);
    }
    this._computeFieldBounds();
  }

  /* ------------------------------------------------------------------ *
   * Construction
   * ------------------------------------------------------------------ */

  _prepareBackendMaterial(material) {
    if (Array.isArray(material)) {
      return material.map((entry) => this._prepareBackendMaterial(entry));
    }
    if (!material?.isMaterial) {
      throw new TypeError(
        'A field backend material must be a Three.js material.',
      );
    }
    const cached = this._backendMaterialCache.get(material);
    if (cached) return cached;

    const prepared = this.constructor.prepareMaterial(material);
    if (!prepared?.isMaterial) {
      throw new TypeError('PlantField.prepareMaterial must return a material.');
    }
    this._backendMaterialCache.set(material, prepared);
    if (prepared !== material) this._temporaryBackendMaterials.add(prepared);
    return prepared;
  }

  /**
   * One mesh per prototype, carrying that prototype's wood at every band as
   * real geometry LODs. The mesh asks this field which already-applied band
   * each placement uses, so wood and organs cross a boundary together instead
   * of running two camera-distance state machines from two different bounds.
   */
  _createWoodMeshes({ castShadow, receiveShadow }) {
    for (const [index, prototype] of this._prototypes.entries()) {
      const placementIndexes = [];
      const placements = [];
      for (
        let placementIndex = 0;
        placementIndex < this._placements.length;
        placementIndex += 1
      ) {
        const placement = this._placements[placementIndex];
        if (placement.prototype !== prototype) continue;
        placementIndexes.push(placementIndex);
        placements.push(placement);
      }
      const [near, ...rest] = prototype.bands;
      if (!near.baked.wood || placements.length === 0) {
        this._woodMeshes.push(null);
        continue;
      }

      const mesh = new this.constructor.InstancedMesh2(
        near.baked.wood.geometry,
        this._prepareBackendMaterial(near.baked.wood.material),
        { capacity: placements.length, renderer: this._renderer },
      );
      mesh.name = `${this.name}_Wood_${index}`;
      // One wood mesh holds every placement of this prototype, so its own
      // object-level bound spans the whole field and testing it would only
      // ever answer yes. Culling happens per instance, below.
      mesh.frustumCulled = false;
      // Wood is culled against the whole plant, not against its own branches.
      // A wood instance represents the entire skeleton but its geometry bound
      // covers only the branches, so testing that bound could remove the
      // skeleton while leaf cards from the same placement remain. Replacing
      // the sphere with the prototype's full bounds makes wood the most
      // conservative bound in the field, which is what makes it safe to cull
      // per instance at all.
      placementBounds.copy(prototype.bounds);
      mesh.geometry.boundingSphere = placementBounds.getBoundingSphere(
        new THREE.Sphere(),
      );
      mesh.perObjectFrustumCulled = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;

      const renderLevelForBand = new Int32Array(prototype.bands.length);
      let renderLevel = 0;
      for (const [restIndex, band] of rest.entries()) {
        if (band.baked.wood) {
          mesh.addLOD(
            band.baked.wood.geometry,
            this._prepareBackendMaterial(band.baked.wood.material),
            band.distance,
            band.hysteresis,
          );
          renderLevel += 1;
        }
        renderLevelForBand[restIndex + 1] = renderLevel;
      }

      // The shadow pass gets the coarsest wood it can. A silhouette needs the
      // outline, not the bark, and this is the same trade Phase 1 makes for a
      // single plant — expressed per instance here rather than per plant.
      const coarsest = prototype.bands.at(-1);
      if (castShadow && coarsest !== near && coarsest.baked.wood) {
        mesh.addShadowLOD(near.baked.wood.geometry);
        mesh.addShadowLOD(coarsest.baked.wood.geometry, coarsest.distance);
      }

      // `FieldViewDriver` chooses and throttles one band per whole plant. Feed
      // that exact applied choice into instanced-mesh for both the visual and
      // shadow passes. This also makes the app's `lod=` scale affect wood and
      // foliage together; no branch can jump early because its geometry sphere
      // has a different centre from the conservative plant sphere.
      const shadowLevelForBand = new Int32Array(prototype.bands.length);
      const hasShadowLevels = mesh.LODinfo?.shadowRender?.levels.length > 0;
      if (mesh.LODinfo?.shadowRender?.levels.length > 1) {
        shadowLevelForBand[prototype.bands.length - 1] = 1;
      }
      const woodBands = {
        renderLevelForBand,
        shadowLevelForBand,
        hasShadowLevels,
      };
      this.constructor.installWoodLODResolver(
        mesh,
        (slot, _renderView, _distanceView, computedIndex, isShadowPass) => {
          const placementIndex = placementIndexes[slot];
          if (placementIndex === undefined) return computedIndex;
          const band = this._levels[placementIndex];
          return isShadowPass && hasShadowLevels
            ? shadowLevelForBand[band]
            : renderLevelForBand[band];
        },
      );

      mesh.addInstances(placements.length);
      for (const [slot, placement] of placements.entries()) {
        mesh.setMatrixAt(slot, placement.transform);
        // Remembered so a hidden plant loses its trunk as well as its leaves.
        placement.woodMesh = mesh;
        placement.woodSlot = slot;
        placement.woodBands = woodBands;
        this._applyWoodLevel(placementIndexes[slot]);
      }
      mesh.computeBoundingBox();

      this._woodMeshes.push(mesh);
      this.add(mesh);
    }
  }

  /**
   * One mesh per compatible geometry rung of an organ kind for the field.
   */
  _createOrganMeshes({ castShadow, receiveShadow }) {
    const kinds = [];
    for (const prototype of this._prototypes) {
      for (const kind of prototype.organKinds) {
        if (!kinds.includes(kind)) kinds.push(kind);
      }
    }

    for (const kind of kinds) {
      const sources = [];
      for (const prototype of this._prototypes) {
        for (const band of prototype.bands) {
          const source = band.baked.organs.find((organ) => organ.kind === kind);
          if (
            source &&
            !sources.some((candidate) => sameOrganVariant(candidate, source))
          ) {
            sources.push(source);
          }
        }
      }
      if (sources.length === 0) continue;

      const variants = [];
      for (const [variantIndex, source] of sources.entries()) {
        const capacity = Math.max(
          1,
          this._placements.reduce((total, placement) => {
            const organ = organAt(placement.prototype, placement.level, kind);
            return organ && sameOrganVariant(source, organ)
              ? total + organ.count
              : total;
          }, 0),
        );
        const organGeometry = source.geometry.clone();
        organGeometry.deleteAttribute('instanceIndex');
        const mesh = new this.constructor.InstancedMesh2(
          organGeometry,
          this._prepareBackendMaterial(source.material),
          { capacity, renderer: this._renderer },
        );
        mesh.name = `${this.name}_${source.name}_Rung${variantIndex}`;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = castShadow && source.castShadow;
        mesh.receiveShadow = receiveShadow && source.receiveShadow;
        if (this.constructor.useCustomShadowMaterials) {
          if (source.customDepthMaterial) {
            mesh.customDepthMaterial = source.customDepthMaterial;
          }
          if (source.customDistanceMaterial) {
            mesh.customDistanceMaterial = source.customDistanceMaterial;
          }
        }
        mesh.perObjectFrustumCulled = this._perInstanceCulling;

        variants.push({ mesh, capacity, source });
        this.add(mesh);
      }

      this._organMeshes.set(kind, {
        mesh: variants[0].mesh,
        capacity: variants.reduce(
          (total, variant) => total + variant.capacity,
          0,
        ),
        variants,
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Levels and packing
   * ------------------------------------------------------------------ */

  /** The level each placement is drawn at. A copy; use `setLevels` to change. */
  get levels() {
    return Array.from(this._levels);
  }

  /**
   * Set every placement's level at once.
   *
   * @param {ArrayLike<number>} levels One index per placement, in the order
   *   the placements were given.
   */
  setLevels(levels) {
    if (levels?.length !== this._placements.length) {
      throw new RangeError(
        `Expected ${this._placements.length} levels, got ${levels?.length}.`,
      );
    }

    // Validate the whole set before touching anything, so a bad level leaves
    // the field exactly as it was rather than half applied.
    for (let index = 0; index < levels.length; index += 1) {
      this._validateLevel(index, levels[index]);
    }

    for (let index = 0; index < levels.length; index += 1) {
      if (levels[index] !== this._levels[index]) {
        this._writePlacement(index, levels[index]);
      }
    }
    return this;
  }

  /**
   * Set one placement's level.
   *
   * @param {number} index
   * @param {number} level
   */
  setLevelAt(index, level) {
    if (!Number.isInteger(index) || index < 0 || index >= this._levels.length) {
      throw new RangeError(`No placement at index ${index}.`);
    }
    this._validateLevel(index, level);
    if (this._levels[index] === level) return this;
    this._writePlacement(index, level);
    return this;
  }

  _validateLevel(index, level) {
    const available = this._placements[index].prototype.bands.length;
    if (!Number.isInteger(level) || level < 0 || level >= available) {
      throw new RangeError(
        `Placement ${index} was given level ${level}; it has ${available}.`,
      );
    }
  }

  /**
   * Which placements are currently drawn. A copy; use `setVisibility`.
   *
   * Deliberately not called `visible`: this is a `THREE.Group`, and `visible`
   * is Object3D's own flag for the whole field. These are its placements.
   */
  get visibility() {
    return Array.from(this._visible, (flag) => flag === 1);
  }

  /**
   * Show or hide one placement -- its organs and its wood together.
   *
   * ## What this is for
   *
   * Culling, done at the granularity that suits a field. Organs are pooled per
   * kind across every plant, so the renderer's own per-instance culling has
   * nothing coarser than a single leaf to reason about, and pays for that
   * granularity on every frame. A caller knows something the renderer does not:
   * that those leaves belong to a plant, and that a plant behind you takes all
   * of them with it. `placementSphere` gives you the bounds; this hides what
   * fails the test.
   *
   * Hiding writes a visibility flag per organ and no matrices, so it is cheap
   * and touches no GPU buffer. It is not free -- a plant is a few hundred to a
   * few thousand flags -- so hide on change, not every frame.
   *
   * Like levels, this is never decided here. The field reads no camera.
   *
   * @param {number} index
   * @param {boolean} visible
   */
  setVisibleAt(index, visible) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this._visible.length
    ) {
      throw new RangeError(`No placement at index ${index}.`);
    }
    const flag = visible ? 1 : 0;
    if (this._visible[index] === flag) return this;
    this._visible[index] = flag;
    return this._applyVisibility(index);
  }

  /**
   * Show or hide every placement at once.
   * @param {ArrayLike<boolean|number>} flags One per placement.
   */
  setVisibility(flags) {
    if (flags?.length !== this._visible.length) {
      throw new RangeError(
        `Expected ${this._visible.length} flags, got ${flags?.length}.`,
      );
    }
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index] ? 1 : 0;
      if (this._visible[index] === flag) continue;
      this._visible[index] = flag;
      this._applyVisibility(index);
    }
    return this;
  }

  /**
   * Tell the backend which band this placement's wood is drawn at.
   *
   * A no-op on a backend that reads the resolver callback instead.
   */
  _applyWoodLevel(index) {
    const placement = this._placements[index];
    const bands = placement?.woodBands;
    if (!bands || !placement.woodMesh) return this;

    const band = this._levels[index];
    this.constructor.applyWoodLevel(
      placement.woodMesh,
      placement.woodSlot,
      bands.renderLevelForBand[band],
      bands.hasShadowLevels ? bands.shadowLevelForBand[band] : -1,
    );
    return this;
  }

  _applyVisibility(index) {
    const visible = this._visible[index] === 1;
    for (const { variant, ids } of this._slots[index].values()) {
      for (let slot = 0; slot < ids.length; slot += 1) {
        variant.mesh.setVisibilityAt(ids[slot], visible);
      }
    }
    const placement = this._placements[index];
    placement.woodMesh?.setVisibilityAt(placement.woodSlot, visible);
    return this;
  }

  /**
   * One placement's world-space bounding sphere.
   *
   * Published so a caller can cull whole plants without reaching inside. The
   * placements never move, so this is worth computing once and keeping.
   *
   * @param {number} index
   * @param {THREE.Sphere} [target]
   */
  placementSphere(index, target = new THREE.Sphere()) {
    const placement = this._placements[index];
    if (!placement) throw new RangeError(`No placement at index ${index}.`);
    placementBounds
      .copy(placement.prototype.bounds)
      .applyMatrix4(placement.transform);
    return placementBounds.getBoundingSphere(target);
  }

  /**
   * Write one placement's organs at one level, and only that placement's.
   *
   * ## Why this is not a repack
   *
   * The instances of one plant are found by lookup in `_slots`, so the work
   * here is proportional to that plant's own organ count and does not move when
   * the field grows. That is the property `test/plant-field.test.js` pins, and
   * it is the whole difference between a level change costing a plant and a
   * level change costing the field.
   *
   * It works because `InstancedMesh2` maintains a free list: `removeInstances`
   * hands slots back, `addInstances` takes them again before it extends the
   * buffer. Freeing this placement's ids immediately before allocating its new
   * ones means the new instances land in the slots the old ones just vacated,
   * so a field that walks up and down its levels does not accumulate holes.
   *
   * The matrices come from the target band's own bake. A coarser band is the
   * finer one with organs culled and the survivors uniformly scaled, so this
   * could in principle touch only the difference -- but writing the plant whole
   * is a few hundred microseconds, needs no assumption about how a species
   * builds its bands, and keeps this method something you can read.
   */
  _writePlacement(index, level) {
    const placement = this._placements[index];
    const slots = this._slots[index];
    let written = 0;

    for (const [kind, entry] of this._organMeshes) {
      const previous = slots.get(kind);
      if (previous?.ids.length) {
        freeInstances(previous.variant.mesh, previous.ids);
        this._stats.organInstances -= previous.ids.length;
        slots.delete(kind);
      }

      const organ = organAt(placement.prototype, level, kind);
      const count = organ?.count ?? 0;
      if (count === 0) continue;
      const variant = entry.variants.find((candidate) =>
        sameOrganVariant(candidate.source, organ),
      );
      if (!variant) {
        throw new Error(`No field geometry rung for organ kind ${kind}.`);
      }
      const { mesh } = variant;

      // `addInstances` chooses the ids -- reused ones first -- so they are
      // captured here in the order it hands them out, and the organ at local
      // position n is written to ids[n].
      const ids = new Uint32Array(count);
      let cursor = 0;
      mesh.addInstances(count, (_instance, id) => {
        ids[cursor++] = id;
      });

      for (let local = 0; local < count; local += 1) {
        const id = ids[local];
        organMatrix.fromArray(organ.matrices, local * 16);
        matrix.multiplyMatrices(placement.transform, organMatrix);
        const instanceColour = organ.colors
          ? colour.fromArray(organ.colors, local * 3)
          : null;
        this.constructor.prepareInstance(
          organ.material,
          matrix,
          instanceColour,
        );
        mesh.setMatrixAt(id, matrix);
        if (instanceColour) mesh.setColorAt(id, instanceColour);
      }

      slots.set(kind, { variant, ids });
      this._stats.organInstances += count;
      written += count;
    }

    // New instances are created visible, so a hidden plant that changes level
    // would otherwise reappear.
    if (this._visible[index] === 0) this._applyVisibility(index);

    this._levels[index] = level;
    this._applyWoodLevel(index);
    this._stats.repacks += 1;
    this._stats.instanceWrites += written;
    // Drawn as asked. If the levels the caller chose need more instances than
    // they budgeted for, the field draws them anyway and says so: quietly
    // coarsening a plant that was explicitly asked for would be the library
    // overruling the caller, which is the thing this design avoids.
    this._stats.overBudget = this._stats.organInstances > this._budget;
    return written;
  }

  /**
   * The field's extent, computed once.
   *
   * Placements never move, so this is a property of the placement list and the
   * prototypes' own bounds, not of which level each plant currently draws at.
   * The previous implementation recomputed it inside every level change by
   * walking every instance matrix in the field and transforming a box by each
   * one -- measured at 0.61 microseconds per instance, the single largest cost
   * of a level change, and spent entirely to rediscover that nothing had moved.
   *
   * `prototype.bounds` already unions every band, so the box covers a plant at
   * its finest detail whatever level it is drawn at now.
   */
  _computeFieldBounds() {
    bounds.makeEmpty();
    for (const placement of this._placements) {
      placementBounds
        .copy(placement.prototype.bounds)
        .applyMatrix4(placement.transform);
      bounds.union(placementBounds);
    }

    for (const { variants } of this._organMeshes.values()) {
      for (const { mesh } of variants) {
        mesh.boundingBox = bounds.clone();
        mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      }
    }
    return this;
  }

  /**
   * Squeeze the slack out of the instance buffers.
   *
   * ## Why there is slack at all
   *
   * Demoting a plant frees more slots than the coarser band takes back, and
   * `InstancedMesh2` only shortens its array from the tail. So the arrays settle
   * at the high-water mark of the finest arrangement the field has ever been
   * asked to draw, and the difference sits there inactive. Inactive slots draw
   * nothing, but the per-frame culling pass still steps over them, so a field
   * that spent one moment entirely at its finest band keeps paying a small scan
   * cost for it afterwards.
   *
   * That is a deliberate trade. The alternative -- repacking so the buffers stay
   * exactly the size of what is drawn -- is what made a single plant's level
   * change cost the whole field.
   *
   * `stats().slots` and `stats().unusedSlots` report the slack. This reclaims
   * it, at the price of rewriting every placement, so call it when a pause is
   * acceptable rather than inside a render loop.
   */
  compact() {
    for (const { variants } of this._organMeshes.values()) {
      for (const { mesh } of variants) mesh.clearInstances();
    }
    for (const slots of this._slots) slots.clear();
    this._stats.organInstances = 0;

    for (let index = 0; index < this._placements.length; index += 1) {
      this._writePlacement(index, this._levels[index]);
    }
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Frame loop
   * ------------------------------------------------------------------ */

  /**
   * Advance wind.
   *
   * The wind belongs to the source plants: the field draws their materials, and
   * the wind uniforms live on those materials' compiled shaders. Advancing the
   * prototypes' plants is what makes the whole field move.
   *
   * Takes no camera. Levels are `setLevels` / `setLevelAt`, and they change
   * only when you say so.
   *
   * @param {number} [deltaSeconds]
   * @param {number} [elapsedSeconds]
   */
  update(deltaSeconds = 0, elapsedSeconds) {
    const advanced = new Set();
    for (const prototype of this._prototypes) {
      if (advanced.has(prototype.plant)) continue;
      advanced.add(prototype.plant);
      prototype.plant.update(deltaSeconds, elapsedSeconds);
    }
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Reporting and teardown
   * ------------------------------------------------------------------ */

  /**
   * What the field costs right now.
   *
   * `drawCalls` is the field's whole contribution to the frame: one per active
   * compatible organ rung, plus one per prototype's wood. It does not grow with
   * the number of plants, which is the entire claim this class makes.
   */
  stats() {
    let organDraws = 0;
    for (const { variants } of this._organMeshes.values()) {
      for (const { mesh } of variants) {
        if (mesh.instancesCount > 0) organDraws += 1;
      }
    }

    let slots = 0;
    const slotsByKind = {};
    for (const [kind, { variants }] of this._organMeshes) {
      slotsByKind[kind] = variants.reduce(
        (total, { mesh }) => total + mesh._instancesArrayCount,
        0,
      );
      slots += slotsByKind[kind];
    }

    let visiblePlants = 0;
    for (const flag of this._visible) visiblePlants += flag;
    const woodDraws = this._woodMeshes.filter(
      (mesh) => mesh && mesh.instancesCount > 0,
    ).length;

    const levelCounts = new Array(this._bandsPerPrototype).fill(0);
    for (const level of this._levels) levelCounts[level] += 1;

    return {
      plants: this._placements.length,
      prototypes: this._prototypes.length,
      drawCalls: organDraws + woodDraws,
      organDrawCalls: organDraws,
      woodDrawCalls: woodDraws,
      organInstances: this._stats.organInstances,
      budget: this._budget,
      /**
       * The levels you chose need more instances than you budgeted for. The
       * field drew them anyway; this is a number to act on, not a state it
       * corrected.
       */
      overBudget: this._stats.overBudget,
      /** How many placements sit at each level. */
      levelCounts,
      /** Placements currently drawn. The rest are hidden by `setVisibility`. */
      visiblePlants,
      /**
       * How many placements have had their instances written since the field
       * was built, counting the initial build. A level change writes one
       * placement, so this rises by one per plant that actually moved band.
       */
      repacks: this._stats.repacks,
      /**
       * Organ instances written since the field was built. The number to watch
       * if a level change ever feels expensive: it should track the plants that
       * changed, never the size of the field.
       */
      instanceWrites: this._stats.instanceWrites,
      /**
       * Instance slots the organ buffers currently span, drawn or not. Sits at
       * the high-water mark of the finest arrangement the field has been asked
       * for, because freed slots are only reclaimed from the tail.
       */
      slots,
      /**
       * The same span, per organ kind. A band that drops a kind outright --
       * hydrangea's millimetre-wide stems past seven metres -- empties that
       * kind's buffer to its first slot, and because every freed slot in it is
       * then tail, the whole span goes back. Reading `slots` alone, that looks
       * like the high-water mark falling; per kind it is visibly the rule
       * working rather than an exception to it.
       */
      slotsByKind,
      /**
       * Slots inside that span which draw nothing. They cost one array read
       * each per frame in the culling pass; `compact()` reclaims them.
       */
      unusedSlots: slots - this._stats.organInstances,
    };
  }

  /**
   * Release the field's own meshes.
   *
   * Not the prototypes, and never the source plants: their materials are what
   * this field was drawing, and the caller owns them. Dispose the prototypes,
   * then the plants, in that order, when the field is truly finished with.
   */
  dispose() {
    for (const mesh of this._woodMeshes) mesh?.dispose?.();
    for (const { variants } of this._organMeshes.values()) {
      for (const { mesh } of variants) {
        // Organ geometry is cloned specifically for this field mesh; materials
        // still belong to the source plants and must remain alive.
        mesh.geometry.dispose();
        mesh.dispose?.();
      }
    }
    this._woodMeshes.length = 0;
    this._organMeshes.clear();
    for (const slots of this._slots) slots.clear();
    this._slots.length = 0;
    this.clear();
  }
}

export default PlantFieldCore;
