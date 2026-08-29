import * as THREE from 'three';
import { LYNWOOD_PROFILE, LYNWOOD_RENDER_PRIORS } from './lynwood.js';
import {
  createLynwoodModel,
  createPruneEvent,
  evaluateLynwoodModel,
  lynwoodEventTime,
} from './model.js';
import {
  createBudCardGeometry,
  createCapsuleGeometry,
  createCorollaCardGeometry,
} from './geometry.js';
import { createLeafCardGeometry } from '../../leaf-geometry.js';
import {
  createLeafMaterialSet,
  keepAuthoredNormalsOnBackFaces,
} from '../../leaf-material.js';
import { keyedRange } from '../../keyed-random.js';
import { makeBasisQuaternion, vector } from '../../plant-transforms.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { loadLeafPlate } from '../../leaf-plate.js';

const UP = new THREE.Vector3(0, 1, 0);
// Forsythia foliage runs a fairly deep, slightly blue green in summer, flushes
// bronze-tinted when young, and turns gold to purple-bronze in autumn.
const SPRING_LEAF_TINT = new THREE.Color(0xdcecc0);
const SUMMER_LEAF_TINT = new THREE.Color(0xc2d3ac);
const AUTUMN_LEAF_TINT = new THREE.Color(0xd8a05a);

/**
 * The petiole, as a fraction of the leaf card it is drawn inside.
 *
 * Measured across all 4,384 leaves of the five-year plant: the modelled stalk
 * runs 0.054 to 0.382 of blade length, median 0.141, which is this fraction of
 * the stalk-plus-blade card. The plate paints its bottom PETIOLE_CARD_FRACTION
 * as the stalk (`scripts/make-leaf-texture.mjs`), so the card is rooted at the
 * node and scaled by petiole plus blade, and 3,720 meshed petioles -- 74,400
 * triangles and a whole draw call -- are simply gone. Hydrangea pays two
 * triangles a leaf for the same thing; on a plant with twice as many leaves and
 * a stalk half as long, the plate is the better half of that trade.
 */
const PETIOLE_CARD_FRACTION = 0.124;

/**
 * Instance tints for the one bud mesh both kinds of bud now share.
 *
 * The geometry carries a dull-gold base to bright-gold tip gradient, which is
 * the swelling flower bud as it was. A vegetative bud is the same shape in
 * winter brown-olive, so it is that gradient multiplied down and desaturated.
 */
const FLOWER_BUD_TINT = new THREE.Color(0xffffff);
const DORMANT_BUD_TINT = new THREE.Color(0x9ea9c4);
/** A leaf bud is 3-5 mm long; a swelling flower bud, 10-14. */
const DORMANT_BUD_SCALE = new THREE.Vector3(0.0026, 0.005, 0.0026);
const FLOWER_BUD_WIDTH_FACTOR = 0.13;
const FLOWER_BUD_ASPECT = 2.5;

/** The per-flower spread the one corolla plate is tinted across. */
const PALE_COROLLA = new THREE.Color(0xfffdf2);
const DEEP_COROLLA = new THREE.Color(0xefdc9e);

/**
 * Four kinds, where there were seven.
 *
 * `petioles` went into the leaf plate and `pedicels` were dropped -- a 3-9 mm
 * flower stalk that sits behind the corolla it carries, meshed as a tube 3,280
 * times. `flowerBuds` merged into `buds`, because a leaf bud and a flower bud
 * are one teardrop at two sizes in two colours. What is left is wood, foliage,
 * the display, and the capsule.
 *
 * See library rule 9 and `test/geometry-budget.test.js`.
 */
const INSTANCE_KINDS = Object.freeze(['leaves', 'buds', 'flowers', 'capsules']);

