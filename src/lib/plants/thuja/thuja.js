import * as THREE from 'three';

import { createLeafMaterialSet } from '../../leaf-material.js';
import { loadLeafPlate } from '../../leaf-plate.js';
import { keyedRange } from '../../keyed-random.js';
import { makeBasisQuaternion, vector } from '../../plant-transforms.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { ShadowCast } from '../../enums.js';
import {
  createThujaDepthShellGeometry,
  createThujaSprayGeometry,
} from './geometry.js';
import { createSmaragdModel, evaluateSmaragdModel } from './model.js';
import { SMARAGD_PROFILE, SMARAGD_RENDER_PRIORS } from './smaragd.js';
import {
  assertThujaWindPlanarGeometry,
  createThujaWindMetadata,
  ThujaWind,
  thujaWindDepthScale,
} from './wind.js';

const UP = new THREE.Vector3(0, 1, 0);
// The photograph supplies the foliage albedo. Material and instance colours
// stay close to white so they can provide restrained crown/season variation
// without multiplying the captured green into an unnaturally dark canopy.
const SUMMER_TINT = new THREE.Color(0xf1f7ec);
const WINTER_TINT = new THREE.Color(0xe4ede0);
const INNER_SPRAY = new THREE.Color(0xd5e3cc);
const OUTER_SPRAY = new THREE.Color(0xe7f2dd);
const FRESH_TIP = new THREE.Color(0xffffdf);
const DEPTH_SHELL_TINT = new THREE.Color(0xf2f7ed);
const SPRAY_OVERLAP_SCALE = 1.28;
const RADIAL_COMPACTION = 0.9;
const INSTANCE_KINDS = Object.freeze(['shell', 'sprays']);

/** This plant's real photographed foliage plate, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));

const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({
    distance: 0,
    detail: Object.freeze({
      organLevel: 0,
      landmarkStride: 4,
      woodOrderLimit: 0,
      shadowCast: ShadowCast.All,
      shadowReceive: true,
    }),
  }),
  Object.freeze({
    // A mature Smaragd remains screen-large at its whole-plant review
    // distance. Keep the detailed scale-spray rung until it is genuinely far.
    distance: 10,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      segmentFactor: 0.7,
      landmarkStride: 6,
      woodOrderLimit: 0,
      organLevel: 1,
      leafStride: 2,
      // Preserve projected crown coverage when every second proxy is culled.
      leafScale: 1.42,
      shadowCast: ShadowCast.Wood,
      shadowReceive: true,
    }),
  }),
  Object.freeze({
    distance: 17,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.5,
      landmarkStride: 12,
      woodOrderLimit: 0,
      organLevel: 2,
      leafStride: 4,
      // Four-to-one thinning needs almost sqrt(4) compensation. Stay just
      // under it so oblique far silhouettes do not grow beyond the cultivar
      // envelope as independently oriented fans overlap.
      leafScale: 1.92,
      shadowCast: ShadowCast.None,
      shadowReceive: true,
    }),
  }),
]);

/**
 * Thuja occidentalis 'Smaragd' on the shared EZ-Tree-derived plant renderer.
 *
 * Wood remains one merged branch mesh. Flattened scale-foliage sprays use a
 * real photographed alpha plate on a three-rung geometry ladder; one deeply
 * recessed near-band shell instance closes the optically dense core. Mid and
 * far bands drop that feature organ, leaving the EZ-Tree wood + foliage
 * two-draw budget while scale leaves read through the plate rather than one
 * mesh per millimetre-scale leaf.
 */
