import * as THREE from 'three';

import { createLeafMaterialSet } from '../../leaf-material.js';
import { keyedRange } from '../../keyed-random.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { sharedTexture } from '../../shared-resources.js';
import {
  composeSegmentMatrix,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import {
  BLADE_ARCH_VARIANTS,
  BLADE_TWIST_VARIANTS,
  BLADE_WIDTH_RATIOS,
  createBladeGeometry,
  createMidribEmissiveTexture,
  createPlumeGeometry,
  createRacemeFanGeometry,
  createSpikeletGeometry,
} from './geometry.js';
import { MALEPARTUS_PROFILE } from './malepartus.js';
import { createMalepartusModel, evaluateMalepartusModel } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

// Culm colours run green through a late-summer wine flush to straw, then to
// the grey-buff of a culm that has stood through a winter.
// The sheathed part of a culm is leaf tissue and reads as foliage; only the
// exposed peduncle above the flag leaf shows true culm colour.
// The midrib's own colour, added rather than multiplied. Kept low enough to
// read as a pale reflective stripe rather than a self-luminous one.
const MIDRIB_SILVER = 0xdfe4d8;
const MIDRIB_INTENSITY = 0.38;
const CULM_SHEATH = new THREE.Color(0x7c9455);
const CULM_GREEN = new THREE.Color(0x9aa869);
const CULM_WINE = new THREE.Color(0x8b6350);
const CULM_COPPER = new THREE.Color(0xa8763f);
// A clump that has stood a winter bleaches to bone rather than to a warm
// tan; the April photographs are almost grey-cream.
const CULM_STRAW = new THREE.Color(0xc9bd9e);
const CULM_WEATHERED = new THREE.Color(0xc3bdad);

// Blade instance colours. These multiply the geometry's own midrib/lamina
// pattern, so they are the leaf's overall hue rather than its detail.
const BLADE_SPRING = new THREE.Color(0x93b06b);
// Cooler and greyer than a lawn grass: photographs of the cultivar show a
// soft, faintly glaucous sea-green, not a yellow-green.
const BLADE_SUMMER = new THREE.Color(0x678a54);
const BLADE_ORANGE = new THREE.Color(0xb1743a);
const BLADE_BURGUNDY = new THREE.Color(0x8b4a3a);
const BLADE_STRAW = new THREE.Color(0xc6bea6);
const BLADE_IVORY = new THREE.Color(0xd9d3c3);

// 'Malepartus' opens coppery wine-red — this is the cultivar's whole point —
// and lightens through bronze-pink to silver by late October.
// Wine-purple, not terracotta: the sources say "coppery-purple", and a
// freshly emerged head photographs distinctly on the violet side of red.
// Blue must exceed green or the colour reads as brick.
const PLUME_COPPER = new THREE.Color(0x8c4a5e);
const PLUME_BRONZE = new THREE.Color(0xb17d6c);
const PLUME_SILVER_PINK = new THREE.Color(0xd9bfb5);
const PLUME_SILVER = new THREE.Color(0xeae5dd);
const PLUME_IVORY = new THREE.Color(0xd6cdb9);
const RACHIS_GREEN = new THREE.Color(0x93985c);
const RACHIS_STRAW = new THREE.Color(0xbfae83);

const INSTANCE_KINDS = Object.freeze([
  'culms',
  'bladesErect',
  'bladesArching',
  'bladesRecurved',
  'racemeFans',
  'spikelets',
  'plumes',
]);

/** Pool kind for each baked blade curvature, in `BLADE_ARCH_VARIANTS` order. */
const BLADE_KINDS = Object.freeze([
  'bladesErect',
  'bladesArching',
  'bladesRecurved',
]);

// A clump carries far more instances than this library's shrubs, so it drops
// detail sooner and harder.
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({ distance: 0, detail: Object.freeze({}) }),
  Object.freeze({
    distance: 6,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      segmentFactor: 0.7,
      leafStride: 2,
      leafScale: 1.2,
    }),
  }),
  Object.freeze({
    distance: 11,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 3,
      segmentFactor: 0.5,
      leafStride: 3,
      leafScale: 1.36,
    }),
  }),
  Object.freeze({
    distance: 18,
    hysteresis: 0.12,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.42,
      leafStride: 5,
      leafScale: 1.7,
    }),
  }),
]);

