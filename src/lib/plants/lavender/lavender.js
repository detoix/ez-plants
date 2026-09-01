import * as THREE from 'three';
import { HIDCOTE_PROFILE, HIDCOTE_RENDER_PRIORS } from './hidcote.js';
import {
  createHidcoteModel,
  createTrimEvent,
  evaluateHidcoteModel,
  hidcoteEventTime,
} from './model.js';
import { createSpikeCardGeometry, SPIKE_PLATE_FILL } from './geometry.js';
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

/**
 * How much of the leaf plate's width the blade actually occupies.
 *
 * A lavender leaf is more than ten times as long as it is wide, and the
 * plate keeps that proportion (`scripts/make-lavender-leaf-texture.mjs`), so a card
 * scaled uniformly by leaf length comes out the right width with no second
 * number to keep in step. The constant is needed for the *other* two things
 * this plate draws — the flower stems and the spikes at coarse bands — which
 * are given a real width rather than a length, and therefore have to divide
 * by the share of the tile the paint covers.
 */
const LEAF_PLATE_FILL = 0.096;

/**
 * Foliage colour through the year.
 *
 * The grey belongs to winter, not to summer. 'Hidcote' is described as a
 * silver-grey-leaved clone and it is, in the sense that its leaves carry a
 * coat of white hairs — but photographs of the plant in growth are green, and
 * pulling the whole year toward silver is what made earlier renders read as
 * wormwood. So spring and summer sit close to the plate's own green, and the
 * greying arrives with the cold, which is when the mound really does go dull
 * and blue. Nothing here goes yellow or brown: the leaves do not fall, and a
 * lavender that browns in November is a dead one.
 */
const SPRING_LEAF_TINT = new THREE.Color(0xeaf0d6);
const SUMMER_LEAF_TINT = new THREE.Color(0xe0e8c9);
const WINTER_LEAF_TINT = new THREE.Color(0xb4b9a8);

/**
 * The spike, through its own eight weeks.
 *
 * Read straight off the photographs, in the order the plant runs them: a
 * silvery grey-green cone of unopened calyces in mid-June, the deep
 * violet-blue the cultivar is grown for in July, and the dark, dry,
 * grey-purple head of early August that stands until the shears. The plate is
 * near-neutral, so all three arrive as an instance tint and one mesh draws
 * every stage.
 */
const SPIKE_GREEN = new THREE.Color(0xd9e0bd);
const SPIKE_VIOLET = new THREE.Color(0x7d61c2);
const SPIKE_DRY = new THREE.Color(0xab9781);
/** Spike-to-spike variation. 'Hidcote' is a clone: the range is narrow. */
const SPIKE_TINT_SPREAD = 0.12;

/** Instance colour for an organ that wants the material's own colour. */
const NEUTRAL = new THREE.Color(0xffffff);

/**
 * How far down to bring a spike stand-in's colour.
 *
 * The two plates do not sit at the same value. The spike plate is a dark
 * calyx column with bright corollas on it, deliberately, because that
 * contrast is the whole read of the organ; the leaf plate is one even
 * mid-grey-green. Tinting a leaf card with a spike's colour therefore
 * produces something visibly lighter and more saturated than the mesh it
 * stands in for, and a band change becomes a change of colour rather than a
 * change of detail. This is the difference between the two plates' mean
 * values, applied once.
 */
const STAND_IN_VALUE = 0.62;

/**
 * Two kinds, and the second one is the plant.
 *
 * There is no third. A lavender's other candidates for an organ mesh are the
 * flower stems, and they are wood: a peduncle is a stem, it is stiff, round
 * and 20 cm long, and it belongs in the same merged mesh as the frame it grows
 * out of rather than in a pool of its own. That decision is what leaves band 0
 * its third draw for the spikes, which is what the plant is grown for.
 *
 * See library rule 9 and `test/geometry-budget.test.js`.
 */
