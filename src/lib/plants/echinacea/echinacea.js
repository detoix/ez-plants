import * as THREE from 'three';

import {
  createLeafMaterialSet,
  keepAuthoredNormalsOnBackFaces,
} from '../../leaf-material.js';
import { createLeafCardGeometry } from '../../leaf-geometry.js';
import { loadLeafPlate } from '../../leaf-plate.js';
import {
  MAGNUS_HEAD_DEFORMATION,
  setInstanceDeformation,
} from '../../instance-deformation.js';
import { PlantRenderer } from '../../plant-renderer.js';
import {
  composeSegmentMatrix,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import { createMagnusHeadGeometry } from './geometry.js';
import { MAGNUS_PROFILE } from './magnus.js';
import { createMagnusModel, evaluateMagnusModel } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);
const INSTANCE_KINDS = Object.freeze(['stems', 'leaves', 'heads']);

const HEAD_LADDER = Object.freeze([
  Object.freeze({
    rays: 20,
    raySegments: 3,
    radialSegments: 16,
    coneRings: 4,
  }),
  Object.freeze({
    rays: 16,
    raySegments: 2,
    radialSegments: 12,
    coneRings: 3,
    coarsePeduncle: true,
  }),
  Object.freeze({
    rays: 12,
    raySegments: 1,
    radialSegments: 8,
    coneRings: 2,
    coarsePeduncle: true,
  }),
]);

/**
 * Three draws nearby: smooth seasonal stems, rough leaves and capitula. At
 * distance every head site supplies its own coarse ground-connected peduncle.
 * A support-only instance collapses its capitulum before bud break or after a
 * cone drops, allowing the dedicated stems to disappear while every leafy
 * shoot remains supported within the exact 3/2/2 draw budget.
 */
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({
    distance: 0,
    detail: Object.freeze({ organLevel: 0 }),
  }),
  Object.freeze({
    distance: 5,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      leafStride: 2,
      leafScale: 1.14,
      organLevel: 1,
      dropKinds: Object.freeze(['stems']),
    }),
  }),
  Object.freeze({
    distance: 9,
    hysteresis: 0.12,
    detail: Object.freeze({
      sectionStride: 3,
      leafStride: 3,
      leafScale: 1.27,
      organLevel: 2,
      dropKinds: Object.freeze(['stems']),
    }),
  }),
]);

const STEM_SPRING = new THREE.Color(0x86a75d);
const STEM_SUMMER = new THREE.Color(0x789459);
const STEM_PURPLE = new THREE.Color(0x805b58);
const STEM_DRY = new THREE.Color(0x77654c);
const STEM_WEATHERED = new THREE.Color(0x9a896c);

const LEAF_SPRING = new THREE.Color(0x789b55);
const LEAF_SUMMER = new THREE.Color(0x4f793f);
const LEAF_AUTUMN = new THREE.Color(0xa06f39);

const HEAD_BUD = new THREE.Color(0x859461);
const HEAD_OPEN = new THREE.Color(0xffffff);
const HEAD_FADED = new THREE.Color(0xd8aaa0);
const HEAD_SEED = new THREE.Color(0x705a43);
const HEAD_WEATHERED = new THREE.Color(0x918069);

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

const MAGNUS_HEAD_MORPH_VERSION = 'magnus-head-ray-morph-v2';

/** This plant's photographed leaf plate, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));

/**
 * Collapse ray vertices under a persistent cone as a head buds or fades, or
 * collapse the whole capitulum while retaining a coarse support stalk. Head
 * visibility is packed into instance red and ray visibility into blue; each
 * channel's low [0, 1] remainder remains its real seasonal tint. That keeps
 * one head kind and one draw through every phenological mixture.
 */
