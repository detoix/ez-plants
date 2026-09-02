import * as THREE from 'three';

import { createLeafCardGeometry } from '../../leaf-geometry.js';
import { createLeafMaterialSet } from '../../leaf-material.js';
import { loadLeafPlate } from '../../leaf-plate.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { makeBasisQuaternion, vector } from '../../plant-transforms.js';
import { createRotundifoliaModel, evaluateRotundifoliaModel } from './model.js';
import { ROTUNDIFOLIA_PROFILE } from './rotundifolia.js';

const UP = new THREE.Vector3(0, 1, 0);

const MATURE_LEAF_TINT = new THREE.Color(0xffffff);
const FRESH_LEAF_TINT = new THREE.Color(0xe2ffa2);

const INSTANCE_KINDS = Object.freeze(['leaves']);

/**
 * Woody framework plus one foliage pool at every band: exactly two draws while
 * both remain visible.
 */
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({
    distance: 0,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.78,
      landmarkStride: 4,
      woodOrderLimit: 0,
      leafStride: 2,
      // One card is the visual proxy for an overlapping evergreen spray, so
      // its coverage envelope is slightly larger than the measured blade.
      leafScale: 1.68,
      organLevel: 0,
    }),
  }),
  Object.freeze({
    distance: 14,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 6,
      segmentFactor: 0.6,
      landmarkStride: 6,
      woodOrderLimit: 0,
      leafStride: 4,
      leafScale: 2.2,
      organLevel: 1,
    }),
  }),
  Object.freeze({
    distance: 24,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 10,
      segmentFactor: 0.48,
      landmarkStride: 10,
      woodOrderLimit: 0,
      leafStride: 7,
      leafScale: 2.8,
      organLevel: 1,
    }),
  }),
]);

/** The plate belongs to this cultivar folder; caller assets still override it. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));

/**
 * Persistent renderer for Prunus laurocerasus 'Rotundifolia'.
 *
 * The immutable graph is grown once with the shared EZ-Tree force model. Age
 * and day evaluation only repack its bounded instance pools and shared woody
 * mesh, preserving organ identity under arbitrary A-B-A slider scrubs.
 */
