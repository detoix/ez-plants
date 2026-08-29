import * as THREE from 'three';

import { createLeafCardGeometry } from '../../leaf-geometry.js';
import {
  createLeafMaterialSet,
  keepAuthoredNormalsOnBackFaces,
} from '../../leaf-material.js';
import { keyedRange } from '../../keyed-random.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { loadLeafPlate } from '../../leaf-plate.js';
import {
  composeSegmentMatrix,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import {
  createPanicleGeometry,
  createVegetativeBudGeometry,
} from './geometry.js';
import { LIMELIGHT_PROFILE } from './limelight.js';
import { createLimelightModel, evaluateLimelightModel } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);

const SPRING_LEAF_TINT = new THREE.Color(0xcbdc8c);
const SUMMER_LEAF_TINT = new THREE.Color(0xffffff);
const AUTUMN_LEAF_TINT = new THREE.Color(0xc27c4f);
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

/**
 * Four kinds, where there were nine.
 *
 * A hydrangea's cost is its heads, and heads were split five ways -- peduncle,
 * rachis, fertile interior, lower sterile layer, upper sterile layer -- so one
 * flower cost five draws and 6,468 triangles. `panicles` is all of it: one
 * card shell per head, one instance, one draw. `stems` is every thin green
 * tube the plant still needs, and petioles are gone into the leaf card.
 *
 * See library rule 9 and `test/geometry-budget.test.js`.
 */
const INSTANCE_KINDS = Object.freeze(['leaves', 'buds', 'stems', 'panicles']);

/**
 * The head's detail ladder, indexed by `organLevel`.
 *
 * Card counts fall roughly with the square of apparent size, and card edges
 * grow to match, so a head keeps its coverage as it simplifies rather than
 * thinning into a see-through cone -- the failure a plain instance-count LOD
 * would have produced, and the reason heads could never be thinned before.
 */
const PANICLE_LADDER = Object.freeze([
  Object.freeze({ cards: 68, cardSize: 0.36, rachis: false }),
  Object.freeze({ cards: 30, cardSize: 0.5, rachis: false }),
  Object.freeze({ cards: 14, cardSize: 0.62, rachis: false }),
]);

/**
 * The petiole, as a fraction of the leaf card it now belongs to.
 *
 * Measured across all 1,757 leaves of the five-year plant: the meshed petiole
 * ran 0.138 to 0.235 of card scale, median 0.162. A constant is worth a few
 * millimetres of error on a 1.5 cm stalk to be rid of an organ that cost more
 * than the leaves it carried.
 */
const PETIOLE_CARD_FRACTION = 0.162;