function installMagnusHeadMorph(material, { shadowPass = false } = {}) {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    if (shadowPass) {
      // InstancedMesh2 exposes its colour texture only to shaders that opt in
      // to the colour chunks. Depth and distance shaders omit them by default,
      // but the packed ray visibility must shape field shadows as well.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <batching_pars_vertex>',
        '#include <batching_pars_vertex>\n#include <color_pars_vertex>',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n#include <color_pars_fragment>',
      );
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float magnusRay;
attribute float magnusHead;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#if defined(USE_INSTANCING_COLOR)
  vec3 magnusInstanceTint = instanceColor;
#elif defined(USE_INSTANCING_COLOR_INDIRECT)
  vec3 magnusInstanceTint = getColorTexture().rgb;
#else
  vec3 magnusInstanceTint = vec3(3.0, 1.0, 511.0);
#endif
  float magnusHeadVisibility = clamp(floor(magnusInstanceTint.r * 0.5), 0.0, 1.0);
  float magnusRayVisibility = clamp(floor(magnusInstanceTint.b * 0.5) / 255.0, 0.0, 1.0);
  transformed.xz *= mix(1.0, magnusHeadVisibility, magnusHead);
  transformed.y = mix(transformed.y, 1.0, magnusHead * (1.0 - magnusHeadVisibility));
  float magnusRayScale = mix(0.34, 1.0, magnusRayVisibility);
  transformed.xz *= mix(1.0, magnusRayScale, magnusRay);
#if ${shadowPass ? '0' : '1'}
  float magnusTintRed = mod(magnusInstanceTint.r, 2.0);
  float magnusTintBlue = mod(magnusInstanceTint.b, 2.0);
  vColor.r *= magnusTintRed / max(magnusInstanceTint.r, 0.000001);
  vColor.b *= magnusTintBlue / max(magnusInstanceTint.b, 0.000001);
#endif`,
      );
  };
  material.customProgramCacheKey = () =>
    `${previousCacheKey()}|${MAGNUS_HEAD_MORPH_VERSION}|${shadowPass ? 'shadow' : 'surface'}`;
  material.needsUpdate = true;
  return setInstanceDeformation(material, MAGNUS_HEAD_DEFORMATION);
}

/**
 * Echinacea purpurea 'Magnus'.
 *
 * The shared renderer still owns state validation, GPU wind, stable instance
 * pools, LOD, baking and disposal. Morphology forces one deliberate departure
 * from a shrub: every above-ground stem is annual green tissue, so EZ-Tree's
 * seeded axis grower authors its centreline but the result is drawn as smooth
 * instanced tubes rather than persistent bark-covered wood.
 */
