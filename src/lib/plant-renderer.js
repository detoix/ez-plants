import * as THREE from 'three';
import { LeafWind } from './leaf-wind.js';
import { PlantInstancePool } from './plant-instance-pool.js';
import { ResourceTracker } from './resource-tracker.js';
import { PlantLODController } from './plant-lod.js';
import {
  normalizePlantDetail,
  samplePlantDetailSections,
  stablePlantOrganDetailScale,
} from './plant-detail.js';
import { vector } from './plant-transforms.js';
import {
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
  createCurveBranchSections,
  sampleBranchSection,
} from './woody-geometry.js';
import {
  calculateBarkTextureWraps,
  createBarkMaterial,
} from './woody-material.js';
import { createBarkMaps } from './bark-plate.js';

// EZ-Tree expresses bark textureScale.x per unit of branch radius; the plants
// in this library are modelled in metres, so this is wraps per metre of radius.
const DEFAULT_BARK_WRAPS_PER_METRE_RADIUS = 250;

/**
 * Machinery shared by every multi-cane shrub renderer in this library.
 *
 * This base owns the parts that are the same whether the plant fruits on new
 * wood like a blackcurrant or flowers on bare old wood like a forsythia:
 * group layout, tracked materials and geometry, stable-capacity instance
 * pools, the EZ-Tree woody meshing pass, distance LOD, and the
 * validate-evaluate-apply state cycle.
 *
 * It deliberately does NOT try to generalize organ placement. Where an organ
 * sits on an axis, what colour it turns and when it appears is the species,
 * so subclasses implement `_buildStableGraph`, `_applySnapshot` and
 * `_evaluate` themselves.
 *
 * Members prefixed with `_` are protected: subclasses in this library use
 * them, callers outside it should not.
 */
export class PlantRenderer extends THREE.Group {
  constructor({
    plantId,
    seed,
    profile,
    organKinds,
    namePrefix,
    maxYears = 50,
    ageYears = 0,
    dayOfYear = 1,
    assets = {},
    defaultLeafPlate = null,
    events = [],
    extraStateKeys = [],
    detailStrideSalt,
    lodLevels = null,
    leafWind = {},
    barkTint = 0x5b5247,
  } = {}) {
    super();

    if (!profile || typeof profile !== 'object') {
      throw new TypeError('A cultivar profile is required.');
    }
    if (!Array.isArray(organKinds) || organKinds.length === 0) {
      throw new TypeError('At least one instanced organ kind is required.');
    }

    this._profile = profile;
    this._organKinds = Object.freeze([...organKinds]);
    this._namePrefix = namePrefix ?? 'Plant';
    this._detailStrideSalt = detailStrideSalt ?? `${this._namePrefix}-detail`;
    this._extraStateKeys = Object.freeze([...extraStateKeys]);
    this._barkTint = barkTint;

    this.cultivar = profile.cultivar;
    this.name = `${this._namePrefix}_${this.cultivar}`;
    this.seed = seed ?? 1;
    this._plantId = String(
      plantId ?? `${this._namePrefix.toLowerCase()}:${this.seed}`,
    ).trim();
    if (!this._plantId) throw new TypeError('plantId cannot be empty');

    this.maxYears = THREE.MathUtils.clamp(
      Math.floor(PlantRenderer.number(maxYears, 50)),
      1,
      50,
    );
    this.ageYears = PlantRenderer.simulationYear(ageYears, 0, this.maxYears);
    this.dayOfYear = THREE.MathUtils.clamp(
      Math.floor(PlantRenderer.number(dayOfYear, 1)),
      1,
      365,
    );

    const leaf = assets.leaf ?? {};
    // The plant's own plate is the default; a caller-supplied map wins. Rule 7
    // requires the plant to render correctly with nothing supplied at all.
    const leafMap = leaf.map ?? defaultLeafPlate ?? null;
    this._assets = {
      bark: assets.bark ?? null,
      leaf: Object.freeze({
        map: leafMap,
        tint: leaf.tint ?? 0xffffff,
        // An alpha test compares against alpha 1.0 when there is no map, so it
        // discards nothing and every leaf card renders as an opaque rectangle.
        // Without a plate the cards must stay untested rather than un-cut.
        alphaTest: leafMap ? (leaf.alphaTest ?? 0.5) : 0,
        roundedNormals: leaf.roundedNormals ?? true,
      }),
    };

    if (events != null && !Array.isArray(events)) {
      throw new TypeError('events must be an array of care event objects.');
    }
    this._events = [];
    this._snapshot = null;
    this._renderStats = {};
    this._resources = new ResourceTracker();
    this._detail = Object.freeze(normalizePlantDetail());
    this._woodSnapshotKey = null;
    this._lodController = null;
    this._lodLevels = lodLevels;
    this._instancePool = null;
    this._woodMesh = null;
    this._materials = {};
    this._runtime = { axes: new Map() };

    this.userData.species = profile.species;
    this.userData.cultivar = profile.cultivar;
    this.userData.units = profile.unit ?? 'metres';

    this._leafWind = new LeafWind({
      strength: new THREE.Vector3(0.085, 0, 0.085),
      frequency: 0.5,
      scale: 1.4,
      ...leafWind,
    });

    this._createGroups();

    // Renderer internals are protected, not public. Keeping them
    // non-enumerable means `Object.keys(plant)` and object spreads show the
    // plant's state -- age, day, cultivar -- and never its
    // machinery, the same guarantee hard-private fields used to give.
    this._protect(...Object.keys(this).filter((key) => key.startsWith('_')));
  }