const INSTANCE_KINDS = Object.freeze(['leaves', 'spikes']);

/**
 * The bands, and why this plant does not lose its flowers at any of them.
 *
 * Rule 9 gives bands 1 and 2 two draws: wood and foliage. For most plants that
 * means the feature organ is dropped, and for most plants that is survivable.
 * It is not survivable here. A lavender out of flower is a grey hummock; the
 * violet is not an ornament on the plant, it *is* the plant, and a field of
 * lavender that turns grey at four metres has lost the thing it was planted
 * for. Miscanthus and hydrangea both hit this and paid a draw for it.
 *
 * This plant does not have to, because rule 9 already names the way out: past
 * band 0, a feature organ has to be carried by the leaf card. So it is. Once
 * the spike mesh is dropped, a spike is seated as one more card from the leaf
 * pool — the plate's blade is a narrow tapering body, which at four metres is
 * a perfectly good spike — with the violet arriving as its instance colour.
 * The flower stem comes with it, as a second card stretched thin, in the leaf
 * material's own grey-green, which is already the right colour for a peduncle.
 * Two triangles each, no new draw, and the plant keeps its identity all the
 * way out.
 *
 * That is also why `woodOrderLimit` can go to zero here. Bands 1 and 2 mesh
 * only the 22 framework branches: the green shoots are 8 cm of 1.5 mm stem
 * buried inside their own leaf tufts, and the flower stems have just become
 * cards. What is left is the frame, which is the only wood a lavender ever
 * really shows.
 *
 * The distances are generous for a half-metre plant — the other shrubs here
 * switch at about three times their own height, and these are nearer seven.
 * That is deliberate and it is the caller's to override: a lavender's ornament
 * is small and high-frequency, so it is worth carrying the real spike mesh
 * further out than a panicle or a plume would be.
 */
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({
    distance: 0,
    detail: Object.freeze({
      // The frame is a five-centimetre stub buried in its own foliage, so
      // nothing is left that needs its curve resolved; every ring past the
      // endpoints goes into leaves instead.
      sectionStride: 9,
      // Chosen for what it does to each order rather than as a round number:
      // it takes a green shoot and a flower stem down to a three-sided prism
      // while leaving the framework branch five. At two millimetres across,
      // three sides and four are the same handful of pixels; the frame is
      // four times as thick and is the one piece of wood a lavender shows.
      segmentFactor: 0.66,
      // Every interior landmark dropped, even at band 0, and it costs
      // nothing visible. A landmark exists to stop a woody tube pinching
      // through an organ drawn on it; a lavender's leaves are *sessile* on a
      // straight 2 mm shoot, so there is nothing to pinch through and every
      // ring they force is waste. Dropping them takes an axis from 19
      // triangles to 13, and on a plant carrying three hundred shoots that is
      // close to four thousand triangles moved out of invisible stem and into
      // the foliage the mound is actually made of.
      landmarkStride: 12,
    }),
  }),
  Object.freeze({
    distance: 3.5,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 10,
      segmentFactor: 0.62,
      landmarkStride: 8,
      woodOrderLimit: 0,
      leafStride: 2,
      leafScale: 1.26,
      dropKinds: Object.freeze(['spikes']),
    }),
  }),
  Object.freeze({
    distance: 7,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 14,
      segmentFactor: 0.5,
      landmarkStride: 14,
      woodOrderLimit: 0,
      leafStride: 5,
      leafScale: 1.7,
      dropKinds: Object.freeze(['spikes']),
    }),
  }),
]);

/** This plant's own plates, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));
const SPIKE_PLATE = loadLeafPlate(new URL('./spike.webp', import.meta.url));

/**
 * A persistent, cultivar-specific Lavandula angustifolia 'Hidcote' renderer.
 *
 * The plant this draws is a **subshrub**, and everything that separates it
 * from the three shrubs beside it in this library follows from that one word.
 * Its wood is a low permanent frame that never renews and cannot be cut into,
 * so there is no renewal pruning here and no bare-wood winter: the mound is
 * evergreen and simply thins and greys. Its ornament is not on the plant but
 * held on leafless stems above it, for eight weeks, and then sheared off in a
 * single day. Everything else — stable organ pools, the merged EZ-Tree woody
 * mesh, distance LOD and the validated state cycle — comes from PlantRenderer.
 */
