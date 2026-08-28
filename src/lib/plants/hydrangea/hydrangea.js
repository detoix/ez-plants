import * as THREE from 'three';

import { createLeafCardGeometry } from '../../leaf-geometry.js';
import { createLeafMaterialSet } from '../../leaf-material.js';
import { keyedRange } from '../../keyed-random.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { loadLeafPlate } from '../../leaf-plate.js';
import {
  composeSegmentMatrix,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import {
  createFertilePanicleGeometry,
  createPanicleStemGeometry,
  createSterilePanicleGeometry,
  createVegetativeBudGeometry,
} from './geometry.js';
import { LIMELIGHT_PROFILE } from './limelight.js';
import { createLimelightModel, evaluateLimelightModel } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);

const SPRING_LEAF_TINT = new THREE.Color(0xcbdc8c);
const SUMMER_LEAF_TINT = new THREE.Color(0xffffff);
const AUTUMN_LEAF_TINT = new THREE.Color(0xc27c4f);
const PETIOLE_GREEN = new THREE.Color(0x668342);
const PETIOLE_RED = new THREE.Color(0x83514c);
const BUD_BROWN = new THREE.Color(0x72543e);
const CURRENT_SHOOT_GREEN = new THREE.Color(0x657a43);
const CURRENT_SHOOT_RED = new THREE.Color(0x79544b);
const PANICLE_STEM_GREEN = new THREE.Color(0x8b9b5f);
const PANICLE_STEM_TAN = new THREE.Color(0x917657);

// Photo-calibrated colours for the original cultivar, whose late display is
// dusty rose rather than the saturated red of the newer 'Limelight Prime'.
const COLOURS = Object.freeze({
  bud: new THREE.Color(0xb8cb75),
  lime: new THREE.Color(0xcad78a),
  creamGreen: new THREE.Color(0xdfe2b4),
  cream: new THREE.Color(0xeee9d2),
  blush: new THREE.Color(0xd9aaa6),
  dustyRose: new THREE.Color(0xb97d7e),
  tan: new THREE.Color(0xb49b72),
  deepTan: new THREE.Color(0x80664e),
});

const INSTANCE_KINDS = Object.freeze([
  'leaves',
  'petioles',
  'buds',
  'currentShoots',
  'peduncles',
  'panicleStems',
  'fertilePanicles',
  'sterileLower',
  'sterileUpper',
]);

const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({ distance: 0, detail: Object.freeze({}) }),
  Object.freeze({
    distance: 7,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      segmentFactor: 0.75,
      leafStride: 2,
      leafScale: 1.16,
    }),
  }),
  Object.freeze({
    distance: 12,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 3,
      segmentFactor: 0.55,
      leafStride: 3,
      leafScale: 1.3,
    }),
  }),
]);

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

/**
 * Persistent renderer for Hydrangea paniculata 'Limelight'.
 *
 * The immutable graph is a low multi-stem framework grown through EZ-Tree's
 * force model. Species-specific evaluation then supplies opposite leaves, one
 * current-season shoot and separate previous/current terminal panicle slots
 * at every flowering tip. Each head is instanced as a branched rachis, a
 * sparse fertile interior and two four-sepal sterile-floret layers, preserving
 * the biology without one draw call per flower.
 */
