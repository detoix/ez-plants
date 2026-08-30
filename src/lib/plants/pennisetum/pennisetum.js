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
  BLADE_BAKED_ARCH,
  BLADE_TWIST_VARIANTS,
  BLADE_WIDTH_RATIOS,
  bladeArchTilt,
  createBladeGeometry,
  createBottlebrushGeometry,
  createBottlebrushTexture,
} from './geometry.js';
import { HAMELN_PROFILE } from './hameln.js';
import { createHamelnModel, evaluateHamelnModel } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The blade's own width axis, which its arch plane turns about. Negative Z
 * because the geometry arches toward local +X: a positive rotation about -Z
 * carries the tip from the emergence axis out into the arch.
 */
const BLADE_TILT_AXIS = new THREE.Vector3(0, 0, -1);
const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

const CULM_SHEATH = new THREE.Color(0x55733b);
const CULM_GREEN = new THREE.Color(0x789253);
const CULM_AUTUMN = new THREE.Color(0x9f7a38);
const CULM_STRAW = new THREE.Color(0xb8aa84);
const CULM_WEATHERED = new THREE.Color(0xbdb39b);

const BLADE_SPRING = new THREE.Color(0x789c50);
const BLADE_SUMMER = new THREE.Color(0x507f3d);
const BLADE_GOLD = new THREE.Color(0xa88a3f);
const BLADE_ORANGE = new THREE.Color(0xa8662f);
const BLADE_STRAW = new THREE.Color(0xbbaa7e);
const BLADE_IVORY = new THREE.Color(0xc8bda0);

const HEAD_GREEN_CREAM = new THREE.Color(0xc7c99d);
const HEAD_PINK_CREAM = new THREE.Color(0xd1bca0);
const HEAD_BEIGE = new THREE.Color(0xbca77c);
const HEAD_GREY_BROWN = new THREE.Color(0x968a70);
const HEAD_WEATHERED = new THREE.Color(0xb5aa91);

/**
 * A grass carries no wood mesh, so library rule 9 gives it three draws at its
 * near band: blades, bottlebrush heads and culms.
 */
const INSTANCE_KINDS = Object.freeze(['culms', 'blades', 'panicles']);

/**
 * The blade's detail ladder, indexed by `organLevel`.
 *
 * Two vertex columns at every rung; what changes is how finely the arch is
 * sampled.
 */
const BLADE_LADDER = Object.freeze([
  Object.freeze({ segments: 9, columns: 2 }),
  Object.freeze({ segments: 5, columns: 2 }),
  Object.freeze({ segments: 4, columns: 2 }),
]);

/**
 * The head's detail ladder, indexed by `organLevel`.
 *
 * Each head stays crossed so the narrow cylinder has volume from every view.
 */
const PANICLE_LADDER = Object.freeze([
  Object.freeze({ planes: 3, segments: 3 }),
  Object.freeze({ planes: 2, segments: 2 }),
  Object.freeze({ planes: 2, segments: 1 }),
]);

// A clump carries far more instances than this library's shrubs, so it drops
// detail sooner and harder.
const DEFAULT_LOD_LEVELS = Object.freeze([
  // `sectionStride` is the culm lever even at the near band. A mature clump
  // draws 930 culm segments, and at two triangles a side that is a fifth of
  // the plant's entire budget spent on stems that the blades bury.
  Object.freeze({
    distance: 0,
    detail: Object.freeze({ sectionStride: 2, organLevel: 0 }),
  }),
  Object.freeze({
    distance: 6,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.7,
      leafStride: 2,
      leafScale: 1.2,
      organLevel: 1,
      dropKinds: ['panicles'],
    }),
  }),
  // Three levels, like every other plant in the library. This one used to
  // carry a fourth; its middle two were close enough that collapsing them
  // costs almost nothing, so the coarse level keeps the furthest settings
  // rather than the intermediate ones.
  Object.freeze({
    distance: 11,
    hysteresis: 0.12,
    detail: Object.freeze({
      sectionStride: 4,
      segmentFactor: 0.42,
      // Thinned less hard than the old far band, which was tuned when a blade
      // cost 176 triangles. At 8 it can afford to keep more of the clump, and
      // a clump's silhouette at eleven metres is the only thing left of it.
      leafStride: 3,
      leafScale: 1.4,
      organLevel: 2,
      dropKinds: ['panicles'],
    }),
  }),
]);