/**
 * The bands, and why this plant's wood needs a different lever from hydrangea's.
 *
 * A five-year 'Lynwood' is 464 separate axes: fourteen canes, 141 laterals and
 * 309 short shoots. That branch count, not ring count, is what its wood costs.
 * `landmarkStride` -- the lever that took hydrangea's band-2 wood from 7,041
 * triangles to 2,433 -- bottoms out here at 45,856, because thinning the rings
 * on a twig that only ever had three of them saves nothing. `sectionStride` is
 * the useful one at band 0, and even with both at their limits the floor is
 * 7,086 triangles: two rings and a cap for every one of those 464 tubes, which
 * is already over the 5,000 band 2 is allowed in total.
 *
 * So bands 1 and 2 set `woodOrderLimit`, and stop meshing the short shoots
 * while keeping everything growing on them. A short shoot is 15 cm long and
 * 2 mm thick; at seven metres it is a sub-pixel line inside a foliage mass its
 * own leaves already fill. The leaves left behind grow to match, exactly as a
 * thinned organ ladder grows its cards.
 */
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({
    distance: 0,
    // Node landmarks are kept at stride 4 rather than dropped wholesale: they
    // are sampled from the curve, so they carry the arch of a cane as well as
    // any section does, and they are what keeps a two-metre whip from meshing
    // as a polyline once `sectionStride` thins its own samples.
    detail: Object.freeze({
      sectionStride: 8,
      segmentFactor: 0.86,
      landmarkStride: 4,
    }),
  }),
  Object.freeze({
    distance: 7,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 8,
      segmentFactor: 0.72,
      landmarkStride: 8,
      woodOrderLimit: 1,
      leafStride: 2,
      leafScale: 1.2,
      // A 4 mm leaf bud and a 6 mm capsule, at seven metres and beyond: both
      // are under a pixel across there, and the buds are also what would make
      // a third mesh at peak bloom, where the corollas are the whole plant.
      dropKinds: Object.freeze(['capsules', 'buds']),
    }),
  }),
  Object.freeze({
    distance: 12,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 12,
      segmentFactor: 0.6,
      landmarkStride: 12,
      woodOrderLimit: 1,
      leafStride: 5,
      leafScale: 1.62,
      dropKinds: Object.freeze(['capsules', 'buds']),
    }),
  }),
]);

/**
 * A persistent, cultivar-specific Forsythia x intermedia 'Lynwood' renderer.
 *
 * The plant this draws is defined by two facts that the blackcurrant renderer
 * never has to handle: the flowers open on bare one- and two-year-old wood
 * before any leaf expands, and the leaves are opposite rather than alternate.
 * Everything else -- stable organ pools, the combined EZ-Tree woody mesh,
 * distance LOD and the validated state cycle -- comes from PlantRenderer.
 */