export class Lavender extends PlantRenderer {
  #model;

  #scratch = {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    colour: new THREE.Color(),
    direction: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };

  constructor(options = {}) {
    const requestedCultivar = options.cultivar ?? HIDCOTE_PROFILE.cultivar;
    if (
      requestedCultivar !== HIDCOTE_PROFILE.cultivar &&
      !HIDCOTE_PROFILE.synonyms.includes(requestedCultivar)
    ) {
      throw new RangeError(
        `This renderer currently supports only the ${HIDCOTE_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: HIDCOTE_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Lavender',
      detailStrideSalt: 'lavender-plant-detail-leaf-stride',
      plantId: options.plantId ?? `lavender:${options.seed ?? 19070101}`,
      seed: options.seed ?? 19070101,
      // An old lavender is replaced, not renewed, so a fifty-year horizon
      // would be thirty years of pretending. Three replacement cycles is
      // already more than a garden gets out of one plant.
      maxYears:
        options.maxYears ?? HIDCOTE_PROFILE.architecture.modelHorizonYears,
      ageYears: options.ageYears ?? 4,
      dayOfYear: options.dayOfYear ?? 190,
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      extraStateKeys: ['region', 'offsetDays'],
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      // Stiff little leaves on stiff little shoots: the mound itself barely
      // moves. What moves is the flower stems, and they are wood, so the
      // spikes take their own wind below.
      leafWind: {
        strength: new THREE.Vector3(0.045, 0, 0.045),
        frequency: 0.62,
        scale: 1.9,
        ...options.leafWind,
      },
      /**
       * A pale olive-grey rather than a bark brown, and the reason is what
       * this mesh mostly holds.
       *
       * One material covers every stem on the plant, and on a subshrub the
       * overwhelming majority of visible stem is not old wood at all: it is
       * this season's grey-green shoots and, for two months of the year, a
       * hundred and fifty grey-green flower stems standing clear of the
       * foliage where nothing hides them. The genuinely woody frame is 20 cm
       * long, lies under the mound, and is screened by its own leaves.
       * Tinting for the frame would put brown stalks under every spike, which
       * is the single most visible thing that could be wrong with this plant;
       * tinting for the stems leaves the frame a little green in the few
       * places it shows. That trade is not close.
       */
      barkTint: options.barkTint ?? 0x707f4a,
    });

    this.region = options.region ?? 'central';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createHidcoteModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });

    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();
    this._runtime.spikes = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.stem);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  /* ------------------------------------------------------------------ *
   * Materials and instanced organs
   * ------------------------------------------------------------------ */

  #createMaterials() {
    const stem = this._barkMaterial();
    const leafMaterials = createLeafMaterialSet({
      name: 'Lavender_Leaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: this._assets.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'lavender-leaves',
    });
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);
    this._protect(
      '_leafBaseColor',
      '_leafSeasonTint',
      '_standInDivisor',
      '_lavenderRuntimeSignature',
    );
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();
    this._standInDivisor = new THREE.Color();

    this._materials = {
      stem,
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      // A cut-out card, so the spike's outline comes from the plate's alpha
      // rather than from its quad. Three's shadow pass copies `map` and
      // `alphaTest` across, so a spike casts a spike-shaped shadow with no
      // custom depth material of its own.
      //
      // The back face keeps its authored normal. A spike card stands in for a
      // solid column of calyces, not for a translucent petal, so the far side
      // of it is not lit from behind — flip the normal and half the stand goes
      // dark together every time the camera swings round.
      spike: keepAuthoredNormalsOnBackFaces(
        this._material({
          color: 0xffffff,
          map: SPIKE_PLATE,
          // A plain alpha test has no middle, and a spike's edge is corollas
          // standing out of the column with air between them. `alphaToCoverage`
          // is what rule 9 asks for on exactly this kind of organ.
          alphaTest: SPIKE_PLATE ? 0.32 : 0,
          alphaToCoverage: Boolean(SPIKE_PLATE),
          transparent: false,
          vertexColors: true,
          // Lavender flowers are matt and slightly waxy; a tight highlight
          // puts a white sheen across the corollas and takes the violet
          // straight out of them.
          roughness: 0.88,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      ),
    };
    // The spikes stand on stiff square stems well clear of the mound, so they
    // move on their own account rather than with the foliage: less travel
    // than a leaf, and quicker, which is what a stiff stem does.
    this._leafWind.apply(this._materials.spike, {
      variant: 'lavender-spikes',
    });
  }

  #createInstances() {
    this._addInstancedOrgan('leaves', {
      name: 'Lavender_Leaves_Decussate',
      // No stalk rung. A lavender leaf is sessile — it sits straight on the
      // stem — so unlike every other plant in this library there is no
      // petiole to mesh, and none painted into the plate either.
      geometry: this._sharedGeometry(
        'shared/leaf-card',
        { roundedNormals: this._assets.leaf.roundedNormals },
        createLeafCardGeometry,
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('spikes', {
      name: 'Lavender_Spikes',
      geometry: this._sharedGeometry(
        'lavender/spike-card',
        {},
        createSpikeCardGeometry,
      ),
      material: this._materials.spike,
      group: this._flowerGroup,
      // A shell of cards standing in for a dense column: they shadow each
      // other into hard mottling across what should read as one soft body.
      // They still cast, because a spike shading the mound under it is real.
      receivesShadow: false,
    });

    const leafInstances = this._instancePool.mesh('leaves');
    leafInstances.customDepthMaterial = this._materials.leafDepth;
    leafInstances.customDistanceMaterial = this._materials.leafDistance;
  }

  /* ------------------------------------------------------------------ *
   * Stable graph
   * ------------------------------------------------------------------ */

  #buildStableGraph() {
    const capacities = HIDCOTE_RENDER_PRIORS.instanceCapacities;
    const historicalCounts = {
      ...this._emptyInstanceCounts(),
      ...capacities,
      // At coarse bands the leaf pool carries the flower stems and the spikes
      // as well as the leaves, so it has to be sized for all three.
      leaves: capacities.leaves + capacities.spikes * 2,
    };
    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts: new Map(),
      unknownYearCounts: { ...historicalCounts },
    });
  }

  /** Build render runtimes only for the axes present in this snapshot. */
  #syncRuntime(snapshot) {
    let signature = '';
    for (const branch of snapshot.canes) {
      for (const axis of branch.axes) signature += `${axis.id}|`;
    }
    if (signature === this._lavenderRuntimeSignature) return;

    this._runtime.axes.clear();
    this._runtime.leaves.clear();
    this._runtime.spikes.clear();

    for (const branch of snapshot.canes) {
      const nodeAttachments = new Map();
      branch.axes.forEach((axis, axisIndex) => {
        this._buildAxisRuntime({
          cane: branch,
          axis: {
            ...axis,
            points: axis.sourcePoints,
            nodes: axis.sourceNodes,
          },
          axisIndex,
          nodeAttachments,
        });

        for (const node of axis.sourceNodes) {
          for (const leaf of node.leaves) {
            this._runtime.leaves.set(leaf.id, {
              id: leaf.id,
              identity: this._renderIdentity(leaf.id, 'leaf'),
              quaternion: makeBasisQuaternion(
                vector(leaf.direction),
                vector(leaf.normal, UP),
              ),
              size:
                leaf.lengthM *
                keyedRange(this.seed, [leaf.id, 'size'], 0.9, 1.1),
              sourceSize: leaf.lengthM,
            });
          }
        }

        const spike = axis.spike;
        if (!spike) return;
        const direction = vector(spike.direction);
        if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
        direction.normalize();
        this._runtime.spikes.set(spike.id, {
          id: spike.id,
          identity: this._renderIdentity(spike.id, 'spike'),
          quaternion: makeBasisQuaternion(direction, UP).multiply(
            new THREE.Quaternion().setFromAxisAngle(UP, spike.roll),
          ),
          // One plate draws every spike on the plant, so the spike-to-spike
          // variation the photographs show has to arrive per instance. The
          // range is narrow on purpose: 'Hidcote' is a clone, and a stand of
          // it reads as one colour with life in it, not as a mixed planting.
          shade: keyedRange(this.seed, [spike.id, 'shade'], -1, 1),
        });
      });
    }

    this._lavenderRuntimeSignature = signature;
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

  /** Seat one sessile leaf card at its node. */
  #setLeaf(runtime, leafState, detailScale) {
    const { matrix, position, scale } = this.#scratch;
    const cardScale =
      runtime.size * (leafState.scale / runtime.sourceSize) * detailScale || 0;
    if (cardScale <= 0) return false;
    position.copy(leafState.position);
    scale.set(cardScale, cardScale, cardScale);
    matrix.compose(position, runtime.quaternion, scale);
    this._writeInstance('leaves', runtime.identity, matrix, NEUTRAL);
    return true;
  }

  /** The colour one spike is showing today, green through violet to dry. */
  #spikeColour(target, spike, runtime) {
    // Two hops rather than one three-way blend: the spike goes green, then
    // violet, then dry, and it never passes through a mix of green and brown.
    if (spike.maturity <= 0.5) {
      target
        .copy(SPIKE_GREEN)
        .lerp(SPIKE_VIOLET, THREE.MathUtils.smoothstep(spike.maturity, 0, 0.5));
    } else {
      target
        .copy(SPIKE_VIOLET)
        .lerp(SPIKE_DRY, THREE.MathUtils.smoothstep(spike.maturity, 0.5, 1));
    }
    const shade = 1 + runtime.shade * SPIKE_TINT_SPREAD;
    return target.multiplyScalar(shade);
  }

  /** Seat one spike as its own crossed card. Band 0 only. */
  #setSpike(runtime, spike) {
    const { matrix, position, scale, colour } = this.#scratch;
    const width = spike.widthM / SPIKE_PLATE_FILL;
    position.copy(spike.position);
    scale.set(width, spike.lengthM, width);
    matrix.compose(position, runtime.quaternion, scale);
    this._writeInstance(
      'spikes',
      runtime.identity,
      matrix,
      this.#spikeColour(colour, spike, runtime),
    );
  }

  /**
   * Seat one whole flower shoot — stem and spike — as two leaf cards.
   *
   * What bands 1 and 2 draw instead of a spike mesh and a meshed peduncle.
   * The stem is the leaf plate stretched to 1.5 mm across and left in the
   * foliage's own colour, which is already a peduncle's colour; the spike is
   * the same plate at the spike's real width, tinted.
   *
   * The tint has to be divided by the leaf material's seasonal colour before
   * it is written, because that colour multiplies every instance in this pool
   * — so a violet written raw comes out through a grey-green filter and lands
   * somewhere between the two. Dividing it back out is exact for the material
   * and approximate for the plate underneath, which at four metres is a
   * distinction with no consequence.
   */
  #setSpikeStandIn(runtime, spike, axis, detailScale) {
    const { matrix, position, scale, colour, direction, quaternion } =
      this.#scratch;

    // The stem: root to the spike's base, as one stretched card.
    const root = vector(axis.root);
    direction.copy(spike.position).sub(root);
    const stemLength = direction.length();
    if (stemLength > 1e-4) {
      direction.multiplyScalar(1 / stemLength);
      quaternion.copy(makeBasisQuaternion(direction, UP));
      const stemWidth =
        (HIDCOTE_PROFILE.peduncle.baseRadiusM[1] * 2.2 * detailScale) /
        LEAF_PLATE_FILL;
      position.copy(root);
      scale.set(stemWidth, stemLength, stemWidth);
      matrix.compose(position, quaternion, scale);
      this._writeInstance('leaves', runtime.identity, matrix, NEUTRAL);
    }

    const width = (spike.widthM * detailScale) / LEAF_PLATE_FILL;
    position.copy(spike.position);
    scale.set(width, spike.lengthM * detailScale, width);
    matrix.compose(position, runtime.quaternion, scale);
    this.#spikeColour(colour, spike, runtime);
    const divisor = this._standInDivisor.copy(this._materials.leaf.color);
    const scaled = STAND_IN_VALUE;
    colour.setRGB(
      THREE.MathUtils.clamp(
        (colour.r * scaled) / Math.max(0.02, divisor.r),
        0,
        6,
      ),
      THREE.MathUtils.clamp(
        (colour.g * scaled) / Math.max(0.02, divisor.g),
        0,
        6,
      ),
      THREE.MathUtils.clamp(
        (colour.b * scaled) / Math.max(0.02, divisor.b),
        0,
        6,
      ),
    );
    this._writeInstance('leaves', runtime.identity, matrix, colour);
  }

  #setLeafMaterialPhenology(phenology) {
    const spring = THREE.MathUtils.smoothstep(phenology.springGrowth, 0, 0.9);
    this._leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, spring)
      .lerp(WINTER_LEAF_TINT, phenology.winterProgress);
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

    // Whether the spike mesh is being drawn at all. When it is not, the flower
    // shoots ride in the leaf pool instead of vanishing.
    const spikesAsCards = this._detail.dropKinds.includes('spikes');

    // Sized on what will actually be written, not on how many leaf sites the
    // graph holds. This plant is evergreen, so a site that is not drawn today
    // is one this sample does not carry rather than one that has fallen, and
    // counting them all would thin a January mound as hard as a July one.
    let writes = 0;
    for (const branch of snapshot.canes) {
      for (const axis of branch.axes) {
        for (const node of axis.nodes) {
          for (const leaf of node.leaves) if (leaf.visible) writes += 1;
        }
        // At coarse bands a flower shoot is two more cards from this pool.
        if (spikesAsCards && axis.spike?.visible) writes += 2;
      }
    }
    const capacity = this._instancePool.mesh('leaves').instanceMatrix.count;
    const leafStride =
      writes <= capacity
        ? this._detail.leafStride
        : Math.max(
            this._detail.leafStride,
            Math.ceil(writes / Math.max(1, capacity * 0.9)),
          );
    const leafScale =
      this._detail.leafScale *
      (leafStride > this._detail.leafStride ? 1.08 : 1);
    // Spikes thin one step behind the leaves. A lavender that keeps its
    // foliage and loses its flowers has lost more than one that does the
    // reverse, so the display is the last thing to go. Card counts fall with
    // the square of apparent size, so the survivors grow by the root of the
    // stride -- and only when there actually is one. Growing them at a band
    // that thins nothing just draws a stand of fat violet blobs.
    const spikeStride = Math.max(1, Math.ceil(leafStride / 2));
    const spikeScale =
      spikeStride > 1 ? Math.min(1.9, Math.sqrt(spikeStride)) : 1;

    let visibleBranches = 0;
    let visibleAxes = 0;
    let visibleShoots = 0;
    let visibleLeaves = 0;
    let visibleSpikes = 0;

    for (const branch of snapshot.canes) {
      if (branch.removed) continue;
      visibleBranches++;
      for (const axis of branch.axes) {
        if (!this._runtime.axes.has(axis.id)) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes++;
        if (axis.order === 1) visibleShoots++;

        for (const node of axis.nodes) {
          for (const state of node.leaves) {
            if (!state.visible) continue;
            const runtime = this._runtime.leaves.get(state.id);
            if (!runtime) {
              throw new Error(
                `Missing render leaf for model organ ${state.id}.`,
              );
            }
            const detailScale = this.#detailScale(
              runtime,
              leafStride,
              leafScale,
            );
            if (detailScale <= 0) continue;
            if (this.#setLeaf(runtime, state, detailScale)) visibleLeaves++;
          }
        }

        const spike = axis.spike;
        if (!spike?.visible) continue;
        const runtime = this._runtime.spikes.get(spike.id);
        if (!runtime) {
          throw new Error(`Missing render spike for model organ ${spike.id}.`);
        }
        if (spikesAsCards) {
          const detailScale = this.#detailScale(
            runtime,
            spikeStride,
            spikeScale,
          );
          if (detailScale <= 0) continue;
          this.#setSpikeStandIn(runtime, spike, axis, detailScale);
        } else {
          this.#setSpike(runtime, spike);
        }
        visibleSpikes++;
      }
    }

    this._instancePool.commitFrame();

    this._renderStats = {
      // `visibleCanes` is the shared stats contract every plant answers to.
      // On this one a cane is a framework branch; the species name is beside
      // it so a caller reading lavender stats does not have to translate.
      visibleCanes: visibleBranches,
      visibleAxes,
      visibleBranches,
      visibleShoots,
      visibleLeaves,
      visibleSpikes,
      spikesDrawnAsCards: spikesAsCards,
      biologicalVisibleLeaves: snapshot.stats.leaves,
      biologicalVisibleSpikes: snapshot.stats.spikes,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateHidcoteModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this._events,
      region: this.region,
      offsetDays: this.offsetDays,
    });
  }

  _decorateEvent(event) {
    if (event.type === 'trim') {
      return { ...event, ...createTrimEvent(event) };
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
   * Shear the plant early.
   *
   * The only cut a lavender gets, and it is already in the calendar: the model
   * shears itself in late summer whether asked or not, because every plant in
   * this library is one somebody looks after. This is here for the gardener
   * who cuts the spikes for drying before the display is over, which is done
   * as the first corollas open and is the one legitimate reason to be early.
   *
   * It refuses to cut into old wood, because the plant would not come back
   * from it. There is no `pruneOldestBranch` on this class for the same
   * reason, and its absence is the cultivar rather than an omission.
   */
  shear(options = {}) {
    const targetAge = PlantRenderer.number(options.ageYears, this.ageYears);
    const targetDay = THREE.MathUtils.clamp(
      Math.floor(PlantRenderer.number(options.dayOfYear, this.dayOfYear)),
      1,
      365,
    );
    const reject = (reason) => ({ event: null, applied: false, reason });
    const calendar = this._snapshot.phenology.calendar;

    if (targetDay < calendar.floweringStart) return reject('before-flowering');
    if (targetDay >= calendar.trimDay) return reject('already-sheared');
    if (
      this._events.some(
        (event) =>
          event.type === 'trim' &&
          Math.floor(event.ageYears) === Math.floor(targetAge),
      )
    ) {
      return reject('already-sheared');
    }

    const event = this.addEvent(
      createTrimEvent({
        ageYears: Math.floor(targetAge),
        dayOfYear: targetDay,
      }),
    );
    return { event, applied: true, type: 'trim' };
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
      region: this.region,
      // There is no renewal cut on this plant and no way to make one: it does
      // not break from old wood. What it gets instead is one shear a year,
      // and a replacement when it goes woody.
      shearedAutomatically: true,
      cycleIndex: this._snapshot.cycleIndex,
      cycleAgeYears: this._snapshot.cycleAgeYears,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Lavender',
      plantId: this._plantId,
      species: HIDCOTE_PROFILE.species,
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

export { hidcoteEventTime };
export default Lavender;