export class Echinacea extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const cultivar = options.cultivar ?? MAGNUS_PROFILE.cultivar;
    if (cultivar !== MAGNUS_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${MAGNUS_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: MAGNUS_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Echinacea',
      detailStrideSalt: 'echinacea-magnus-detail',
      plantId: options.plantId ?? `echinacea:${options.seed ?? 1985}`,
      seed: options.seed ?? 1985,
      maxYears:
        options.maxYears ?? MAGNUS_PROFILE.architecture.modelHorizonYears,
      ageYears: options.ageYears ?? 5,
      dayOfYear: options.dayOfYear ?? 205,
      assets: options.assets ?? {},
      defaultLeafPlate: LEAF_PLATE,
      extraStateKeys: ['seasonProfile', 'offsetDays'],
      lodLevels: options.lodLevels ?? DEFAULT_LOD_LEVELS,
      leafWind: {
        // Coarse, sturdy blades flutter less than grass while still breaking
        // the silhouette in a gust. Stems remain rigid and gap-free.
        strength: new THREE.Vector3(0.045, 0, 0.045),
        frequency: 0.42,
        scale: 0.58,
        ...options.leafWind,
      },
    });

    this.seasonProfile = options.seasonProfile ?? 'typical';
    this.offsetDays = options.offsetDays ?? 0;
    this.#model = createMagnusModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    this._initialiseEvents(options.events ?? []);
    this._runtime.identities = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    // Required by the shared accounting/baking contract. This mesh remains
    // empty because herbaceous stems are the `stems` instance kind below.
    this._createWoodMesh(this._materials.stem);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
  }

  #createMaterials() {
    const leaf = createLeafMaterialSet({
      name: 'Echinacea_Magnus_Leaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      // Preserve EZ-Tree's rounded card normal on the underside too, so a
      // turned leaf does not become a black silhouette under neutral lights.
      roundedNormals: true,
      wind: this._leafWind,
      windVariant: 'echinacea-magnus-leaves',
    });
    this._resources.trackMaterial(leaf.surface);
    this._resources.trackMaterial(leaf.depth);
    this._resources.trackMaterial(leaf.distance);

    this._materials = {
      stem: this._material({ color: 0xffffff, roughness: 0.92 }),
      leaf: leaf.surface,
      leafDepth: leaf.depth,
      leafDistance: leaf.distance,
      head: installMagnusHeadMorph(
        keepAuthoredNormalsOnBackFaces(
          this._material({
            color: 0xffffff,
            vertexColors: true,
            side: THREE.DoubleSide,
            roughness: 0.82,
            metalness: 0,
          }),
        ),
      ),
      headDepth: this._resources.trackMaterial(
        installMagnusHeadMorph(
          new THREE.MeshDepthMaterial({
            name: 'Echinacea_Magnus_Head_Depth',
            side: THREE.DoubleSide,
            depthPacking: THREE.RGBADepthPacking,
          }),
          { shadowPass: true },
        ),
      ),
      headDistance: this._resources.trackMaterial(
        installMagnusHeadMorph(
          new THREE.MeshDistanceMaterial({
            name: 'Echinacea_Magnus_Head_Distance',
            side: THREE.DoubleSide,
          }),
          { shadowPass: true },
        ),
      ),
    };
  }

  #buildStableGraph() {
    const historicalCounts = this._emptyInstanceCounts();
    const unknownYearCounts = this._emptyInstanceCounts();
    const annualOrganCounts = new Map();
    const add = (kind, amount) => {
      historicalCounts[kind] += amount;
      unknownYearCounts[kind] += amount;
    };

    for (const shoot of this.#model.shoots) {
      for (const axis of shoot.axes) add('stems', axis.points.length - 1);
      add('leaves', shoot.leaves.length);
      add('heads', shoot.heads.length);
    }

    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts,
      unknownYearCounts,
    });
  }

  #createInstances() {
    this._addInstancedOrgan('stems', {
      name: 'Echinacea_HerbaceousStems',
      geometry: this._stemGeometry(5, { openEnded: true }),
      material: this._materials.stem,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('leaves', {
      name: 'Echinacea_RoughAlternateLeaves',
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

    this._addInstancedOrgan('heads', {
      name: 'Echinacea_Magnus_Capitula',
      geometries: HEAD_LADDER.map((rung, level) =>
        this._sharedGeometry(
          `echinacea/head-${level}`,
          rung,
          createMagnusHeadGeometry,
        ),
      ),
      material: this._materials.head,
      group: this._flowerGroup,
      receivesShadow: false,
    });
    const heads = this._instancePool.mesh('heads');
    heads.customDepthMaterial = this._materials.headDepth;
    heads.customDistanceMaterial = this._materials.headDistance;
  }

  #identity(organId, kind) {
    let identity = this._runtime.identities.get(organId);
    if (!identity) {
      identity = this._renderIdentity(organId, kind);
      this._runtime.identities.set(organId, identity);
    }
    return identity;
  }

  #stemColour(axis, phenology) {
    if (axis.cohort === 'dry') {
      return STEM_DRY.clone().lerp(
        STEM_WEATHERED,
        clamp01(axis.weathering * 0.75),
      );
    }
    return STEM_SPRING.clone()
      .lerp(STEM_SUMMER, clamp01(phenology.stemGrowthProgress * 1.4))
      .lerp(STEM_PURPLE, 0.18 + 0.2 * phenology.autumnProgress)
      .lerp(STEM_DRY, clamp01(phenology.dryProgress));
  }

  #leafColour(leaf, phenology) {
    const summer = clamp01(phenology.leafProgress * 1.4);
    return LEAF_SPRING.clone()
      .lerp(LEAF_SUMMER, summer)
      .lerp(
        LEAF_AUTUMN,
        clamp01(Math.max(leaf.autumnProgress, phenology.autumnProgress)),
      );
  }

  #headColour(head) {
    if (head.stage === 'bud') {
      return HEAD_BUD.clone().lerp(HEAD_OPEN, head.budProgress * 0.34);
    }
    if (head.stage === 'opening' || head.stage === 'open') {
      return HEAD_OPEN.clone().lerp(HEAD_FADED, head.fadeProgress * 0.42);
    }
    if (head.stage === 'fading') {
      return HEAD_FADED.clone().lerp(HEAD_SEED, head.seedProgress * 0.72);
    }
    return HEAD_SEED.clone().lerp(
      HEAD_WEATHERED,
      clamp01(head.weathering * 0.72),
    );
  }

  #setAxis(axis, phenology) {
    const stride = this._detail.sectionStride;
    const segment = new THREE.Object3D();
    let written = 0;
    for (let index = 0; index < axis.points.length - 1; index += stride) {
      const endIndex = Math.min(index + stride, axis.points.length - 1);
      const start = vector(axis.points[index]);
      const end = vector(axis.points[endIndex]);
      if (start.distanceToSquared(end) <= 1e-12) continue;
      const sourceRadius = axis.radii[Math.min(index, axis.radii.length - 1)];
      const radius = Math.max(0.00055, sourceRadius * axis.radiusScale);
      composeSegmentMatrix(segment, start, end, radius);
      this._writeInstance(
        'stems',
        this.#identity(`${axis.id}:segment:${index}`, 'stem-segment'),
        segment.matrix,
        this.#stemColour(axis, phenology),
      );
      written += 1;
    }
    return written;
  }

  #setLeaf(leaf, phenology, detailScale) {
    const direction = vector(leaf.direction, UP).normalize();
    const normal = vector(leaf.normal, new THREE.Vector3(0, 0, 1)).normalize();
    const quaternion = makeBasisQuaternion(direction, normal);
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, leaf.roll));
    this._writeInstance(
      'leaves',
      this.#identity(leaf.id, 'leaf'),
      new THREE.Matrix4().compose(
        vector(leaf.position),
        quaternion,
        new THREE.Vector3(
          leaf.widthM * detailScale,
          leaf.lengthM * detailScale,
          leaf.widthM * detailScale,
        ),
      ),
      this.#leafColour(leaf, phenology),
    );
  }

  #setHead(
    head,
    detailScale,
    { capitulumVisible = true, colour = this.#headColour(head) } = {},
  ) {
    const coarsePeduncle = this._detail.organLevel > 0;
    const position = vector(
      coarsePeduncle ? head.stemBasePosition : head.position,
    );
    const direction = coarsePeduncle
      ? vector(head.position).sub(position).normalize()
      : vector(head.direction, UP).normalize();
    const quaternion = makeBasisQuaternion(direction, UP);
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, head.spin));
    const diameter = head.diameterM * detailScale;
    const verticalScale = coarsePeduncle
      ? vector(head.position).distanceTo(position)
      : diameter * head.verticalScale;
    // Two red units encode the capitulum flag; two blue units per quantised
    // visibility step encode ray expansion. The shader restores the original
    // seasonal channel remainders after decoding both values.
    colour.r += capitulumVisible ? 2 : 0;
    colour.b += Math.round(clamp01(head.rayVisibility) * 255) * 2;
    this._writeInstance(
      'heads',
      this.#identity(head.id, 'flower-head'),
      new THREE.Matrix4().compose(
        position,
        quaternion,
        new THREE.Vector3(diameter, verticalScale, diameter),
      ),
      colour,
    );
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    const phenology = snapshot.phenology;
    let visiblePrimaryStems = 0;
    let visibleAxes = 0;
    let stemSegments = 0;
    let visibleLeaves = 0;
    let visibleHeads = 0;
    let visibleFlowers = 0;
    let visibleFlowerBuds = 0;
    let visibleSeedHeads = 0;
    this._instancePool.suppress(this._detail.dropKinds);
    const dedicatedStemsVisible = !this._detail.dropKinds.includes('stems');

    for (const axis of snapshot.axes) {
      if (!axis.visible) continue;
      visibleAxes += 1;
      if (axis.kind === 'main') visiblePrimaryStems += 1;
      if (dedicatedStemsVisible) {
        stemSegments += this.#setAxis(axis, phenology);
      }
    }

    for (const leaf of snapshot.leaves) {
      const detailScale = this._organDetailScale(leaf.id);
      if (detailScale <= 0) continue;
      this.#setLeaf(leaf, phenology, detailScale);
      visibleLeaves += 1;
    }

    // Keep more heads than leaves under LOD: their broad horizontal rays are
    // the exact trait that separates 'Magnus' from generic purple coneflower.
    const headStride = 1;
    for (const head of snapshot.heads) {
      const detailScale = this._organDetailScale(
        head.id,
        headStride,
        THREE.MathUtils.lerp(1, 1.08, clamp01(this._detail.leafScale - 1)),
      );
      if (detailScale <= 0) continue;
      this.#setHead(head, detailScale);
      visibleHeads += 1;
      if (head.stage === 'bud') visibleFlowerBuds += 1;
      else if (head.stage === 'opening' || head.stage === 'open') {
        visibleFlowers += 1;
      } else if (head.stage === 'seed-head') visibleSeedHeads += 1;
    }

    if (this._detail.organLevel > 0) {
      for (const support of snapshot.headSupports) {
        const detailScale = this._organDetailScale(
          support.id,
          headStride,
          THREE.MathUtils.lerp(1, 1.08, clamp01(this._detail.leafScale - 1)),
        );
        if (detailScale <= 0) continue;
        this.#setHead(support, detailScale, {
          capitulumVisible: false,
          colour: this.#stemColour(support, phenology),
        });
      }
    }

    this._instancePool.commitFrame();
    this._renderStats = {
      visibleCanes: visiblePrimaryStems,
      visibleShoots: visiblePrimaryStems,
      visibleStems: visiblePrimaryStems,
      visibleAxes,
      stemSegments,
      visibleLeaves,
      visibleHeads,
      visibleFlowers,
      visibleFlowerBuds,
      visibleSeedHeads,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateMagnusModel(this.#model, {
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
      crown: this._snapshot.crown,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Echinacea',
      plantId: this._plantId,
      species: MAGNUS_PROFILE.species,
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

export default Echinacea;