/** This plant's own plates, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));
const FLOWER_PLATE = loadLeafPlate(new URL('./flower.webp', import.meta.url));

export class Forsythia extends PlantRenderer {
  #model;

  #scratch = {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
  };

  constructor(options = {}) {
    if (options.schemaVersion != null && options.schemaVersion !== 2) {
      throw new RangeError(
        'Forsythia schema 1 used replacement-cycle event IDs; rebuild or migrate it to schema 2.',
      );
    }
    const requestedCultivar = options.cultivar ?? LYNWOOD_PROFILE.cultivar;
    if (
      requestedCultivar !== LYNWOOD_PROFILE.cultivar &&
      !LYNWOOD_PROFILE.synonyms.includes(requestedCultivar)
    ) {
      throw new RangeError(
        `This renderer currently supports only the ${LYNWOOD_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: LYNWOOD_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Forsythia',
      detailStrideSalt: 'forsythia-plant-detail-leaf-stride',
      plantId: options.plantId ?? `forsythia:${options.seed ?? 20260813}`,
      seed: options.seed ?? 20260813,
      maxYears: options.maxYears ?? 50,
      ageYears: options.ageYears ?? 5,
      dayOfYear: options.dayOfYear ?? 96,
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      extraStateKeys: ['region', 'offsetDays'],
      // A caller may state its own bands; the cultivar's are the default,
      // not a ceiling. The distances that suit a garden close-up are not the
      // ones that suit a landscape, and only the application knows which it
      // is looking at.
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      // The blades are broad and the shoots are long and springy, so the wind
      // displacement is wider than the currant's.
      leafWind: {
        strength: new THREE.Vector3(0.115, 0, 0.115),
        frequency: 0.42,
        scale: 1.25,
        // The caller may override any of this, including switching the
        // wind off entirely -- it is the most expensive per-vertex work in
        // the scene.
        ...options.leafWind,
      },
      barkTint: 0x6a5f4c,
    });

    this.region = options.region ?? 'central';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createLynwoodModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });

    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();
    this._runtime.flowers = new Map();
    this._runtime.capsules = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.cane);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  /* ------------------------------------------------------------------ *
   * Materials and instanced organs
   * ------------------------------------------------------------------ */

  #createMaterials() {
    const cane = this._barkMaterial();
    const leafMaterials = createLeafMaterialSet({
      name: 'Forsythia_Leaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: this._assets.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'forsythia-leaves',
    });
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);
    this._protect(
      '_leafBaseColor',
      '_leafSeasonTint',
      '_forsythiaRuntimeSignature',
    );
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();

    this._materials = {
      cane,
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      // One material for both kinds of bud. The geometry's gold gradient is
      // multiplied by a per-instance tint, so a winter leaf bud and a swelling
      // flower bud come out of the same three vertices. The back face keeps
      // the authored normal: unlike a corolla, a bud card stands in for a
      // solid teardrop, and the far side of a solid body is not lit from
      // behind.
      bud: keepAuthoredNormalsOnBackFaces(
        this._material({
          color: 0xffffff,
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 0.9,
          metalness: 0,
        }),
      ),
      // A cut-out card, so the corolla's outline comes from the plate's alpha
      // rather than from its quad. Three's own shadow pass copies `map` and
      // `alphaTest` across, so a flower casts a flower-shaped shadow with no
      // custom depth material.
      //
      // Unlike the hydrangea floret shell, the back face is NOT held to its
      // authored normal. A floret card stands in for part of a solid cone, so
      // flipping its normal would light the inside of a mass. A forsythia
      // corolla is one flat flower a fraction of a millimetre thick, and the
      // back of it really is lit by whatever is behind it.
      flower: this._material({
        color: 0xffffff,
        map: FLOWER_PLATE,
        alphaTest: FLOWER_PLATE ? 0.4 : 0,
        vertexColors: true,
        // A corolla lobe is a fraction of a millimetre of translucent tissue,
        // and half the flowers on a shrub face away from the sun at any
        // moment. Lit by diffuse alone they come out olive, which is the one
        // thing this plant must not be: photographs of it in bloom are clear
        // yellow on the shaded side as well as the sunlit one, because the
        // light goes through the petal. Emitting the plate's own colour at a
        // fraction of its strength is that, cheaply -- it lifts a shaded
        // corolla without touching its hue and without a second light.
        emissiveMap: FLOWER_PLATE,
        emissive: FLOWER_PLATE ? 0x4a4a4a : 0x000000,
        // Petals are matt. A tighter highlight puts a white sheen across the
        // lobes and takes the yellow straight out of them.
        roughness: 0.86,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      capsule: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.88,
        metalness: 0,
      }),
    };
  }

  #createInstances() {
    this._addInstancedOrgan('leaves', {
      name: 'Forsythia_Leaves_Opposite',
      // No stalk rung: this plant's petiole is painted into its plate, so the
      // same two triangles carry both at every band.
      geometry: this._sharedGeometry(
        'shared/leaf-card',
        { roundedNormals: this._assets.leaf.roundedNormals },
        createLeafCardGeometry,
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('buds', {
      name: 'Forsythia_Buds',
      geometry: this._sharedGeometry(
        'forsythia/bud-card',
        {},
        createBudCardGeometry,
      ),
      material: this._materials.bud,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('flowers', {
      name: 'Forsythia_Flowers_FourLobed',
      geometry: this._sharedGeometry(
        'forsythia/corolla-card',
        {},
        createCorollaCardGeometry,
      ),
      material: this._materials.flower,
      group: this._flowerGroup,
      // A shell of cards standing in for a mass of flowers: they shadow each
      // other into hard mottling across what should read as one soft body.
      // They still cast, because a bloom shading the wood under it is real.
      receivesShadow: false,
    });
    this._addInstancedOrgan('capsules', {
      name: 'Forsythia_Capsules',
      geometry: this._sharedGeometry(
        'forsythia/capsule',
        {},
        createCapsuleGeometry,
      ),
      material: this._materials.capsule,
      group: this._fruitGroup,
    });

    const leafInstances = this._instancePool.mesh('leaves');
    leafInstances.customDepthMaterial = this._materials.leafDepth;
    leafInstances.customDistanceMaterial = this._materials.leafDistance;
  }

  /* ------------------------------------------------------------------ *
   * Stable graph
   * ------------------------------------------------------------------ */

  #buildStableGraph() {
    const capacities = LYNWOOD_RENDER_PRIORS.instanceCapacities;
    const historicalCounts = {
      ...this._emptyInstanceCounts(),
      ...capacities,
    };
    const unknownYearCounts = { ...historicalCounts };
    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts: new Map(),
      unknownYearCounts,
    });
  }

  /** Build render runtimes only for the canes present in this snapshot. */
  #syncRuntime(snapshot) {
    let signature = '';
    for (const cane of snapshot.canes) {
      for (const axis of cane.axes) signature += `${axis.id}|`;
    }
    if (signature === this._forsythiaRuntimeSignature) return;

    this._runtime.axes.clear();
    this._runtime.leaves.clear();
    this._runtime.flowers.clear();
    this._runtime.capsules.clear();

    for (const cane of snapshot.canes) {
      const nodeAttachments = new Map();
      cane.axes.forEach((axis, axisIndex) => {
        const sourceAxis = {
          ...axis,
          points: axis.sourcePoints,
          nodes: axis.sourceNodes,
        };
        this._buildAxisRuntime({
          cane,
          axis: sourceAxis,
          axisIndex,
          nodeAttachments,
        });

        for (const node of axis.sourceNodes) {
          const nodePosition = vector(node.position);
          const tangent = vector(node.tangent);
          if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
          tangent.normalize();
          for (const leaf of node.leaves) {
            const end = vector(leaf.position);
            const radial = end.clone().sub(nodePosition);
            if (radial.lengthSq() < 1e-6) {
              radial.set(Math.cos(leaf.azimuth), 0.1, Math.sin(leaf.azimuth));
            }
            radial.normalize();
            const bladeForward = radial
              .clone()
              .multiplyScalar(0.84)
              .addScaledVector(tangent, 0.16)
              .normalize();
            const budForward = radial
              .clone()
              .multiplyScalar(0.5)
              .addScaledVector(tangent, 0.85)
              .normalize();
            this._runtime.leaves.set(leaf.id, {
              id: leaf.id,
              identity: this._renderIdentity(leaf.id, 'leaf'),
              radial,
              leafQuaternion: makeBasisQuaternion(
                bladeForward,
                vector(leaf.normal, UP),
              ),
              budQuaternion: makeBasisQuaternion(budForward, UP),
              size:
                leaf.lengthM *
                keyedRange(this.seed, [leaf.id, 'size'], 0.93, 1.07),
              sourceSize: leaf.lengthM,
            });
          }

          for (const cluster of node.clusters) {
            for (const flower of cluster.flowers) {
              const direction = vector(flower.direction);
              if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
              direction.normalize();
              const budQuaternion = makeBasisQuaternion(direction, UP);
              const spin = new THREE.Quaternion().setFromAxisAngle(
                UP,
                flower.roll,
              );
              this._runtime.flowers.set(flower.id, {
                id: flower.id,
                identity: this._renderIdentity(flower.id, 'flower'),
                budQuaternion,
                flowerQuaternion: budQuaternion.clone().multiply(spin),
                budSizeFactor: keyedRange(
                  this.seed,
                  [flower.id, 'bud-size'],
                  0.85,
                  1.15,
                ),
                corollaSizeFactor: keyedRange(
                  this.seed,
                  [flower.id, 'corolla-size'],
                  0.88,
                  1.12,
                ),
                tubeRatio: THREE.MathUtils.clamp(
                  flower.tubeLengthM /
                    Math.max(1e-6, flower.corollaWidthM * 0.3),
                  0.86,
                  1.18,
                ),
                // One plate draws every corolla on the plant, so the
                // flower-to-flower variation the photographs show has to
                // arrive per instance. The range is narrow on purpose:
                // 'Lynwood' is a clone, and its display reads as one colour
                // with life in it rather than as a mixed planting.
                tint: PALE_COROLLA.clone().lerp(
                  DEEP_COROLLA,
                  keyedRange(this.seed, [flower.id, 'corolla-tint'], 0, 1),
                ),
              });
            }

            if (cluster.capsule) {
              const direction = vector(cluster.capsule.direction);
              if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
              direction.normalize();
              this._runtime.capsules.set(cluster.capsule.id, {
                id: cluster.capsule.id,
                identity: this._renderIdentity(cluster.capsule.id, 'capsule'),
                quaternion: makeBasisQuaternion(direction, UP),
              });
            }
          }
        }
      });
    }

    this._forsythiaRuntimeSignature = signature;
  }

  /* ------------------------------------------------------------------ *
   * Per-organ placement
   * ------------------------------------------------------------------ */

  #detailScale(runtime, stride, scale) {
    if (stride <= 1) return scale;
    if (runtime.detailStride !== stride || runtime.detailInputScale !== scale) {
      runtime.detailStride = stride;
      runtime.detailInputScale = scale;
      runtime.detailScale = this._organDetailScale(runtime.id, stride, scale);
    }
    return runtime.detailScale;
  }

  /**
   * Seat one leaf card, stalk and all.
   *
   * The card is rooted at the NODE rather than at the blade, because its plate
   * paints the petiole across its bottom PETIOLE_CARD_FRACTION -- so the card
   * spans stalk plus blade and the blade's own length is what is scaled up to
   * reach it. The leaf still unfolds, through `leafState.scale`, which already
   * ramps from a third of full size; what it no longer does is slide outward
   * from the node, which is right, since a leaf grows out of its own bud
   * rather than travelling away from it.
   */
  #setLeaf(leafRuntime, leafState, nodeState, detailScale = 1) {
    const { matrix, position, scale } = this.#scratch;
    const sourceScale = leafState.scale / leafRuntime.sourceSize;
    const cardScale =
      (leafRuntime.size * sourceScale * detailScale) /
      (1 - PETIOLE_CARD_FRACTION);
    position.copy(nodeState.position);
    scale.set(cardScale, cardScale, cardScale);
    matrix.compose(position, leafRuntime.leafQuaternion, scale);
    this._writeInstance('leaves', leafRuntime.identity, matrix);
  }

  #setBud(leafRuntime, nodeState, visible) {
    if (!visible) return;
    const { matrix, position } = this.#scratch;
    // Opposite phyllotaxis means two buds share this node. Seating both at the
    // node centre stacks them into one z-fighting blob and doubles overdraw,
    // so each is pushed out along its own leaf's radial to sit on its own side
    // of the stem, which is where the pair actually sits on bare winter wood.
    position
      .copy(nodeState.position)
      .addScaledVector(leafRuntime.radial, 0.0032);
    matrix.compose(position, leafRuntime.budQuaternion, DORMANT_BUD_SCALE);
    this._writeInstance('buds', leafRuntime.identity, matrix, DORMANT_BUD_TINT);
  }

  #setCluster(
    clusterState,
    nodeState,
    { flowerStride = 1, flowerScale = 1, drawFlowers = true } = {},
    counts,
  ) {
    const capsuleVisibility = THREE.MathUtils.clamp(
      clusterState.capsuleVisibility,
      0,
      1,
    );
    const { matrix, position, scale } = this.#scratch;

    for (const flower of clusterState.flowers) {
      const runtime = this._runtime.flowers.get(flower.id);
      if (!runtime) {
        throw new Error(`Missing render flower for model organ ${flower.id}.`);
      }
      const detailScale = this.#detailScale(runtime, flowerStride, flowerScale);
      if (detailScale <= 0) continue;
      const openVisibility = THREE.MathUtils.clamp(
        flower.openVisibility ?? clusterState.flowerOpenVisibility,
        0,
        1,
      );
      const budVisibility = THREE.MathUtils.clamp(
        flower.budVisibility ?? clusterState.flowerBudVisibility,
        0,
        1,
      );
      // The pedicel is not drawn: it is 3-9 mm long and stands directly behind
      // the corolla that hangs on it, so 3,280 meshed tubes bought nothing a
      // viewer could ever see past the flower in front of them.
      position.copy(flower.position);

      if (budVisibility > 0.015) {
        const budWidth =
          flower.corollaWidthM *
          FLOWER_BUD_WIDTH_FACTOR *
          budVisibility *
          detailScale *
          runtime.budSizeFactor;
        scale.set(budWidth, budWidth * FLOWER_BUD_ASPECT, budWidth);
        matrix.compose(position, runtime.budQuaternion, scale);
        this._writeInstance('buds', runtime.identity, matrix, FLOWER_BUD_TINT);
        counts.visibleFlowerBuds++;
      }

      if (openVisibility > 0.015 && drawFlowers) {
        // The corolla expands as it opens rather than fading in at full size.
        const openScale =
          flower.corollaWidthM *
          THREE.MathUtils.lerp(0.55, 1, openVisibility) *
          detailScale *
          runtime.corollaSizeFactor;
        scale.set(openScale, openScale * runtime.tubeRatio, openScale);
        matrix.compose(position, runtime.flowerQuaternion, scale);
        this._writeInstance('flowers', runtime.identity, matrix, runtime.tint);
        counts.visibleFlowers++;
      }
    }

    if (clusterState.capsule && capsuleVisibility > 0.02) {
      const capsule = clusterState.capsule;
      const runtime = this._runtime.capsules.get(capsule.id);
      if (!runtime) {
        throw new Error(
          `Missing render capsule for model organ ${capsule.id}.`,
        );
      }
      const capsuleScale = capsule.lengthM * capsuleVisibility;
      position.copy(capsule.position);
      scale.set(capsuleScale, capsuleScale, capsuleScale);
      matrix.compose(position, runtime.quaternion, scale);
      this._writeInstance('capsules', runtime.identity, matrix);
      counts.visibleCapsules++;
    }
  }

  #setLeafMaterialPhenology(phenology) {
    const leafProgress = THREE.MathUtils.clamp(phenology.leafProgress, 0, 1);
    const autumnProgress = THREE.MathUtils.clamp(
      phenology.autumnProgress,
      0,
      1,
    );
    const springMix = THREE.MathUtils.smoothstep(leafProgress, 0.15, 0.85);
    this._leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, springMix)
      .lerp(AUTUMN_LEAF_TINT, autumnProgress);
    this._materials.leaf.color
      .copy(this._leafBaseColor)
      .multiply(this._leafSeasonTint);
  }

  /* ------------------------------------------------------------------ *
   * Snapshot application
   * ------------------------------------------------------------------ */

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this.#syncRuntime(snapshot);
    this._rebuildWoodyGeometry(snapshot);

    const phenology = snapshot.phenology;
    this.#setLeafMaterialPhenology(phenology);

    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;
    const organCounts = {
      visibleFlowers: 0,
      visibleFlowerBuds: 0,
      visibleCapsules: 0,
    };

    let totalLeafSites = 0;
    let totalVisibleLeafSites = 0;
    let totalVisibleFlowerSites = 0;
    for (const cane of snapshot.canes) {
      for (const axis of cane.axes) {
        for (const node of axis.nodes) {
          totalLeafSites += node.leaves.length;
          for (const leaf of node.leaves) {
            if (leaf.visible) totalVisibleLeafSites++;
          }
          for (const cluster of node.clusters) {
            if (!cluster.visible) continue;
            for (const flower of cluster.flowers) {
              if (
                flower.openVisibility > 0.015 ||
                flower.budVisibility > 0.015
              ) {
                totalVisibleFlowerSites++;
              }
            }
          }
        }
      }
    }

    const capacityStride = (count, capacity, requested) =>
      count <= capacity
        ? requested
        : Math.max(requested, Math.ceil(count / Math.max(1, capacity * 0.82)));
    const leafStride = capacityStride(
      totalLeafSites,
      LYNWOOD_RENDER_PRIORS.instanceCapacities.leaves,
      this._detail.leafStride,
    );
    // Corollas thin one step faster than leaves past band 0. At bloom they are
    // the only thing on the plant, and there are three of them for every leaf,
    // so a band that halves its foliage still has more flower cards than the
    // summer canopy it is sized against. They grow as they thin, the way a
    // panicle's cards do, so the display keeps its coverage instead of
    // dissolving into a scatter of dots.
    const flowerStride = capacityStride(
      totalVisibleFlowerSites,
      LYNWOOD_RENDER_PRIORS.instanceCapacities.flowers,
      this._detail.leafStride > 1 ? this._detail.leafStride + 1 : 1,
    );
    // Rule 9 says that past band 0 a plant is wood and foliage. This one has
    // two foliages -- bare-wood yellow in April and leaves after it -- and for
    // the eight days at the end of flowering when both are out, that is three
    // meshes where a coarse band is allowed two. A band that thins its foliage
    // therefore draws whichever display is in front, and drops the other. At
    // seven metres and beyond that is the right call anyway: on day 108 the
    // loser is 280 fading corollas behind 1,886 opening leaves. Band 0, where
    // the overlap is exactly what a photograph of this plant in April shows,
    // draws both.
    const bothDisplays = this._detail.leafStride <= 1;
    const flowersLead = totalVisibleFlowerSites >= totalVisibleLeafSites;
    const drawFlowers = bothDisplays || flowersLead;
    const drawLeaves = bothDisplays || !flowersLead;
    const leafScale =
      this._detail.leafScale *
      (leafStride > this._detail.leafStride ? 1.08 : 1);
    // Card counts fall with the square of apparent size, so the survivors grow
    // by the root of the stride -- the reasoning behind a panicle's card
    // ladder, applied to a stride instead of to hand-picked rungs. Undersized
    // cards at a coarse band do not read as a thinner display, they read as a
    // bare shrub with specks on it, which for this plant is the whole thing
    // missing.
    const flowerScale = Math.min(2.5, Math.sqrt(flowerStride));

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      visibleCanes++;
      for (const axis of cane.axes) {
        const axisRuntime = this._runtime.axes.get(axis.id);
        if (!axisRuntime) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes++;

        for (const node of axis.nodes) {
          // A leaf bud sits in the axil the corollas hang out of. Once they
          // are open it is behind three to twelve of them and cannot be seen,
          // so it is not drawn -- which at peak bloom is most of the buds on
          // the plant, and buys the flowers that are actually in front.
          let nodeIsFlowering = false;
          for (const cluster of node.clusters) {
            if (!cluster.visible) continue;
            for (const flower of cluster.flowers) {
              const open =
                flower.openVisibility ?? cluster.flowerOpenVisibility ?? 0;
              if (open > 0.015) {
                nodeIsFlowering = true;
                break;
              }
            }
            if (nodeIsFlowering) break;
          }

          for (const state of node.leaves) {
            const leafRuntime = this._runtime.leaves.get(state.id);
            if (!leafRuntime) {
              throw new Error(
                `Missing render leaf for model organ ${state.id}.`,
              );
            }
            const biologicallyVisible = state.visible;
            const detailScale = this.#detailScale(
              leafRuntime,
              leafStride,
              leafScale,
            );
            const visible =
              biologicallyVisible && detailScale > 0 && drawLeaves;
            if (visible) {
              this.#setLeaf(leafRuntime, state, node, detailScale);
              visibleLeaves++;
            }
            // Bare-wood buds stand in for the leaf all winter and through the
            // entire flowering display, which is most of what makes a
            // forsythia in bloom read as leafless. They stop at bud break
            // rather than fading out across the first fifth of leaf
            // expansion: once the canopy is moving, a scar that has not yet
            // drawn its leaf is showing a green tip, not a winter bud -- and
            // drawing both put a leaf and its own unopened bud on the same
            // scar, which is a third soft mesh in the one week of the year
            // when the corollas are still out.
            this.#setBud(
              leafRuntime,
              node,
              detailScale > 0 &&
                !biologicallyVisible &&
                !nodeIsFlowering &&
                phenology.leafProgress < 0.02,
            );
          }

          for (const state of node.clusters) {
            if (!state.visible) continue;
            this.#setCluster(
              state,
              node,
              { flowerStride, flowerScale, drawFlowers },
              organCounts,
            );
          }
        }
      }
    }

    this._instancePool.commitFrame();

    this._renderStats = {
      visibleCanes,
      visibleAxes,
      visibleLeaves,
      ...organCounts,
      biologicalVisibleLeaves: snapshot.stats.visibleLeaves,
      biologicalVisibleFlowers: snapshot.stats.visibleFlowers,
      biologicalVisibleFlowerBuds: snapshot.stats.visibleFlowerBuds,
      biologicalVisibleCapsules: snapshot.stats.visibleCapsules,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateLynwoodModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this._events,
      region: this.region,
      offsetDays: this.offsetDays,
    });
  }

  _decorateEvent(event) {
    if (event.type === 'prune') {
      return { ...event, ...createPruneEvent(event) };
    }
    return event;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  setPhenologyProfile({
    region = this.region,
    offsetDays = this.offsetDays,
  } = {}) {
    return this.setState({ region, offsetDays });
  }

  /**
   * Remove the oldest eligible whole cane at the crown.
   *
   * Unlike the blackcurrant, the correct window is immediately AFTER
   * flowering, not during dormancy: the wood carrying next spring's buds is
   * made during this summer. Pruning outside the window is reported back
   * rather than silently applied.
   */
  pruneOldestCane(options = {}) {
    const management = LYNWOOD_PROFILE.management;
    const targetAge = PlantRenderer.number(options.ageYears, this.ageYears);
    const targetDay = THREE.MathUtils.clamp(
      Math.floor(PlantRenderer.number(options.dayOfYear, this.dayOfYear)),
      1,
      365,
    );
    const reject = (reason) => ({ event: null, applied: false, reason });

    if (targetAge < management.renewalPruningMinimumAgeYears) {
      return reject('too-young');
    }

    const targetSnapshot = evaluateLynwoodModel(this.#model, {
      ageYears: targetAge,
      dayOfYear: targetDay,
      events: this._events,
      region: this.region,
      offsetDays: this.offsetDays,
    });
    const calendar = targetSnapshot.phenology.calendar;
    if (targetDay <= calendar.floweringEnd) {
      return reject('before-flowering-ends');
    }
    if (targetDay > management.latestSafePruningDay) {
      return reject('after-bud-set');
    }

    const candidates = targetSnapshot.canes
      .filter((cane) => !cane.removed)
      .sort(
        (a, b) => a.birthAgeYears - b.birthAgeYears || a.id.localeCompare(b.id),
      );
    if (candidates.length === 0) return reject('no-canes');

    // RHS group 2 takes up to one fifth of the oldest stems at the base, per
    // season. Scheduled renewal already runs immediately after flowering, so
    // those automatic cuts consume the same quota as explicit events instead
    // of silently doubling it.
    const prunedThisSeason = this._events.filter(
      (event) =>
        event.type === 'prune' &&
        Math.floor(event.ageYears) === Math.floor(targetAge),
    );
    const beforeRenewal = evaluateLynwoodModel(this.#model, {
      ageYears: targetAge,
      dayOfYear: calendar.floweringEnd,
      events: this._events,
      region: this.region,
      offsetDays: this.offsetDays,
    });
    const afterAutomaticRenewal = evaluateLynwoodModel(this.#model, {
      ageYears: targetAge,
      dayOfYear:
        calendar.floweringEnd +
        LYNWOOD_PROFILE.management.automaticRenewalDelayDays,
      events: this._events,
      region: this.region,
      offsetDays: this.offsetDays,
    });
    const retained = new Set(
      afterAutomaticRenewal.canes.map((cane) => cane.id),
    );
    const explicitTargets = new Set(
      prunedThisSeason.map((event) => event.caneId),
    );
    const automaticCuts = beforeRenewal.canes.filter(
      (cane) => !retained.has(cane.id) && !explicitTargets.has(cane.id),
    ).length;
    const standSize = beforeRenewal.stats.visibleCanes;
    const quota = Math.max(
      1,
      Math.floor(standSize * management.oldestCaneRemovalFraction),
    );
    if (automaticCuts + prunedThisSeason.length >= quota) {
      return reject('quota-reached');
    }

    const target = candidates[0];
    if (!target) return reject('quota-reached');

    const event = this.addEvent(
      createPruneEvent({
        caneId: target.id,
        ageYears: Math.floor(targetAge),
        dayOfYear: targetDay,
      }),
    );
    return { event, applied: true, caneId: target.id, type: 'prune' };
  }

  stats() {
    const source = this._snapshot.stats;
    return {
      ...source,
      ...this._renderStats,
      species: this._snapshot.species,
      cultivar: this.cultivar,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      renewalManagedAutomatically: true,
      region: this.region,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 2,
      type: 'Forsythia',
      plantId: this._plantId,
      species: LYNWOOD_PROFILE.species,
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      region: this.region,
      offsetDays: this.offsetDays,
      events: this._events.map((event) => ({ ...event })),
    };
  }
}

export { lynwoodEventTime };
export default Forsythia;