export class Cherrylaurel extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const cultivar = options.cultivar ?? ROTUNDIFOLIA_PROFILE.cultivar;
    if (cultivar !== ROTUNDIFOLIA_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${ROTUNDIFOLIA_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: ROTUNDIFOLIA_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Cherrylaurel',
      detailStrideSalt: 'cherrylaurel-rotundifolia-detail',
      plantId: options.plantId ?? `cherrylaurel:${options.seed ?? 29}`,
      seed: options.seed ?? 29,
      maxYears: options.maxYears ?? 50,
      ageYears: options.ageYears ?? 8,
      dayOfYear: options.dayOfYear ?? 119,
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind: {
        // Thick leathery leaves deflect less than thin deciduous blades, but
        // their broad surfaces still show a slow canopy-scale gust.
        strength: new THREE.Vector3(0.052, 0, 0.052),
        frequency: 0.32,
        scale: 1.9,
        ...options.leafWind,
      },
      barkTint: 0x655e51,
    });

    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;
    this.#model = createRotundifoliaModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.cane);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  #createMaterials() {
    const leafMaterials = createLeafMaterialSet({
      name: 'Cherrylaurel_Rotundifolia_GlossyLeaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: this._assets.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'cherrylaurel-rotundifolia-leaves',
    });
    // Cherry-laurel is leathery, not wet: the source plate already carries a
    // restrained photographic sheen, so the runtime lobe stays broad.
    leafMaterials.surface.roughness = 0.58;
    leafMaterials.surface.alphaToCoverage = Boolean(this._assets.leaf.map);
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);

    this._materials = {
      cane: this._barkMaterial(),
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
    };
  }

  #createInstances() {
    this._addInstancedOrgan('leaves', {
      name: 'Cherrylaurel_Leaves_Alternate_BroadElliptic',
      geometry: this._sharedGeometry(
        'shared/leaf-card',
        { roundedNormals: this._assets.leaf.roundedNormals },
        createLeafCardGeometry,
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    const leaves = this._instancePool.mesh('leaves');
    leaves.customDepthMaterial = this._materials.leafDepth;
    leaves.customDistanceMaterial = this._materials.leafDistance;
  }

  #buildStableGraph() {
    const historicalCounts = this._emptyInstanceCounts();
    const unknownYearCounts = this._emptyInstanceCounts();
    const nodeAttachments = new Map();

    for (const cane of this.#model.canes) {
      cane.axes.forEach((axis, axisIndex) => {
        this._buildAxisRuntime({ cane, axis, axisIndex, nodeAttachments });
        for (const node of axis.nodes) {
          for (const leaf of node.leaves) {
            const radial = vector(leaf.position).sub(
              vector(leaf.attachmentPosition),
            );
            if (radial.lengthSq() < 1e-8) {
              radial.set(Math.cos(leaf.azimuth), 0.04, Math.sin(leaf.azimuth));
            }
            radial.normalize();
            this._runtime.leaves.set(leaf.id, {
              id: leaf.id,
              identity: this._renderIdentity(leaf.id, 'leaf'),
              radial,
              sourceLength: leaf.lengthM,
            });
            historicalCounts.leaves += 1;
            unknownYearCounts.leaves += 1;
          }
        }
      });
    }

    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts: new Map(),
      unknownYearCounts,
    });
  }

  #setLeaf(runtime, state, nodeState, detailScale) {
    const start = vector(state.attachmentPosition ?? nodeState.position);
    const bladeStart = vector(state.position);
    const radial = bladeStart.clone().sub(start);
    if (radial.lengthSq() < 1e-8) radial.copy(runtime.radial);
    radial.normalize();
    const tangent = vector(nodeState.tangent, UP).normalize();
    const forward = radial
      .clone()
      .multiplyScalar(0.9)
      .addScaledVector(tangent, 0.1)
      .normalize();
    // Rotundifolia's broad blades read as overlapping, mostly upward-facing
    // planes rather than edge-on needles. Preserve each sampled normal while
    // applying a modest cultivar-specific upward bias.
    const normal = vector(state.normal, UP).lerp(UP, 0.22).normalize();
    const quaternion = makeBasisQuaternion(forward, normal);
    const cardScale =
      (state.lengthM ?? runtime.sourceLength) * state.scale * detailScale;
    const tint = MATURE_LEAF_TINT.clone().lerp(
      FRESH_LEAF_TINT,
      THREE.MathUtils.clamp(state.freshness, 0, 1),
    );
    this._writeInstance(
      'leaves',
      runtime.identity,
      new THREE.Matrix4().compose(
        start,
        quaternion,
        new THREE.Vector3(cardScale, cardScale, cardScale),
      ),
      tint,
    );
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this._rebuildWoodyGeometry(snapshot);

    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      visibleCanes += 1;
      for (const axis of cane.axes) {
        if (!this._runtime.axes.has(axis.id)) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes += 1;
        for (const node of axis.nodes) {
          for (const leaf of node.leaves) {
            const runtime = this._runtime.leaves.get(leaf.id);
            if (!runtime) {
              throw new Error(
                `Missing render leaf for model organ ${leaf.id}.`,
              );
            }
            const detailScale = this._organDetailScale(leaf.id);
            if (leaf.visible && detailScale > 0) {
              this.#setLeaf(runtime, leaf, node, detailScale);
              visibleLeaves += 1;
            }
          }
        }
      }
    }

    this._instancePool.commitFrame();
    this._renderStats = {
      visibleCanes,
      visibleAxes,
      visibleLeaves,
      evergreen: true,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateRotundifoliaModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this._events,
      seasonProfile: this.seasonProfile,
      offsetDays: this.offsetDays,
    });
  }

  setPhenologyProfile({
    seasonProfile = this.seasonProfile,
    offsetDays = this.offsetDays,
  } = {}) {
    return this.setState({ seasonProfile, offsetDays });
  }

  stats() {
    return {
      ...this._snapshot.stats,
      ...this._renderStats,
      species: this._snapshot.species,
      cultivar: this.cultivar,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      seasonProfile: this.seasonProfile,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Cherrylaurel',
      plantId: this._plantId,
      species: ROTUNDIFOLIA_PROFILE.species,
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      seasonProfile: this.seasonProfile,
      offsetDays: this.offsetDays,
      events: this._events.map((event) => ({ ...event })),
    };
  }
}

export default Cherrylaurel;