/**
 * Persistent renderer for Pennisetum alopecuroides 'Hameln'.
 *
 * The shared base supplies groups, tracked resources,
 * stable-capacity instance pools, LOD, leaf wind and the validated state
 * cycle — but its welded bark-tube pass is deliberately unused: a grass culm
 * is a thin, smooth, one-season cane that needs per-culm colour far more than
 * it needs bark UVs, so culms are instanced segments like every other organ.
 *
 * Age shapes the crown; day of year builds and then weathers one annual crop
 * of culms, fine blades and bottlebrush heads.
 */
export class Pennisetum extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const cultivar = options.cultivar ?? HAMELN_PROFILE.cultivar;
    if (cultivar !== HAMELN_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${HAMELN_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: HAMELN_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Pennisetum',
      detailStrideSalt: 'pennisetum-hameln-detail',
      plantId: options.plantId ?? `pennisetum:${options.seed ?? 1964}`,
      seed: options.seed ?? 1964,
      maxYears: options.maxYears ?? 20,
      ageYears: options.ageYears ?? 5,
      dayOfYear: options.dayOfYear ?? 230,
      assets: options.assets ?? {},
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      // A caller may state its own bands; the cultivar's are the default,
      // not a ceiling. The distances that suit a garden close-up are not the
      // ones that suit a landscape, and only the application knows which it
      // is looking at.
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind: {
        // Long thin blades and silky plumes are the most mobile foliage in
        // this library; a still Pennisetum reads as plastic.
        strength: new THREE.Vector3(0.11, 0, 0.11),
        frequency: 0.72,
        scale: 0.72,
        // The caller may override any of this, including switching the
        // wind off entirely -- it is the most expensive per-vertex work in
        // the scene.
        ...options.leafWind,
      },
    });

    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createHamelnModel({
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
  }

  #createMaterials() {
    // Blades and heads share the leaf-wind contract. The shared shader bends
    // by uv.y, supplied from base to tip by both geometries.
    const foliage = createLeafMaterialSet({
      name: 'Pennisetum_Hameln_Blades',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest ?? 0,
      // A blade is a solid two-sided ribbon, not a card cut out of a plate,
      // so it wants true face-direction shading rather than EZ-Tree's
      // rounded-canopy normals.
      roundedNormals: false,
      vertexColors: true,
      wind: this._leafWind,
      windVariant: 'pennisetum-hameln-blades',
    });
    this._resources.trackMaterial(foliage.surface);
    this._resources.trackMaterial(foliage.depth);
    this._resources.trackMaterial(foliage.distance);

    this._protect('_bottlebrushTexture');
    this._bottlebrushTexture = sharedTexture(
      'pennisetum/hameln-bottlebrush',
      {},
      createBottlebrushTexture,
    );

    // The generated plate keeps sub-pixel bristles in texture alpha instead of
    // geometry. Crossed ribbons provide the dense cylindrical bottlebrush.
    const panicle = createLeafMaterialSet({
      name: 'Pennisetum_Hameln_Panicles',
      map: this._bottlebrushTexture,
      alphaTest: 0.13,
      roundedNormals: true,
      vertexColors: true,
      wind: this._leafWind,
      windVariant: 'pennisetum-hameln-panicles',
    });
    // Alpha-to-coverage softens the fine bristle edge under MSAA.
    panicle.surface.alphaToCoverage = true;
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
    this._addInstancedOrgan('culms', {
      name: 'Pennisetum_Culms',
      geometry: this._stemGeometry(3, { openEnded: true }),
      material: this._materials.culm,
      group: this._woodyGroup,
    });

    this._addInstancedOrgan('blades', {
      name: 'Pennisetum_Blades',
      geometries: BLADE_LADDER.map((rung) =>
        this._sharedGeometry(
          'pennisetum/blade',
          {
            arch: BLADE_BAKED_ARCH,
            twist: BLADE_TWIST_VARIANTS[1],
            widthRatio: BLADE_WIDTH_RATIOS[1],
            ...rung,
          },
          createBladeGeometry,
        ),
      ),
      material: this._materials.blade,
      group: this._leafGroup,
    });
    const blades = this._instancePool.mesh('blades');
    blades.customDepthMaterial = this._materials.bladeDepth;
    blades.customDistanceMaterial = this._materials.bladeDistance;

    this._addInstancedOrgan('panicles', {
      name: 'Pennisetum_Panicles',
      geometries: PANICLE_LADDER.map((rung) =>
        this._sharedGeometry(
          'pennisetum/panicle',
          rung,
          createBottlebrushGeometry,
        ),
      ),
      material: this._materials.panicle,
      group: this._flowerGroup,
      // Crossed alpha cards should not receive their own faceted shadows.
      receivesShadow: false,
    });
    const panicles = this._instancePool.mesh('panicles');
    panicles.customDepthMaterial = this._materials.panicleDepth;
    panicles.customDistanceMaterial = this._materials.panicleDistance;
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
        // A blade steps down through the arch variants as it expands, but
        // posture is a rotation now rather than a pool, so one slot covers it
        // for the whole season.
        count({ blades: 1 });
      }
      if (tiller.panicle) count({ panicles: 1 });
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
   * it in a sheath, so the part inside the leaf mass stays green leaf tissue.
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
      .lerp(CULM_AUTUMN, clamp01(phenology.autumnProgress))
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
    // Individual blades pass through yellow-orange at slightly different
    // times, matching the mottled autumn fountain in photographs.
    const warm = Math.sin(Math.PI * senescence);
    return BLADE_SPRING.clone()
      .lerp(BLADE_SUMMER, clamp01(phenology.emergenceProgress * 1.4))
      .lerp(BLADE_GOLD, warm * 0.5)
      .lerp(BLADE_ORANGE, warm * 0.22)
      .lerp(BLADE_STRAW, senescence)
      .lerp(BLADE_IVORY, clamp01(blade.weathering) * 0.7);
  }

  #headColour(panicle) {
    // Heads mature individually around the shared seasonal window.
    const lead = keyedRange(
      this.seed,
      [panicle.sourceId, 'plume-lead'],
      0.82,
      1.24,
    );
    const maturity = clamp01(panicle.headMaturityProgress * lead);
    const weathered = clamp01(panicle.weathering);
    return HEAD_GREEN_CREAM.clone()
      .lerp(HEAD_PINK_CREAM, clamp01(maturity * 2))
      .lerp(HEAD_BEIGE, clamp01(maturity * 1.45 - 0.22))
      .lerp(HEAD_GREY_BROWN, clamp01(maturity * 1.25 - 0.36))
      .lerp(HEAD_WEATHERED, weathered * 0.78);
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
    // One blade is meshed for the whole plant, so its posture arrives as a
    // rotation in its own arch plane rather than as a second geometry. Applied
    // innermost, before the roll, so the roll still spins a correctly-arched
    // blade about its emergence axis. See `bladeArchTilt`.
    quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        BLADE_TILT_AXIS,
        bladeArchTilt(blade.arch),
      ),
    );

    // One uniform scale: the blade carries its own aspect ratio, because its
    // twist puts part of the width axis into the plane the arch lives in.
    const lengthM = blade.lengthM * detailScale;
    this._writeInstance(
      'blades',
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
    const colour = this.#headColour(panicle);
    const identity = this.#identity(panicle.id, 'panicle');
    const widthM = panicle.widthM * panicle.headWidthScale * detailScale;

    const compose = (across) =>
      new THREE.Matrix4().compose(
        position,
        quaternion,
        new THREE.Vector3(across, lengthM, across),
      );

    // One crossed-card cylinder per flowering culm.
    this._writeInstance(
      'panicles',
      identity,
      compose(
        widthM * THREE.MathUtils.lerp(0.9, 1.06, panicle.plumeVisibility),
      ),
      colour,
    );
    return panicle.plumeVisibility > 0.02;
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
    return evaluateHamelnModel(this.#model, {
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
      type: 'Pennisetum',
      plantId: this._plantId,
      species: HAMELN_PROFILE.species,
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

export default Pennisetum;