/** This plant's own leaf plate, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));

export class Hydrangea extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const cultivar = options.cultivar ?? LIMELIGHT_PROFILE.cultivar;
    if (cultivar !== LIMELIGHT_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${LIMELIGHT_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: LIMELIGHT_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Hydrangea',
      detailStrideSalt: 'hydrangea-limelight-detail',
      plantId: options.plantId ?? `hydrangea:${options.seed ?? 1986}`,
      seed: options.seed ?? 1986,
      maxYears: options.maxYears ?? 30,
      ageYears: options.ageYears ?? 6,
      dayOfYear: options.dayOfYear ?? 230,
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      // A caller may state its own bands; the cultivar's are the default,
      // not a ceiling. The distances that suit a garden close-up are not the
      // ones that suit a landscape, and only the application knows which it
      // is looking at.
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind: {
        // Thick blades move less than forsythia's lighter foliage, while the
        // broad cards still need visible gust variation at canopy scale.
        strength: new THREE.Vector3(0.075, 0, 0.075),
        frequency: 0.36,
        scale: 1.18,
        // The caller may override any of this, including switching the
        // wind off entirely -- it is the most expensive per-vertex work in
        // the scene.
        ...options.leafWind,
      },
      barkTint: 0x715d4f,
    });

    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createLimelightModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();
    this._runtime.currentShoots = new Map();
    this._runtime.panicles = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.cane);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  #createMaterials() {
    const leafMaterials = createLeafMaterialSet({
      name: 'Hydrangea_Limelight_Leaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: this._assets.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'hydrangea-limelight-leaves',
    });
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);
    this._protect('_leafBaseColor', '_leafSeasonTint');
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();

    this._materials = {
      cane: this._barkMaterial(),
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      petiole: this._material({ color: 0xffffff, roughness: 0.88 }),
      bud: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.94,
      }),
      peduncle: this._material({ color: 0xffffff, roughness: 0.82 }),
      panicleStem: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.86,
      }),
      fertile: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.78,
      }),
      sterile: this._material({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.72,
      }),
    };
  }

  #createInstances() {
    const stemGeometry = this._stemGeometry(5);

    this._addInstancedOrgan('leaves', {
      name: 'Hydrangea_Leaves_Opposite_Ovate',
      geometry: this._sharedGeometry(
        'shared/leaf-card',
        { roundedNormals: this._assets.leaf.roundedNormals },
        createLeafCardGeometry,
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('petioles', {
      name: 'Hydrangea_Petioles',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('buds', {
      name: 'Hydrangea_VegetativeBuds',
      geometry: this._sharedGeometry(
        'hydrangea/vegetative-bud',
        {},
        createVegetativeBudGeometry,
      ),
      material: this._materials.bud,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('currentShoots', {
      name: 'Hydrangea_CurrentSeasonShoots',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('peduncles', {
      name: 'Hydrangea_PaniclePeduncles',
      geometry: stemGeometry,
      material: this._materials.peduncle,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('panicleStems', {
      name: 'Hydrangea_PanicleRachises',
      geometry: this._sharedGeometry(
        'hydrangea/panicle-stem',
        {},
        createPanicleStemGeometry,
      ),
      material: this._materials.panicleStem,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('fertilePanicles', {
      name: 'Hydrangea_Panicles_FertileInterior',
      geometry: this._sharedGeometry(
        'hydrangea/fertile-panicle',
        {},
        createFertilePanicleGeometry,
      ),
      material: this._materials.fertile,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('sterileLower', {
      name: 'Hydrangea_Panicles_SterileLower',
      geometry: this._sharedGeometry(
        'hydrangea/sterile-panicle',
        { region: 'lower' },
        createSterilePanicleGeometry,
      ),
      material: this._materials.sterile,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('sterileUpper', {
      name: 'Hydrangea_Panicles_SterileUpper',
      geometry: this._sharedGeometry(
        'hydrangea/sterile-panicle',
        { region: 'upper' },
        createSterilePanicleGeometry,
      ),
      material: this._materials.sterile,
      group: this._flowerGroup,
    });

    const leaves = this._instancePool.mesh('leaves');
    leaves.customDepthMaterial = this._materials.leafDepth;
    leaves.customDistanceMaterial = this._materials.leafDistance;
  }

  #buildStableGraph() {
    const historicalCounts = this._emptyInstanceCounts();
    const unknownYearCounts = this._emptyInstanceCounts();
    const annualOrganCounts = new Map();

    const count = (additions) => {
      for (const [kind, amount] of Object.entries(additions)) {
        historicalCounts[kind] += amount;
        // Recurring annual leaf and head slots can all be visible together;
        // keeping them in the unknown bucket makes that concurrent bound
        // explicit instead of pretending they belong to one creation year.
        unknownYearCounts[kind] += amount;
      }
    };

    for (const cane of this.#model.canes) {
      const nodeAttachments = new Map();
      cane.axes.forEach((axis, axisIndex) => {
        this._buildAxisRuntime({ cane, axis, axisIndex, nodeAttachments });

        for (const node of axis.nodes) {
          const start = vector(node.position);
          for (const leaf of node.leaves) {
            const end = vector(leaf.position);
            const radial = end.clone().sub(start);
            if (radial.lengthSq() < 1e-6) {
              radial.set(Math.cos(leaf.azimuth), 0.08, Math.sin(leaf.azimuth));
            }
            radial.normalize();
            this._runtime.leaves.set(leaf.id, {
              id: leaf.id,
              radial,
              sourceLength: leaf.lengthM,
            });
            count({ leaves: 1, petioles: 1, buds: 1 });
          }
        }

        if (axis.terminalPanicle) {
          const panicle = axis.terminalPanicle;
          const currentShoot = panicle.currentShoot;
          this._runtime.currentShoots.set(currentShoot.id, {
            id: currentShoot.id,
            identity: this._renderIdentity(currentShoot.id, 'current-shoot'),
          });
          count({ currentShoots: 1 });

          for (const cohort of ['previous', 'current']) {
            const id = `${panicle.id}:${cohort}`;
            this._runtime.panicles.set(id, {
              id,
              identity: this._renderIdentity(id, 'panicle'),
            });
          }
          count({
            peduncles: 2,
            panicleStems: 2,
            fertilePanicles: 2,
            sterileLower: 2,
            sterileUpper: 2,
          });
        }
      });
    }

    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts,
      unknownYearCounts,
    });
  }

  #setLeaf(runtime, state, nodeState, detailScale) {
    const identity = (runtime.identity ??= this._renderIdentity(
      runtime.id,
      'leaf',
    ));
    const unfold = clamp01(state.unfoldProgress);
    const start = vector(nodeState.position);
    const maturePosition = vector(state.position);
    const position = start.clone().lerp(maturePosition, unfold);
    const radial = position.clone().sub(start);
    if (radial.lengthSq() < 1e-6) radial.copy(runtime.radial);
    radial.normalize();
    const tangent = vector(nodeState.tangent, UP).normalize();
    const forward = radial
      .clone()
      .multiplyScalar(0.82)
      .addScaledVector(tangent, 0.18)
      .normalize();
    const quaternion = makeBasisQuaternion(forward, vector(state.normal, UP));
    const sourceLength = state.lengthM ?? runtime.sourceLength;
    // Hydrangea's model carries a dimensionless unfolding/juvenile scale; the
    // patented blade length stays in lengthM. (Forsythia's older model stores
    // an absolute scaled length here, which is intentionally not copied.)
    const stateScale = Number.isFinite(state.scale) ? state.scale : 1;
    // The baked plate carries the ovate blade silhouette inside a square UV
    // card. Scaling X and Y independently would apply the biological aspect a
    // second time and make the visible alpha footprint unnaturally narrow.
    const cardScale = sourceLength * stateScale * detailScale;
    this._writeInstance(
      'leaves',
      identity,
      new THREE.Matrix4().compose(
        position,
        quaternion,
        new THREE.Vector3(cardScale, cardScale, cardScale),
      ),
    );

    const petiole = new THREE.Object3D();
    composeSegmentMatrix(petiole, start, position, 0.00145);
    this._writeInstance(
      'petioles',
      identity,
      petiole.matrix,
      PETIOLE_GREEN.clone().lerp(
        PETIOLE_RED,
        keyedRange(this.seed, [runtime.id, 'petiole-red'], 0.12, 0.62),
      ),
    );
  }

  #setBud(runtime, nodeState, visible) {
    if (!visible) return;
    const identity = (runtime.identity ??= this._renderIdentity(
      runtime.id,
      'leaf',
    ));
    const tangent = vector(nodeState.tangent, UP).normalize();
    const position = vector(nodeState.position).addScaledVector(
      runtime.radial,
      0.0048,
    );
    const direction = tangent
      .clone()
      .multiplyScalar(0.9)
      .addScaledVector(runtime.radial, 0.42)
      .normalize();
    this._writeInstance(
      'buds',
      identity,
      new THREE.Matrix4().compose(
        position,
        makeBasisQuaternion(direction, UP),
        new THREE.Vector3(0.007, 0.014, 0.007),
      ),
      BUD_BROWN,
    );
  }

  #setCurrentShoot(state) {
    const runtime = this._runtime.currentShoots.get(state.id);
    if (!runtime) {
      throw new Error(
        `Missing render current shoot for model organ ${state.id}.`,
      );
    }
    const root = vector(state.root);
    const tip = vector(state.tip);
    if (root.distanceToSquared(tip) <= 1e-10) return;

    const shoot = new THREE.Object3D();
    composeSegmentMatrix(
      shoot,
      root,
      tip,
      0.0028 * THREE.MathUtils.lerp(0.45, 1, clamp01(state.scale)),
    );
    this._writeInstance(
      'currentShoots',
      runtime.identity,
      shoot.matrix,
      CURRENT_SHOOT_GREEN.clone().lerp(
        CURRENT_SHOOT_RED,
        keyedRange(this.seed, [state.id, 'shoot-red'], 0.12, 0.48),
      ),
    );
  }

  #panicleColours(phenology, panicleState) {
    const panicleId = panicleState.id;
    const variation = keyedRange(
      this.seed,
      [panicleId, 'colour-age-offset'],
      -0.08,
      0.08,
    );
    const limeMix = clamp01(phenology.limeToCreamProgress + variation);
    const pinkMix = clamp01(phenology.pinkProgress + variation);
    const burgundyMix = clamp01(phenology.burgundyProgress + variation);
    // Visibility during spring pruning is the fraction of last year's head
    // still retained, not its degree of dryness. Physical cohort slots keep a
    // retained head fully parchment-tan while the independent new head follows
    // the current season's lime-to-rose-to-tan sequence.
    const dryMix = panicleState.retainedFromPreviousYear
      ? 1
      : clamp01(Math.max(phenology.dryProgress, panicleState.dryVisibility));

    const lower = COLOURS.lime
      .clone()
      .lerp(COLOURS.cream, limeMix)
      .lerp(COLOURS.blush, pinkMix)
      .lerp(COLOURS.dustyRose, burgundyMix)
      .lerp(COLOURS.tan, dryMix);
    // Panicles open from the base to the apex. The upper layer remains about
    // a week behind, giving real mixed green/white/pink heads during change.
    const upper = COLOURS.lime
      .clone()
      .lerp(COLOURS.cream, clamp01((limeMix - 0.18) / 0.82))
      .lerp(COLOURS.blush, clamp01(pinkMix - 0.28))
      .lerp(COLOURS.dustyRose, clamp01(burgundyMix - 0.22))
      .lerp(COLOURS.deepTan, dryMix);
    const fertile = COLOURS.bud
      .clone()
      .lerp(COLOURS.creamGreen, limeMix * 0.45)
      .lerp(COLOURS.deepTan, dryMix);
    return { lower, upper, fertile, dryMix };
  }

  #setPanicle(state, phenology, detailScale) {
    const runtime = this._runtime.panicles.get(state.id);
    if (!runtime) {
      throw new Error(`Missing render panicle for model organ ${state.id}.`);
    }
    const position = vector(state.position);
    const direction = vector(state.direction, UP);
    if (direction.lengthSq() < 1e-6) direction.copy(UP);
    direction.normalize();
    const peduncleEnd = position
      .clone()
      .addScaledVector(direction, state.peduncleLengthM * state.scale);
    const peduncle = new THREE.Object3D();
    composeSegmentMatrix(
      peduncle,
      position,
      peduncleEnd,
      0.0022 * Math.max(0.4, state.scale),
    );
    const colours = this.#panicleColours(phenology, state);
    this._writeInstance(
      'peduncles',
      runtime.identity,
      peduncle.matrix,
      PANICLE_STEM_GREEN.clone().lerp(PANICLE_STEM_TAN, colours.dryMix),
    );

    const width = state.widthM * state.scale * detailScale;
    const length = state.lengthM * state.scale;
    const matrix = new THREE.Matrix4().compose(
      peduncleEnd,
      makeBasisQuaternion(direction, UP),
      new THREE.Vector3(width, length, width),
    );

    this._writeInstance(
      'panicleStems',
      runtime.identity,
      matrix,
      PANICLE_STEM_GREEN.clone().lerp(PANICLE_STEM_TAN, colours.dryMix),
    );
    if (state.fertileVisibility > 0.015) {
      this._writeInstance(
        'fertilePanicles',
        runtime.identity,
        matrix,
        colours.fertile,
      );
    }
    if (state.sterileVisibility > 0.015) {
      this._writeInstance(
        'sterileLower',
        runtime.identity,
        matrix,
        colours.lower,
      );
      this._writeInstance(
        'sterileUpper',
        runtime.identity,
        matrix,
        colours.upper,
      );
    }
  }

  #setLeafPhenology(phenology) {
    const springMix = THREE.MathUtils.smoothstep(
      clamp01(phenology.leafProgress),
      0.15,
      0.85,
    );
    this._leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, springMix)
      .lerp(AUTUMN_LEAF_TINT, clamp01(phenology.autumnProgress));
    this._materials.leaf.color
      .copy(this._leafBaseColor)
      .multiply(this._leafSeasonTint);
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this._rebuildWoodyGeometry(snapshot);
    this.#setLeafPhenology(snapshot.phenology);

    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;
    let visiblePanicles = 0;
    let visibleDryPanicles = 0;

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      visibleCanes++;
      for (const axis of cane.axes) {
        if (!this._runtime.axes.has(axis.id)) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes++;
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
              visibleLeaves++;
            }
            this.#setBud(
              runtime,
              node,
              axis.growthScale > 0.08 &&
                (!leaf.visible || snapshot.phenology.leafProgress < 0.12),
            );
          }
        }

        const terminalPanicle = axis.terminalPanicle;
        if (!terminalPanicle) continue;

        // Heads are the cultivar's silhouette, so LOD thins them one level
        // more gently than leaves. Previous/current physical heads share the
        // authored tip's selection, preserving their biological relationship
        // while retaining distinct stable identities and transforms.
        const stride = Math.max(1, Math.ceil(this._detail.leafStride / 2));
        const detailScale = this._organDetailScale(
          terminalPanicle.id,
          stride,
          THREE.MathUtils.lerp(1, 1.08, clamp01(this._detail.leafScale - 1)),
        );
        if (detailScale <= 0) continue;

        const currentShoot = terminalPanicle.currentShoot;
        if (currentShoot?.visible && currentShoot.lengthM > 1e-6) {
          this.#setCurrentShoot(currentShoot);
        }

        for (const panicle of [
          terminalPanicle.previousPanicle,
          terminalPanicle.currentPanicle,
        ]) {
          if (!panicle?.visible || panicle.headVisibility <= 0.015) continue;
          this.#setPanicle(panicle, snapshot.phenology, detailScale);
          visiblePanicles++;
          if (panicle.dryVisibility > 0.05) visibleDryPanicles++;
        }
      }
    }

    this._instancePool.commitFrame();
    this._renderStats = {
      visibleCanes,
      visibleAxes,
      visibleLeaves,
      visiblePanicles,
      visibleDryPanicles,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateLimelightModel(this.#model, {
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
      type: 'Hydrangea',
      plantId: this._plantId,
      species: LIMELIGHT_PROFILE.species,
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

export default Hydrangea;