  /**
   * Declare protected slots so they stay off the enumerable public surface.
   * Base fields are covered automatically; a subclass calls this for
   * protected fields of its own, before or after assigning them.
   */
  _protect(...names) {
    for (const name of names) {
      Object.defineProperty(this, name, {
        value: this[name],
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Value helpers
   * ------------------------------------------------------------------ */

  static number(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  static simulationYear(value, fallback, maxYears, label = 'ageYears') {
    const candidate = value == null ? fallback : value;
    if (!Number.isInteger(candidate)) {
      throw new RangeError(
        `${label} must be an integer between 0 and ${maxYears}`,
      );
    }
    return THREE.MathUtils.clamp(candidate, 0, maxYears);
  }

  /* ------------------------------------------------------------------ *
   * Scene graph, materials, geometry
   * ------------------------------------------------------------------ */

  _createGroups() {
    const prefix = this._namePrefix;
    this._crown = new THREE.Group();
    this._crown.name = `${prefix}_Crown`;

    this._woodyGroup = new THREE.Group();
    this._woodyGroup.name = `${prefix}_WoodyArchitecture`;
    this._leafGroup = new THREE.Group();
    this._leafGroup.name = `${prefix}_Leaves`;
    this._flowerGroup = new THREE.Group();
    this._flowerGroup.name = `${prefix}_Inflorescences`;
    this._fruitGroup = new THREE.Group();
    this._fruitGroup.name = `${prefix}_Fruit`;

    this._crown.add(
      this._woodyGroup,
      this._leafGroup,
      this._flowerGroup,
      this._fruitGroup,
    );
    this.add(this._crown);
  }

  _material(parameters) {
    return this._resources.trackMaterial(
      new THREE.MeshStandardMaterial(parameters),
    );
  }

  /**
   * Bark for a plant whose caller supplied none. Unlike a leaf plate, bark is
   * not cultivar-specific -- all three shrubs borrow one generic set -- so it
   * is generated and shared rather than carried in each plant's folder. A
   * caller-supplied bark set replaces it wholesale.
   */
  _defaultBark() {
    if (this._assets.bark?.maps) return { textured: false };
    return {
      textured: true,
      maps: createBarkMaps(),
      // The wraps-per-metre-of-radius the demo app applies to the photographed
      // set, so procedural and supplied bark sit at the same scale.
      textureScale: { x: DEFAULT_BARK_WRAPS_PER_METRE_RADIUS, y: 5 },
    };
  }

  _barkMaterial(parameters) {
    return this._resources.trackMaterial(
      createBarkMaterial({
        ...this._defaultBark(),
        tint: this._barkTint,
        ...this._assets.bark,
        ...parameters,
      }),
    );
  }

  _geometry(geometry) {
    return this._resources.trackGeometry(geometry);
  }

  _createWoodMesh(material) {
    const geometry = this._geometry(
      createBranchBufferGeometry(createBranchGeometryData()),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${this._namePrefix}_Wood`;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'woody-architecture-batch';
    this._woodMesh = mesh;
    this._woodyGroup.add(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------------ *
   * Instancing
   * ------------------------------------------------------------------ */

  _emptyInstanceCounts() {
    return Object.fromEntries(this._organKinds.map((kind) => [kind, 0]));
  }

  /**
   * Size stable organ pools from peak annual concurrency.
   *
   * The unpruned graph is the conservative case: maintenance, pruning and
   * harvest can only remove organs. Using absolute source years makes the
   * largest annual bucket a safe concurrent bound for every season, so pools
   * never reallocate while the twin is scrubbed through time.
   */
  _sizeInstancePool({
    historicalCounts,
    annualOrganCounts,
    unknownYearCounts,
  }) {
    const maximumConcurrent = { ...unknownYearCounts };
    for (const counts of annualOrganCounts.values()) {
      for (const kind of this._organKinds) {
        maximumConcurrent[kind] = Math.max(
          maximumConcurrent[kind],
          counts[kind] + unknownYearCounts[kind],
        );
      }
    }
    this._instancePool = new PlantInstancePool({
      capacities: Object.fromEntries(
        this._organKinds.map((kind) => {
          const historicalCount = historicalCounts[kind];
          const activeBound = maximumConcurrent[kind];
          const withHeadroom =
            activeBound === 0 ? 0 : Math.ceil(activeBound * 1.15) + 8;
          return [kind, Math.min(historicalCount, withHeadroom)];
        }),
      ),
    });
    return this._instancePool;
  }

  _addInstancedOrgan(kind, options) {
    return this._resources.trackInstancedMesh(
      this._instancePool.add(kind, options),
    );
  }

  _renderIdentity(organId, kind) {
    return Object.freeze({ plantId: this._plantId, organId, kind });
  }

  _writeInstance(kind, identity, matrix, color = null) {
    return this._instancePool.write(kind, identity, matrix, color);
  }

  /** Stable, pop-free per-organ detail scale for the current LOD level. */
  _organDetailScale(
    organId,
    stride = this._detail.leafStride,
    scale = this._detail.leafScale,
  ) {
    return stablePlantOrganDetailScale(
      this.seed,
      organId,
      stride,
      scale,
      this._detailStrideSalt,
    );
  }

  /* ------------------------------------------------------------------ *
   * Woody axis runtime
   * ------------------------------------------------------------------ */

  /**
   * Build the mature, local-space woody runtime for one axis.
   *
   * Every woody axis owns its mature shape in local coordinates. The evaluated
   * snapshot supplies the moving root and growth scale, so a young lateral
   * extends from its parent instead of popping in at full length or floating
   * above a shortened main cane.
   */
  _buildAxisRuntime({ cane, axis, axisIndex, nodeAttachments }) {
    const cane_ = this._profile.cane;
    const points = axis.points.map((point) => vector(point));
    const axisNodes = axis.nodes;
    const root = points[0].clone();
    const localPoints = points.map((point) => point.clone().sub(root));
    const isPrimary = axisIndex === 0 || !axis.parentId;
    const axisOrder = axis.order;
    const radiusFactors = cane_.axisRadiusFactors;
    const radiusFactor =
      axisOrder <= 0
        ? radiusFactors.primary
        : axisOrder === 1
          ? radiusFactors.lateral
          : radiusFactors.higherOrder;
    const nominalBaseRadius = cane.baseRadiusM * radiusFactor;
    const parentAttachment = nodeAttachments.get(axis.parentId);
    const parentSection = parentAttachment
      ? sampleBranchSection(
          parentAttachment.axisRuntime.sections,
          parentAttachment.position,
        )
      : null;
    const baseRadius = parentSection
      ? Math.min(
          nominalBaseRadius,
          parentSection.radius * cane_.childParentRadiusRatio,
        )
      : nominalBaseRadius;
    const tubularSegments = isPrimary ? 12 : 7;
    const radialSegments = isPrimary ? 7 : 5;
    const sections = createCurveBranchSections(
      localPoints,
      cane_.axisTaperRatios.map((ratio) => baseRadius * ratio),
      { tubularSegments },
    );
    const caps = isPrimary ? BranchCap.Both : BranchCap.End;
    const landmarks = [
      {
        position: 0,
        origin: localPoints[0].clone(),
        organId: axis.id,
        kind: 'base',
      },
      ...axisNodes.map((node) => ({
        position: THREE.MathUtils.clamp(
          (node.index + 1) / Math.max(1, points.length - 1),
          0,
          1,
        ),
        origin: vector(node.position).sub(root),
        organId: node.id,
        kind: 'node',
      })),
      {
        position: 1,
        origin: localPoints.at(-1).clone(),
        organId: axis.id,
        kind: 'tip',
      },
    ];

    const axisRuntime = {
      id: axis.id,
      sections,
      baseRadius,
      parentRadiusAtAttachment: parentSection?.radius ?? null,
      parentAxisId: parentAttachment?.axisRuntime.id ?? null,
      caps,
      radialSegments,
      landmarks,
    };
    this._runtime.axes.set(axis.id, axisRuntime);

    for (const node of axisNodes) {
      nodeAttachments.set(node.id, {
        axisRuntime,
        position: THREE.MathUtils.clamp(
          (node.index + 1) / Math.max(1, points.length - 1),
          0,
          1,
        ),
      });
    }

    return axisRuntime;
  }

  /* ------------------------------------------------------------------ *
   * Woody meshing
   * ------------------------------------------------------------------ */

  /** Build the cheap, geometry-free state plan and cache signature. */
  _planWoodySnapshot(snapshot, detail = this._detail) {
    if (!snapshot || !Array.isArray(snapshot.canes)) {
      throw new TypeError(`A ${this._namePrefix} snapshot is required.`);
    }

    const resolved = normalizePlantDetail(detail, this._detail);
    const states = new Map();
    const childParentRadiusRatio = this._profile.cane.childParentRadiusRatio;

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      for (const axis of cane.axes) {
        const runtime = this._runtime.axes.get(axis.id);
        if (!runtime) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        const growth = THREE.MathUtils.clamp(axis.growthScale, 0, 1);
        states.set(axis.id, {
          axis,
          cane,
          runtime,
          root: vector(axis.root),
          growth,
          radiusScale: null,
          parentRadiusAtAttachment: null,
          resolvingRadius: false,
        });
      }
    }

    const resolveRadiusScale = (state) => {
      if (state.radiusScale != null) return state.radiusScale;
      if (state.resolvingRadius) {
        throw new Error(`Cyclic woody parentage at ${state.axis.id}.`);
      }
      state.resolvingRadius = true;

      let baseRadius = state.runtime.baseRadius * state.growth;
      const parentState = states.get(state.runtime.parentAxisId);
      if (parentState) {
        const parentRadiusScale = resolveRadiusScale(parentState);
        state.parentRadiusAtAttachment =
          state.runtime.parentRadiusAtAttachment * parentRadiusScale;
        baseRadius = Math.min(
          baseRadius,
          state.parentRadiusAtAttachment * childParentRadiusRatio,
        );
      }

      state.radiusScale =
        state.runtime.baseRadius > 0
          ? baseRadius / state.runtime.baseRadius
          : 0;
      state.resolvingRadius = false;
      return state.radiusScale;
    };

    const signatureAxes = [];
    for (const state of states.values()) {
      resolveRadiusScale(state);
      const { axis, root, growth, radiusScale } = state;
      signatureAxes.push([
        axis.id,
        root.x,
        root.y,
        root.z,
        growth,
        radiusScale,
      ]);
    }

    return {
      states,
      detail: resolved,
      signature: JSON.stringify([
        resolved.sectionStride,
        resolved.segmentFactor,
        signatureAxes,
      ]),
    };
  }

  /**
   * Pack one planned snapshot into the shared EZ-Tree branch buffer.
   * This is the only CPU-heavy woody meshing pass.
   */
  _meshWoodyPlan(plan) {
    const { states, detail: resolved } = plan;
    const data = createBranchGeometryData();

    for (const state of states.values()) {
      const { runtime, root, growth, radiusScale } = state;
      const radialSegments = Math.max(
        3,
        Math.round(runtime.radialSegments * resolved.segmentFactor),
      );
      const zeroGrowth = growth <= 1e-9 || radiusScale <= 1e-9;

      if (!zeroGrowth) {
        const transformedSections = runtime.sections.map((section) => ({
          origin: section.origin.clone().multiplyScalar(growth).add(root),
          tangent: section.tangent.clone(),
          normal: section.normal.clone(),
          binormal: section.binormal.clone(),
          radius: section.radius * radiusScale,
        }));
        const transformedLandmarks = runtime.landmarks.map((landmark) => {
          const sampled = sampleBranchSection(
            transformedSections,
            landmark.position,
          );
          sampled.origin = landmark.origin
            .clone()
            .multiplyScalar(growth)
            .add(root);
          return {
            position: landmark.position,
            section: sampled,
          };
        });
        const sampled = samplePlantDetailSections(
          transformedSections,
          resolved.sectionStride,
          transformedLandmarks,
        );
        const textureWraps = calculateBarkTextureWraps(
          transformedSections[0].radius,
          this._assets.bark?.textureScale?.x ??
            DEFAULT_BARK_WRAPS_PER_METRE_RADIUS,
        );
        appendBranchTube(data, sampled.sections, {
          radialSegments,
          textureWraps,
          caps: runtime.caps,
        });
      }
    }

    return {
      data,
      signature: plan.signature,
    };
  }

  _rebuildWoodyGeometry(snapshot) {
    const plan = this._planWoodySnapshot(snapshot, this._detail);
    if (plan.signature === this._woodSnapshotKey) return false;
    const meshed = this._meshWoodyPlan(plan);
    const replacement = createBranchBufferGeometry(meshed.data);
    this._resources.replaceGeometry(this._woodMesh, replacement);
    this._woodMesh.visible = meshed.data.indices.length > 0;
    this._woodSnapshotKey = meshed.signature;
    return true;
  }

  /** Number of draw calls for the current frame's committed instances. */
  _drawCallStats() {
    const woodyDrawCalls =
      this._woodMesh.visible && this._woodMesh.geometry.index?.count > 0
        ? 1
        : 0;
    return {
      woodyDrawCalls,
      drawCalls:
        woodyDrawCalls +
        this._instancePool.activeMeshes().filter((mesh) => mesh.count > 0)
          .length,
    };
  }

  /* ------------------------------------------------------------------ *
   * Detail and LOD
   * ------------------------------------------------------------------ */

  /** Repack the live wood mesh at a new private PlantDetail level. */
  _setDetail(detail = {}) {
    const resolved = Object.freeze(normalizePlantDetail(detail, this._detail));
    const unchanged =
      resolved.sectionStride === this._detail.sectionStride &&
      resolved.segmentFactor === this._detail.segmentFactor &&
      resolved.leafStride === this._detail.leafStride &&
      resolved.leafScale === this._detail.leafScale &&
      resolved.billboard === this._detail.billboard;
    if (unchanged) return this;

    const woodChanged =
      resolved.sectionStride !== this._detail.sectionStride ||
      resolved.segmentFactor !== this._detail.segmentFactor;
    this._detail = resolved;
    if (woodChanged) this._woodSnapshotKey = null;
    if (this._snapshot) this._applySnapshot(this._snapshot);
    return this;
  }

  _enableLOD(levels = this._lodLevels) {
    if (!levels) return null;
    this._lodController?.dispose();
    this._lodController = new PlantLODController({
      target: this,
      detail: this._detail,
      levels,
      applyDetail: (detail) => this._setDetail(detail),
    });
    return this._lodController;
  }

  /* ------------------------------------------------------------------ *
   * State cycle
   * ------------------------------------------------------------------ */

  /** @abstract Evaluate the growth model for the current state. */
  _evaluate() {
    throw new Error('Subclasses must implement _evaluate().');
  }

  /** @abstract Write one evaluated snapshot into instances and wood. */
  _applySnapshot() {
    throw new Error('Subclasses must implement _applySnapshot().');
  }

  setTime({ ageYears = this.ageYears, dayOfYear = this.dayOfYear } = {}) {
    return this.setState({ ageYears, dayOfYear });
  }

  /**
   * Apply a validated state change atomically.
   *
   * If the model rejects the requested combination, every field is rolled back
   * so a failed call cannot leave the twin describing a state it is not
   * rendering.
   */
  setState(patch = {}) {
    const previous = {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
    };
    for (const key of this._extraStateKeys) previous[key] = this[key];

    this.ageYears = PlantRenderer.simulationYear(
      patch.ageYears ?? this.ageYears,
      this.ageYears,
      this.maxYears,
    );
    this.dayOfYear = THREE.MathUtils.clamp(
      Math.floor(
        PlantRenderer.number(patch.dayOfYear ?? this.dayOfYear, this.dayOfYear),
      ),
      1,
      365,
    );
    for (const key of this._extraStateKeys) {
      if (patch[key] !== undefined) this[key] = patch[key];
    }

    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      for (const [key, value] of Object.entries(previous)) this[key] = value;
      throw error;
    }
    this._applySnapshot(this._snapshot);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Care events
   * ------------------------------------------------------------------ */

  /**
   * Validate one care event against this plant's time domain.
   * Subclasses hook species-specific event payloads via `_decorateEvent`.
   */
  _normaliseEvent(event, index = 0) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('A care event object is required.');
    }
    const ageYears =
      event.ageYears == null
        ? this.ageYears
        : Number.isFinite(event.ageYears)
          ? event.ageYears
          : NaN;
    const dayOfYear =
      event.dayOfYear == null
        ? this.dayOfYear
        : Number.isFinite(event.dayOfYear)
          ? Math.floor(event.dayOfYear)
          : NaN;
    if (
      !Number.isInteger(ageYears) ||
      ageYears < 0 ||
      ageYears > this.maxYears
    ) {
      throw new RangeError(
        `event ageYears must be an integer between 0 and ${this.maxYears}`,
      );
    }
    if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
      throw new RangeError('event dayOfYear must be an integer from 1 to 365');
    }
    const id = String(
      event.id ?? `event:${this.seed}:${index}:${event.type ?? 'care'}`,
    );
    if (!id) throw new TypeError('event id cannot be empty');
    return this._decorateEvent({ ...event, id, ageYears, dayOfYear });
  }

  /** Hook for species-specific event payload construction. */
  _decorateEvent(event) {
    return event;
  }

  /** Validate and seed the initial event list. Call once from a subclass. */
  _initialiseEvents(events = []) {
    this._events = events.map((event, index) =>
      this._normaliseEvent(event, index),
    );
    if (
      new Set(this._events.map((event) => event.id)).size !==
      this._events.length
    ) {
      throw new Error('Initial care event ids must be unique.');
    }
    return this._events;
  }

  addEvent(event) {
    const normalised = this._normaliseEvent(event, this._events.length);
    if (this._events.some((existing) => existing.id === normalised.id)) {
      throw new Error(`Duplicate care event id: ${normalised.id}`);
    }
    this._events.push(normalised);
    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      this._events.pop();
      throw error;
    }
    this._applySnapshot(this._snapshot);
    return normalised;
  }

  resetEvents() {
    this._events.length = 0;
    this._snapshot = this._evaluate();
    this._applySnapshot(this._snapshot);
    return this;
  }

  /** Read-only view of the applied care events. */
  get events() {
    return this._events.map((event) => ({ ...event }));
  }

  /* ------------------------------------------------------------------ *
   * Frame loop and teardown
   * ------------------------------------------------------------------ */

  update(deltaSeconds = 0, elapsedSeconds, camera) {
    this._leafWind.advance(deltaSeconds, elapsedSeconds);
    if (camera && this._lodController) this._lodController.update(camera);
  }

  dispose() {
    if (this._resources.disposed) return;
    this._lodController?.dispose({ restore: false });
    this._lodController = null;
    this._resources.dispose();
    this.clear();
  }
}

export default PlantRenderer;