export class Thuja extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const leafWind = {
      strength: new THREE.Vector3(0.055, 0, 0.025),
      frequency: 0.38,
      crownHeight: SMARAGD_PROFILE.architecture.matureHeightM,
      flutterStrength: 0.008,
      flutterFrequency: 2.4,
      ...(options.leafWind ?? {}),
    };
    const requestedCultivar = options.cultivar ?? SMARAGD_PROFILE.cultivar;
    if (
      !SMARAGD_PROFILE.synonyms.includes(requestedCultivar) &&
      requestedCultivar !== SMARAGD_PROFILE.cultivar
    ) {
      throw new RangeError(
        `This renderer currently supports only the ${SMARAGD_PROFILE.cultivar} cultivar profile.`,
      );
    }
    super({
      profile: SMARAGD_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Thuja',
      detailStrideSalt: 'thuja-smaragd-spray-stride',
      plantId: options.plantId,
      seed: options.seed ?? 1950,
      maxYears: PlantRenderer.number(options.maxYears, 30),
      ageYears: options.ageYears ?? 6,
      dayOfYear: PlantRenderer.number(options.dayOfYear, 180),
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      events: options.events,
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind,
      barkTint: 0x6a4a37,
    });

    // Thuja needs hierarchy rather than the shared independent-card noise:
    // crown bend, scaffold-family motion, then restrained terminal flutter.
    this._leafWind = new ThujaWind({ ...leafWind, lod: this.level });
    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;
    this.#model = createSmaragdModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    this._initialiseEvents(options.events ?? []);
    this._runtime.sprays = new Map();
    this._protect('_leafBaseColor', '_seasonTint');
    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.wood);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  #createMaterials() {
    const foliage = createLeafMaterialSet({
      name: 'Thuja_Smaragd_Sprays',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: true,
      vertexColors: true,
      wind: this._leafWind,
      windVariant: 'thuja-smaragd-sprays',
    });
    this._resources.trackMaterial(foliage.surface);
    this._resources.trackMaterial(foliage.depth);
    this._resources.trackMaterial(foliage.distance);
    foliage.surface.alphaToCoverage = Boolean(this._assets.leaf.map);
    const shell = new THREE.MeshStandardMaterial({
      name: 'Thuja_Smaragd_Recessed_Foliage_Surface',
      color: 0xd7e5d2,
      vertexColors: true,
      flatShading: false,
      side: THREE.DoubleSide,
      metalness: 0,
      roughness: 1,
      dithering: true,
    });
    this._leafWind.apply(shell, { variant: 'thuja-smaragd-depth-shell' });
    this._resources.trackMaterial(shell);
    this._leafBaseColor = foliage.surface.color.clone();
    this._seasonTint = new THREE.Color();
    this._materials = {
      wood: this._barkMaterial(),
      shell,
      spray: foliage.surface,
      sprayDepth: foliage.depth,
      sprayDistance: foliage.distance,
    };
  }

  #buildStableGraph() {
    const historicalCounts = {
      ...this._emptyInstanceCounts(),
      shell: 1,
      sprays: SMARAGD_RENDER_PRIORS.instanceCapacity,
    };
    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts: new Map(),
      unknownYearCounts: { ...historicalCounts },
    });
    // Build every woody axis and foliage identity exactly once from the frozen
    // all-years graph. Scrubbing time only selects cohorts; it never tears down
    // and recreates runtime records for organs that already existed.
    const cane = {
      id: 'thuja:central-leader',
      baseRadiusM: SMARAGD_PROFILE.cane.baseRadiusM,
    };
    this._runtime.shell = {
      identity: this._renderIdentity('thuja:depth-shell', 'shell'),
    };
    const nodeAttachments = new Map();
    for (const [axisIndex, sourceAxis] of this.#model.axes.entries()) {
      this._buildAxisRuntime({
        cane,
        axis: sourceAxis,
        axisIndex,
        nodeAttachments,
      });
      for (const node of sourceAxis.nodes) {
        for (const spray of node.sprays ?? []) {
          const direction = vector(spray.direction, UP);
          if (direction.lengthSq() < 1e-6) direction.copy(UP);
          direction.normalize();
          const normal = vector(spray.normal, new THREE.Vector3(0, 0, 1));
          this._runtime.sprays.set(spray.id, {
            id: spray.id,
            identity: this._renderIdentity(spray.id, 'spray'),
            quaternion: makeBasisQuaternion(direction, normal),
            lengthM: spray.lengthM,
            widthM: spray.widthM,
            terminal: spray.terminal,
            familyId: spray.scaffoldId,
            colour: INNER_SPRAY.clone().lerp(
              OUTER_SPRAY,
              (spray.terminal ? 0.52 : 0.42) +
                keyedRange(this.seed, [spray.id, 'colour'], -0.07, 0.07),
            ),
          });
        }
      }
    }
  }

  #createInstances() {
    const shellGeometries = [0, 1, 2].map((level) =>
      this._sharedGeometry(
        `thuja/depth-shell-${level}`,
        { level },
        createThujaDepthShellGeometry,
      ),
    );
    const geometries = [0, 1, 2].map((level) => {
      const geometry = this._sharedGeometry(
        `thuja/spray-${level}`,
        { level },
        createThujaSprayGeometry,
      );
      return assertThujaWindPlanarGeometry(geometry);
    });
    this._addInstancedOrgan('shell', {
      name: 'Thuja_Smaragd_Recessed_Foliage',
      geometries: shellGeometries,
      material: this._materials.shell,
      group: this._leafGroup,
      receivesShadow: true,
    });
    this._addInstancedOrgan('sprays', {
      name: 'Thuja_Smaragd_FlatSprays',
      geometries,
      material: this._materials.spray,
      group: this._leafGroup,
      receivesShadow: true,
    });
    for (const kind of INSTANCE_KINDS) {
      const mesh = this._instancePool.mesh(kind);
      mesh.customDepthMaterial = this._materials.sprayDepth;
      mesh.customDistanceMaterial = this._materials.sprayDistance;
    }
  }

  #setMaterialPhenology(phenology) {
    this._seasonTint
      .copy(SUMMER_TINT)
      // 'Smaragd' is selected for retaining green foliage in winter. Keep the
      // whole-crown shift restrained; spring colour belongs only on new tips.
      .lerp(WINTER_TINT, phenology.winterTone * 0.16);
    this._materials.spray.color
      .copy(this._leafBaseColor)
      .multiply(this._seasonTint);
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this._rebuildWoodyGeometry(snapshot);
    this.#setMaterialPhenology(snapshot.phenology);
    this._leafWind.setCrownHeight(Math.max(0.1, snapshot.dimensions.heightM));
    let visibleSprays = 0;
    let visibleAxes = 0;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();

    // Recess the occluder deeply enough that it never becomes the visible
    // outline; it exists only where several exterior spray layers miss.
    const shellRadius = snapshot.dimensions.radiusM * 0.44;
    matrix.makeScale(
      shellRadius,
      snapshot.dimensions.heightM * 0.985,
      shellRadius,
    );
    // The shell is a near-view feature organ. At field distances the thinned,
    // enlarged spray proxies already close the projected silhouette; keeping
    // the occluder there would spend a third draw on detail the viewer cannot
    // resolve and would break the library's EZ-Tree-derived 3 / 2 / 2 ladder.
    if (this._detail.organLevel === 0) {
      this._writeInstance(
        'shell',
        this._runtime.shell.identity,
        matrix,
        DEPTH_SHELL_TINT,
      );
    }

    for (const cane of snapshot.canes) {
      for (const axis of cane.axes) {
        visibleAxes += 1;
        for (const node of axis.nodes) {
          for (const spray of node.sprays ?? []) {
            if (!spray.visible) continue;
            const runtime = this._runtime.sprays.get(spray.id);
            if (!runtime) {
              throw new Error(
                `Missing render spray for model organ ${spray.id}.`,
              );
            }
            const detailScale = this._organDetailScale(spray.id);
            if (detailScale <= 0) continue;
            const growth = spray.scale ?? 1;
            // Mature instances represent dense clusters of scale sprays rather
            // than a literal single branchlet. The model grows this proxy just
            // enough to keep Smaragd's shell closed as the crown area expands,
            // without increasing the stable instance roster or draw count.
            const coverageScale =
              spray.coverageScale ?? snapshot.coverageScale ?? 1;
            const crownProxyScale = THREE.MathUtils.lerp(
              1,
              0.6,
              Math.pow(
                THREE.MathUtils.clamp(spray.crownFraction ?? 0, 0, 1),
                1.6,
              ),
            );
            const position = vector(spray.position);
            // Living Smaragd pads shingle over one another. Pull proxy roots a
            // little into the crown and enlarge the photographed surface,
            // preserving the measured outer envelope while closing pinholes.
            position.x *= RADIAL_COMPACTION;
            position.z *= RADIAL_COMPACTION;
            const crownFraction = THREE.MathUtils.clamp(
              position.y / Math.max(0.1, snapshot.dimensions.heightM),
              0,
              1,
            );
            const width =
              runtime.widthM *
              growth *
              detailScale *
              coverageScale *
              crownProxyScale *
              SPRAY_OVERLAP_SCALE;
            // Real Smaragd pads overlap strongly along the vertical shell. A
            // small axial bias closes annual leader seams without widening the
            // cultivar beyond its declared garden-grown spread.
            const length =
              runtime.lengthM *
              growth *
              detailScale *
              coverageScale *
              crownProxyScale *
              SPRAY_OVERLAP_SCALE *
              1.2;
            const shellFraction = THREE.MathUtils.clamp(
              Math.hypot(position.x, position.z) /
                Math.max(0.05, snapshot.dimensions.radiusM),
              0,
              1,
            );
            const wind = createThujaWindMetadata({
              seed: this.seed,
              familyId: runtime.familyId,
              crownFraction,
              shellFraction,
              exposure: spray.exposure,
              lodLevel: THREE.MathUtils.clamp(this._detail.organLevel, 0, 2),
            });
            scale.set(
              width,
              length,
              this._leafWind.enabled ? thujaWindDepthScale(width, wind) : width,
            );
            matrix.compose(position, runtime.quaternion, scale);
            const colour = runtime.colour
              .clone()
              .lerp(
                FRESH_TIP,
                (spray.freshGrowthProgress ?? 0) *
                  (runtime.terminal ? 0.48 : 0.12),
              );
            this._writeInstance('sprays', runtime.identity, matrix, colour);
            visibleSprays += 1;
          }
        }
      }
    }
    this._instancePool.commitFrame();
    this._renderStats = {
      visibleCanes: 1,
      visibleAxes,
      visibleLeaves: visibleSprays,
      visibleSprays,
      biologicalVisibleSprays: snapshot.stats.visibleSprays,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateSmaragdModel(this.#model, {
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
      type: 'Thuja',
      plantId: this._plantId,
      species: SMARAGD_PROFILE.species,
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      seasonProfile: this.seasonProfile,
      offsetDays: this.offsetDays,
      events: [],
    };
  }
}

export default Thuja;