/**
 * Persistent renderer for Miscanthus sinensis 'Malepartus'.
 *
 * This is the library's first plant with no woody architecture at all. The
 * shared base still does most of the work — groups, tracked resources,
 * stable-capacity instance pools, LOD, leaf wind and the validated state
 * cycle — but its welded bark-tube pass is deliberately unused: a grass culm
 * is a thin, smooth, one-season cane that needs per-culm colour far more than
 * it needs bark UVs, so culms are instanced segments like every other organ.
 *
 * The consequence for the two sliders is that `age` shapes the crown (how
 * wide the clump is, how many tillers it carries, whether an undivided one
 * has opened out in the middle) while `day of year` builds and then dismantles
 * everything above it, once, every year.
 */
export class Miscanthus extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const cultivar = options.cultivar ?? MALEPARTUS_PROFILE.cultivar;
    if (cultivar !== MALEPARTUS_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${MALEPARTUS_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: MALEPARTUS_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Miscanthus',
      detailStrideSalt: 'miscanthus-malepartus-detail',
      plantId: options.plantId ?? `miscanthus:${options.seed ?? 1978}`,
      seed: options.seed ?? 1978,
      maxYears: options.maxYears ?? 25,
      ageYears: options.ageYears ?? 6,
      dayOfYear: options.dayOfYear ?? 250,
      assets: options.assets ?? {},
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      // A caller may state its own bands; the cultivar's are the default,
      // not a ceiling. The distances that suit a garden close-up are not the
      // ones that suit a landscape, and only the application knows which it
      // is looking at.
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind: {
        // Long thin blades and silky plumes are the most mobile foliage in
        // this library; a still Miscanthus reads as plastic.
        strength: new THREE.Vector3(0.13, 0, 0.13),
        frequency: 0.62,
        scale: 1.05,
      },
    });

    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createMalepartusModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    this._initialiseEvents(options.events ?? []);

    this._runtime.identities = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    // The base's welded woody mesh is created but never written to, so its
    // draw-call accounting stays correct and reports zero for this species.
    this._createWoodMesh(this._materials.culm);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
    if (options.lod) this._enableLOD();
  }

  #createMaterials() {
    // Blades, panicles and plumes are all real geometry with baked vertex
    // colours, and all of them should move on one wind clock, so they share
    // the leaf material contract rather than inventing a second one. The
    // shared shader bends by `uv.y`, which every one of these geometries
    // supplies from its own height.
    const foliage = createLeafMaterialSet({
      name: 'Miscanthus_Malepartus_Blades',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest ?? 0,
      // A blade is a solid two-sided ribbon, not a card cut out of a plate,
      // so it wants true face-direction shading rather than EZ-Tree's
      // rounded-canopy normals.
      roundedNormals: false,
      vertexColors: true,
      wind: this._leafWind,
      windVariant: 'miscanthus-malepartus-blades',
    });
    this._resources.trackMaterial(foliage.surface);
    this._resources.trackMaterial(foliage.depth);
    this._resources.trackMaterial(foliage.distance);

    // The ash-white midrib arrives as an additive term rather than as an
    // over-driven multiplier, so it survives being dropped into a scene whose
    // exposure and tone mapping this library does not control.
    // Shared, not tracked: the map is one texel row of the same values for
    // every plant, and a per-plant copy is a distinct GPU binding for nothing.
    this._protect('_midribEmissive');
    this._midribEmissive = sharedTexture(
      'miscanthus/midrib-emissive',
      {},
      createMidribEmissiveTexture,
    );
    foliage.surface.emissiveMap = this._midribEmissive;
    foliage.surface.emissive = new THREE.Color(MIDRIB_SILVER);
    foliage.surface.emissiveIntensity = MIDRIB_INTENSITY;
    foliage.surface.needsUpdate = true;

    const panicle = createLeafMaterialSet({
      name: 'Miscanthus_Malepartus_Panicles',
      map: null,
      alphaTest: 0,
      roundedNormals: false,
      vertexColors: true,
      wind: this._leafWind,
      windVariant: 'miscanthus-malepartus-panicles',
    });
    this._resources.trackMaterial(panicle.surface);
    this._resources.trackMaterial(panicle.depth);
    this._resources.trackMaterial(panicle.distance);

    this._materials = {
      // Culms carry their season in an instance colour, so the material is
      // left neutral. They are also the one organ kept out of the wind: each
      // culm is drawn as a stack of short segments, and bending each segment
      // by its own local height would pull them apart.
      culm: this._material({ color: 0xffffff, roughness: 0.82 }),
      blade: foliage.surface,
      bladeDepth: foliage.depth,
      bladeDistance: foliage.distance,
      panicle: panicle.surface,
      panicleDepth: panicle.depth,
      panicleDistance: panicle.distance,
    };
  }

  #createInstances() {
    const racemes = MALEPARTUS_PROFILE.panicle.racemeCount;
    const racemeCount = Math.round((racemes[0] + racemes[1]) / 2);

    this._addInstancedOrgan('culms', {
      name: 'Miscanthus_Culms',
      geometry: this._stemGeometry(5),
      material: this._materials.culm,
      group: this._woodyGroup,
    });

    BLADE_KINDS.forEach((kind, variant) => {
      this._addInstancedOrgan(kind, {
        name: `Miscanthus_Blades_${kind.slice('blades'.length)}`,
        geometry: this._sharedGeometry(
          'miscanthus/blade',
          {
            arch: BLADE_ARCH_VARIANTS[variant],
            twist: BLADE_TWIST_VARIANTS[variant],
            widthRatio: BLADE_WIDTH_RATIOS[variant],
          },
          createBladeGeometry,
        ),
        material: this._materials.blade,
        group: this._leafGroup,
      });
      const mesh = this._instancePool.mesh(kind);
      mesh.customDepthMaterial = this._materials.bladeDepth;
      mesh.customDistanceMaterial = this._materials.bladeDistance;
    });

    this._addInstancedOrgan('racemeFans', {
      name: 'Miscanthus_Panicle_RacemeFans',
      geometry: this._sharedGeometry(
        'miscanthus/raceme-fan',
        { racemes: racemeCount },
        createRacemeFanGeometry,
      ),
      material: this._materials.panicle,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('spikelets', {
      name: 'Miscanthus_Panicle_Spikelets',
      geometry: this._sharedGeometry(
        'miscanthus/spikelet',
        { racemes: racemeCount },
        createSpikeletGeometry,
      ),
      material: this._materials.panicle,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('plumes', {
      name: 'Miscanthus_Panicle_Plumes',
      geometry: this._sharedGeometry(
        'miscanthus/plume',
        { racemes: racemeCount },
        createPlumeGeometry,
      ),
      material: this._materials.panicle,
      group: this._flowerGroup,
    });

    for (const kind of ['racemeFans', 'spikelets', 'plumes']) {
      const mesh = this._instancePool.mesh(kind);
      mesh.customDepthMaterial = this._materials.panicleDepth;
      mesh.customDistanceMaterial = this._materials.panicleDistance;
    }
  }

  #buildStableGraph() {
    const historicalCounts = this._emptyInstanceCounts();
    const unknownYearCounts = this._emptyInstanceCounts();
    const annualOrganCounts = new Map();

    const count = (additions) => {
      for (const [kind, amount] of Object.entries(additions)) {
        historicalCounts[kind] += amount;
        // Every tiller site can be showing its organs at once, so the whole
        // graph is one concurrent bucket rather than a per-year cohort.
        unknownYearCounts[kind] += amount;
      }
    };

    for (const tiller of this.#model.tillers) {
      // A freshly cut stub and this year's new culm can share a site for a
      // few weeks in spring, so segment capacity has to cover both.
      count({ culms: (tiller.points.length - 1) * 2 });
      for (const node of tiller.nodes) {
        if (!node.blade) continue;
        // A blade steps down through the arch variants as it expands, so it
        // can appear in any of the pools over a season. Sizing all three for
        // every blade costs a matrix buffer and nothing else.
        for (const kind of BLADE_KINDS) count({ [kind]: 1 });
      }
      if (tiller.panicle) {
        count({ racemeFans: 1, spikelets: 1, plumes: 1 });
      }
    }

    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts,
      unknownYearCounts,
    });
  }

  /** Stable render identity for one model organ id. */
  #identity(organId, kind) {
    const identities = this._runtime.identities;
    let identity = identities.get(organId);
    if (!identity) {
      identity = this._renderIdentity(organId, kind);
      identities.set(organId, identity);
    }
    return identity;
  }

  /* ---------------------------------------------------------------- *
   * Seasonal colour
   * ---------------------------------------------------------------- */

  /**
   * Colour of one culm segment at height `fraction` along the culm.
   *
   * A grass culm is not a bare stem for most of its length: each leaf wraps
   * it in a sheath, so the part inside the leaf mass stays green leaf tissue
   * and only the peduncle above the flag leaf is exposed. That exposed part
   * is what takes the wine flush the sources describe, which is why this
   * varies along the culm instead of colouring the whole thing at once.
   */
  #culmColour(culm, phenology, fraction) {
    if (culm.cohort !== 'current') {
      return CULM_STRAW.clone().lerp(CULM_WEATHERED, clamp01(culm.weathering));
    }
    const exposed = THREE.MathUtils.smoothstep(
      fraction,
      culm.sheathTopFraction,
      Math.min(1, culm.sheathTopFraction + 0.12),
    );
    return CULM_SHEATH.clone()
      .lerp(CULM_GREEN, exposed * 0.5)
      .lerp(CULM_WINE, clamp01(phenology.paniclePush) * exposed * 0.62)
      .lerp(CULM_COPPER, clamp01(phenology.autumnProgress))
      .lerp(CULM_STRAW, clamp01(phenology.strawProgress));
  }

  /**
   * How far one blade is through its own green-to-straw journey.
   *
   * Shifting the window per blade, rather than scaling a shared curve, is
   * what lets green and straw blades genuinely coexist on one clump the way
   * an late-October photograph shows — and, unlike a multiplier, it still
   * finishes: every blade reaches straw, just not on the same day.
   *
   * A current-season blade only exists between emergence and the end of the
   * year, so the window needs no wrap handling.
   */
  #bladeSenescence(blade, phenology) {
    if (blade.cohort !== 'current') return 1;
    const shift = keyedRange(
      this.seed,
      [blade.id, 'senescence-shift'],
      -15,
      15,
    );
    const start = phenology.calendar.strawStart + shift;
    const end = phenology.calendar.strawFull + shift;
    return clamp01((phenology.dayOfYear - start) / Math.max(1, end - start));
  }

  #bladeColour(blade, phenology) {
    if (blade.cohort !== 'current') {
      return BLADE_STRAW.clone().lerp(BLADE_IVORY, clamp01(blade.weathering));
    }
    const senescence = this.#bladeSenescence(blade, phenology);
    // The sources promise bronze, red and orange. Three dated photographs
    // show something far more modest: a clump still green in mid-October, a
    // mixture of green and straw blades a fortnight later, and no
    // whole-plant copper stage at any point. So the warm tint is transient
    // *per blade* — peaking halfway through that blade's own bleaching and
    // gone by the end of it — rather than a phase the whole plant passes
    // through together.
    const warm = Math.sin(Math.PI * senescence);
    return BLADE_SPRING.clone()
      .lerp(BLADE_SUMMER, clamp01(phenology.emergenceProgress * 1.4))
      .lerp(BLADE_ORANGE, warm * 0.34)
      .lerp(BLADE_BURGUNDY, warm * 0.12)
      .lerp(BLADE_STRAW, senescence)
      .lerp(BLADE_IVORY, clamp01(blade.weathering) * 0.7);
  }

  #plumeColours(panicle) {
    // As with the blades, individual heads silver at their own rate without
    // any of them running ahead of the season's own start.
    const lead = keyedRange(
      this.seed,
      [panicle.sourceId, 'plume-lead'],
      0.82,
      1.24,
    );
    const silver = clamp01(panicle.silverProgress * lead);
    const weathered = clamp01(panicle.weathering);
    const hairs = PLUME_COPPER.clone()
      .lerp(PLUME_BRONZE, clamp01(silver * 2.1))
      .lerp(PLUME_SILVER_PINK, clamp01(silver * 1.5 - 0.25))
      .lerp(PLUME_SILVER, clamp01(silver * 1.25 - 0.25))
      .lerp(PLUME_IVORY, weathered * 0.65);
    // The spikelets themselves keep more of the wine than their hairs do.
    const spikelets = PLUME_COPPER.clone()
      .lerp(PLUME_BRONZE, clamp01(silver * 1.2))
      .lerp(PLUME_IVORY, weathered * 0.8);
    const rachis = RACHIS_GREEN.clone().lerp(
      RACHIS_STRAW,
      Math.max(clamp01(silver * 1.6), weathered),
    );
    return { hairs, spikelets, rachis };
  }

  /* ---------------------------------------------------------------- *
   * Organ writing
   * ---------------------------------------------------------------- */

  #setCulm(culm, phenology) {
    const points = culm.points;
    const stride = this._detail.sectionStride;
    const segment = new THREE.Object3D();
    const lastIndex = points.length - 1;
    let written = 0;

    // Walk the culm at the current detail stride, always closing on the tip so
    // a lower level of detail shortens no culm.
    for (let index = 0; index < points.length - 1; index += stride) {
      const end = Math.min(index + stride, points.length - 1);
      const start = vector(points[index]);
      const finish = vector(points[end]);
      if (start.distanceToSquared(finish) <= 1e-12) continue;
      const fraction = index / Math.max(1, lastIndex);
      // Leaf sheaths make the culm appreciably thicker inside the leaf mass
      // than the bare peduncle above it.
      const sheathed =
        1 - THREE.MathUtils.smoothstep(fraction, culm.sheathTopFraction, 1);
      const radius =
        culm.radii[index] *
        culm.radiusScale *
        THREE.MathUtils.lerp(1, 1.5, sheathed);
      composeSegmentMatrix(segment, start, finish, Math.max(radius, 0.0004));
      this._writeInstance(
        'culms',
        this.#identity(`${culm.id}:${index}`, 'culm-segment'),
        segment.matrix,
        this.#culmColour(culm, phenology, fraction),
      );
      written += 1;
    }
    return written;
  }

  #setBlade(blade, phenology, detailScale) {
    const emerge = vector(blade.emerge, UP).normalize();
    const arch = vector(blade.archDirection).normalize();
    // The blade geometry arches along its local +X and spans its width on
    // local +Z, so the basis must put +X on the arch direction. With
    // x = y * z, the normal that achieves it is arch x emerge.
    const quaternion = makeBasisQuaternion(emerge, arch.clone().cross(emerge));
    // Rolling about the blade's own axis swings the arch away from the strict
    // radial plane, which is what stops a clump reading as flat fans.
    quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(UP, blade.roll),
    );

    // One uniform scale: the blade carries its own aspect ratio, because its
    // twist puts part of the width axis into the plane the arch lives in.
    const lengthM = blade.lengthM * detailScale;
    this._writeInstance(
      BLADE_KINDS[blade.archVariant],
      this.#identity(blade.id, 'blade'),
      new THREE.Matrix4().compose(
        vector(blade.position),
        quaternion,
        new THREE.Vector3(lengthM, lengthM, lengthM),
      ),
      this.#bladeColour(blade, phenology),
    );
  }

  #setPanicle(panicle, detailScale) {
    const direction = vector(panicle.direction, UP);
    if (direction.lengthSq() < 1e-8) direction.copy(UP);
    direction.normalize();
    const quaternion = makeBasisQuaternion(direction, UP);
    quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(UP, panicle.spin),
    );

    const position = vector(panicle.position);
    const lengthM = panicle.lengthM;
    const colours = this.#plumeColours(panicle);
    const identity = this.#identity(panicle.id, 'panicle');
    // Squeezing the head across its own axis is how a fan still folded inside
    // the flag-leaf sheath is expressed: no second geometry, and the opening
    // is continuous rather than a swap.
    const widthM = panicle.widthM * panicle.fanOpen * detailScale;

    const compose = (across) =>
      new THREE.Matrix4().compose(
        position,
        quaternion,
        new THREE.Vector3(across, lengthM, across),
      );

    this._writeInstance(
      'racemeFans',
      identity,
      compose(widthM),
      colours.rachis,
    );
    this._writeInstance(
      'spikelets',
      identity,
      compose(widthM),
      colours.spikelets,
    );
    if (panicle.plumeVisibility > 0.02) {
      // The hair mass bulges a little past the racemes as it fluffs out.
      this._writeInstance(
        'plumes',
        identity,
        compose(
          widthM * THREE.MathUtils.lerp(0.84, 1.06, panicle.plumeVisibility),
        ),
        colours.hairs,
      );
      return true;
    }
    return false;
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    const phenology = snapshot.phenology;

    let visibleCulms = 0;
    let livingCulms = 0;
    let standingDeadCulms = 0;
    let visibleBlades = 0;
    let visiblePanicles = 0;
    let visiblePlumes = 0;
    let culmSegments = 0;

    for (const tiller of snapshot.tillers) {
      if (tiller.removed) continue;
      for (const culm of tiller.culms) {
        if (!culm.visible) continue;
        visibleCulms += 1;
        if (culm.cohort === 'current') livingCulms += 1;
        else if (culm.cohort === 'previous') standingDeadCulms += 1;
        culmSegments += this.#setCulm(culm, phenology);

        for (const node of culm.nodes) {
          const blade = node.blade;
          if (!blade?.visible || !blade.retained) continue;
          const detailScale = this._organDetailScale(blade.id);
          if (detailScale <= 0) continue;
          this.#setBlade(blade, phenology, detailScale);
          visibleBlades += 1;
        }

        const panicle = culm.panicle;
        if (!panicle?.visible) continue;
        // Plumes are the cultivar's silhouette, so LOD thins them a level
        // more gently than blades.
        const stride = Math.max(1, Math.ceil(this._detail.leafStride / 2));
        const detailScale = this._organDetailScale(
          panicle.sourceId,
          stride,
          THREE.MathUtils.lerp(1, 1.1, clamp01(this._detail.leafScale - 1)),
        );
        if (detailScale <= 0) continue;
        if (this.#setPanicle(panicle, detailScale)) visiblePlumes += 1;
        visiblePanicles += 1;
      }
    }

    this._instancePool.commitFrame();
    this._renderStats = {
      visibleTillers: snapshot.tillers.length,
      // The shared UI and the base class both speak in canes; for a grass
      // one cane is one culm.
      visibleCanes: visibleCulms,
      visibleAxes: visibleCulms,
      visibleCulms,
      livingCulms,
      standingDeadCulms,
      culmSegments,
      visibleLeaves: visibleBlades,
      visibleBlades,
      visiblePanicles,
      visiblePlumes,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateMalepartusModel(this.#model, {
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
      clump: this._snapshot.clump,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Miscanthus',
      plantId: this._plantId,
      species: MALEPARTUS_PROFILE.species,
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

export default Miscanthus;