const DEFAULT_LOD_LEVELS = Object.freeze([
  // `landmarkStride` is the band's biggest single lever on this plant. Wood
  // rings are pinned by leaf attachments, not by the curve, so a shrub with
  // 1,260 landmarks against 780 sections barely responds to `sectionStride`
  // alone: thinning them alongside the leaves takes band 2's wood from 7,041
  // triangles to 2,433 without moving a twig anyone can see.
  Object.freeze({
    distance: 0,
    detail: Object.freeze({ landmarkStride: 6, organLevel: 0 }),
  }),
  Object.freeze({
    distance: 7,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      segmentFactor: 0.75,
      landmarkStride: 6,
      leafStride: 2,
      leafScale: 1.16,
      organLevel: 1,
      // Stems are 1.5 mm across. Past seven metres they are thinner than the
      // pixel that would have drawn them.
      dropKinds: Object.freeze(['stems', 'buds']),
    }),
  }),
  Object.freeze({
    distance: 12,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.4,
      landmarkStride: 8,
      leafStride: 3,
      leafScale: 1.3,
      organLevel: 2,
      dropKinds: Object.freeze(['stems', 'buds']),
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
/** This plant's own plates, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));
const FLORET_PLATE = loadLeafPlate(new URL('./floret.webp', import.meta.url));

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
      stem: this._material({ color: 0xffffff, roughness: 0.88 }),
      bud: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.94,
      }),
      // Cut-out cards, so the head's outline comes from the plate's alpha
      // rather than from its quads. Three's own shadow pass copies `map` and
      // `alphaTest` across, so the head casts a flower-shaped shadow without a
      // custom depth material -- the panicle is stiff enough not to want the
      // leaf wind, which bends by uv.y and would set each card boiling in
      // place rather than nodding the head.
      floret: keepAuthoredNormalsOnBackFaces(
        this._material({
          color: 0xffffff,
          map: FLORET_PLATE,
          alphaTest: FLORET_PLATE ? 0.36 : 0,
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 0.72,
        }),
      ),
    };
  }

  #createInstances() {
    const stemGeometry = this._stemGeometry(3, { openEnded: true });

    // The stalk is worth two triangles a leaf at arm's length and nothing at
    // all past seven metres, where a 1.5 mm petiole is thinner than a pixel.
    // Two rungs of the same card, so it simply stops being meshed.
    const leafCard = (stalk) =>
      this._sharedGeometry(
        'shared/leaf-card',
        { roundedNormals: this._assets.leaf.roundedNormals, stalk },
        createLeafCardGeometry,
      );
    this._addInstancedOrgan('leaves', {
      name: 'Hydrangea_Leaves_Opposite_Ovate',
      geometries: [leafCard(PETIOLE_CARD_FRACTION), leafCard(0)],
      material: this._materials.leaf,
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
    // Current-season shoots and peduncles are the same organ to a renderer: a
    // short green tube between two points. They were two kinds because they
    // were two names.
    this._addInstancedOrgan('stems', {
      name: 'Hydrangea_GreenStems',
      geometry: stemGeometry,
      material: this._materials.stem,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('panicles', {
      name: 'Hydrangea_Panicles',
      geometries: PANICLE_LADDER.map((rung, level) =>
        this._sharedGeometry(
          `hydrangea/panicle-${level}`,
          rung,
          createPanicleGeometry,
        ),
      ),
      material: this._materials.floret,
      group: this._flowerGroup,
      // A head casts, but is not shadowed. Forty-four cards standing in for
      // two hundred florets shadow one another into hard grey blotches across
      // what a photograph shows as one soft cream mass; its own outward-facing
      // normals already shade it as the cone it is.
      receivesShadow: false,
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
            count({ leaves: 1, buds: 1 });
          }
        }

        if (axis.terminalPanicle) {
          const panicle = axis.terminalPanicle;
          const currentShoot = panicle.currentShoot;
          this._runtime.currentShoots.set(currentShoot.id, {
            id: currentShoot.id,
            identity: this._renderIdentity(currentShoot.id, 'current-shoot'),
          });
          count({ stems: 1 });

          for (const cohort of ['previous', 'current']) {
            const id = `${panicle.id}:${cohort}`;
            this._runtime.panicles.set(id, {
              id,
              identity: this._renderIdentity(id, 'panicle'),
            });
          }
          // One peduncle and one head per cohort slot.
          count({ stems: 2, panicles: 2 });
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
      'stems',
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

    // The head's own colour is its base, where the season has got furthest.
    // Panicles open from the base to the apex and the apex runs about a week
    // behind, which the card geometry carries as a baked multiplicative
    // gradient rather than as a second, separately-coloured mesh.
    const head = COLOURS.lime
      .clone()
      .lerp(COLOURS.cream, limeMix)
      .lerp(COLOURS.blush, pinkMix)
      .lerp(COLOURS.dustyRose, burgundyMix)
      .lerp(COLOURS.tan, dryMix);
    // Before the sepals expand, the head is a tight green cone -- the same
    // florets on the same cone, so the same cards, only smaller (by the
    // model's own panicle scale) and greener. `sterileVisibility` is what used
    // to decide whether to draw the showy layers at all; now it decides how
    // far the head has opened out of its bud colour.
    // A drying head is fully open, not returning to bud: as a retained head's
    // sterile visibility decays through the spring pruning window it must stay
    // parchment, not creep back towards green.
    const opened = clamp01(Math.max(panicleState.sterileVisibility, dryMix));
    return { head: COLOURS.bud.clone().lerp(head, opened), dryMix };
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
      'stems',
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

    this._writeInstance('panicles', runtime.identity, matrix, colours.head);
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
