import * as THREE from 'three';
import { TISEL_PROFILE } from './tisel.js';
import {
  createHarvestEvent,
  createPruneEvent,
  createTiselModel,
  evaluateTiselModel,
  tiselEventTime,
} from './model.js';
import {
  createBerryGeometry,
  createCalyxStarGeometry,
  createFlowerGeometry,
} from './geometry.js';
import { createLeafCardGeometry } from '../../leaf-geometry.js';
import { createLeafMaterialSet } from '../../leaf-material.js';
import { LeafWind } from '../../leaf-wind.js';
import { keyedRange } from '../../keyed-random.js';
import { PlantInstancePool } from '../../plant-instance-pool.js';
import {
  composeSegmentMatrix,
  createUnitStemGeometry,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import { ResourceTracker } from '../../resource-tracker.js';
import { PlantLODController } from '../../plant-lod.js';
import {
  normalizePlantDetail,
  samplePlantDetailSections,
  stablePlantOrganDetailScale,
} from '../../plant-detail.js';
import {
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
  createCurveBranchSections,
  sampleBranchSection,
} from '../../woody-geometry.js';
import { createBarkMaterial } from '../../woody-material.js';

const UP = new THREE.Vector3(0, 1, 0);
const GREEN_BERRY = new THREE.Color(0x91a862);
const TURNING_BERRY = new THREE.Color(0x663348);
const RIPE_BERRY = new THREE.Color(0x111723);
const SPRING_LEAF_TINT = new THREE.Color(0xf0f8e8);
const SUMMER_LEAF_TINT = new THREE.Color(0xffffff);
// The source photograph is green, so the single EZ-Tree material needs a
// strong multiplicative red/amber balance to read as Ribes yellow chlorosis.
const AUTUMN_LEAF_TINT = new THREE.Color(0xff9756);
const PETIOLE_GREEN = new THREE.Color(0x718b4d);
const PETIOLE_RED = new THREE.Color(0x87484b);
const CALYX_GREEN = new THREE.Color(0x637542);
const CALYX_BROWN = new THREE.Color(0x4b3524);
const INSTANCE_KINDS = Object.freeze([
  'leaves',
  'petioles',
  'buds',
  'racemeAxes',
  'pedicels',
  'flowerBuds',
  'flowers',
  'berries',
  'calyces',
]);
const DEFAULT_LOD_LEVELS = Object.freeze([
  Object.freeze({ distance: 0, detail: Object.freeze({}) }),
  Object.freeze({
    distance: 4.5,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 2,
      segmentFactor: 0.75,
      leafStride: 2,
      leafScale: 1.18,
    }),
  }),
  Object.freeze({
    distance: 7,
    hysteresis: 0.1,
    detail: Object.freeze({
      sectionStride: 3,
      segmentFactor: 0.55,
      leafStride: 3,
      leafScale: 1.32,
    }),
  }),
]);

function emptyInstanceCounts() {
  return Object.fromEntries(INSTANCE_KINDS.map((kind) => [kind, 0]));
}

function number(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function simulationYear(value, fallback, maxYears, label = 'ageYears') {
  const candidate = value == null ? fallback : value;
  if (!Number.isInteger(candidate)) {
    throw new RangeError(
      `${label} must be an integer between 0 and ${maxYears}`,
    );
  }
  return THREE.MathUtils.clamp(candidate, 0, maxYears);
}

/**
 * A persistent, cultivar-specific blackcurrant renderer. Stable organ pools
 * are sized from annual concurrency in the 50-year graph; each changed growth
 * snapshot repacks active instances and one combined EZ-Tree woody mesh.
 */
export class Blackcurrant extends THREE.Group {
  #plantId;
  #assets;
  #model;
  #events;
  #snapshot;
  #renderStats;
  #resources;
  #detail;
  #woodSnapshotKey;
  #lodController;
  #runtime;
  #leafWind;
  #crown;
  #woodyGroup;
  #leafGroup;
  #flowerGroup;
  #fruitGroup;
  #leafBaseColor;
  #leafSeasonTint;
  #materials;
  #woodMesh;
  #instancePool;

  constructor(options = {}) {
    super();

    const requestedCultivar = options.cultivar ?? TISEL_PROFILE.cultivar;
    if (requestedCultivar !== TISEL_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${TISEL_PROFILE.cultivar} cultivar profile.`,
      );
    }
    this.cultivar = TISEL_PROFILE.cultivar;
    this.name = `Blackcurrant_${this.cultivar}`;
    this.seed = options.seed ?? 20260811;
    this.#plantId = String(
      options.plantId ?? `blackcurrant:${this.seed}`,
    ).trim();
    if (!this.#plantId) throw new TypeError('plantId cannot be empty');
    this.maxYears = THREE.MathUtils.clamp(
      Math.floor(number(options.maxYears, 50)),
      1,
      50,
    );
    this.ageYears = simulationYear(options.ageYears, 4, this.maxYears);
    this.dayOfYear = THREE.MathUtils.clamp(
      Math.floor(number(options.dayOfYear, 190)),
      1,
      365,
    );
    this.scenario = options.scenario ?? 'maintained';
    this.trialYear = options.trialYear ?? 'mean';
    this.offsetDays = options.offsetDays ?? 0;
    const assets = options.assets ?? {};
    const leaf = assets.leaf ?? {};
    this.#assets = {
      bark: assets.bark ?? null,
      leaf: Object.freeze({
        map: leaf.map ?? null,
        tint: leaf.tint ?? 0xffffff,
        alphaTest: leaf.alphaTest ?? 0.5,
        roundedNormals: leaf.roundedNormals ?? true,
      }),
    };
    this.#model = createTiselModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });
    if (options.events != null && !Array.isArray(options.events)) {
      throw new TypeError('events must be an array of care event objects.');
    }
    this.#events = (options.events ?? []).map((event, index) =>
      this.#normaliseEvent(event, index),
    );
    if (
      new Set(this.#events.map((event) => event.id)).size !==
      this.#events.length
    ) {
      throw new Error('Initial care event ids must be unique.');
    }
    this.#snapshot = null;
    this.#renderStats = {};
    this.#resources = new ResourceTracker();
    this.#detail = Object.freeze(normalizePlantDetail());
    this.#woodSnapshotKey = null;
    this.#lodController = null;

    this.#runtime = {
      axes: new Map(),
      leaves: new Map(),
      racemes: new Map(),
    };
    this.userData.species = 'Ribes nigrum';
    this.userData.cultivar = this.cultivar;
    this.userData.units = 'metres';

    this.#leafWind = new LeafWind({
      // Instancing scales this leaf-local displacement into model metres.
      strength: new THREE.Vector3(0.085, 0, 0.085),
      frequency: 0.5,
      scale: 1.4,
    });

    this.#createGroups();
    this.#createMaterials();
    this.#buildStableGraph();
    this.#createWoodMesh();
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
    if (options.lod) this.#enableLOD();
  }

  #createGroups() {
    this.#crown = new THREE.Group();
    this.#crown.name = 'Blackcurrant_Crown';

    this.#woodyGroup = new THREE.Group();
    this.#woodyGroup.name = 'Blackcurrant_WoodyArchitecture';
    this.#leafGroup = new THREE.Group();
    this.#leafGroup.name = 'Blackcurrant_Leaves';
    this.#flowerGroup = new THREE.Group();
    this.#flowerGroup.name = 'Blackcurrant_Inflorescences';
    this.#fruitGroup = new THREE.Group();
    this.#fruitGroup.name = 'Blackcurrant_Fruit';

    this.#crown.add(
      this.#woodyGroup,
      this.#leafGroup,
      this.#flowerGroup,
      this.#fruitGroup,
    );
    this.add(this.#crown);
  }

  #material(parameters) {
    return this.#resources.trackMaterial(
      new THREE.MeshStandardMaterial(parameters),
    );
  }

  #barkMaterial(parameters) {
    return this.#resources.trackMaterial(
      createBarkMaterial({
        textured: false,
        tint: 0x5b5247,
        ...this.#assets.bark,
        ...parameters,
      }),
    );
  }

  #createMaterials() {
    const cane = this.#barkMaterial();
    const leafMaterials = createLeafMaterialSet({
      name: 'Blackcurrant_Leaves',
      map: this.#assets.leaf.map,
      tint: this.#assets.leaf.tint,
      alphaTest: this.#assets.leaf.alphaTest,
      roundedNormals: this.#assets.leaf.roundedNormals,
      wind: this.#leafWind,
      windVariant: 'blackcurrant-leaves',
    });
    this.#resources.trackMaterial(leafMaterials.surface);
    this.#resources.trackMaterial(leafMaterials.depth);
    this.#resources.trackMaterial(leafMaterials.distance);
    this.#leafBaseColor = leafMaterials.surface.color.clone();
    this.#leafSeasonTint = new THREE.Color();

    this.#materials = {
      cane,
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      petiole: this.#material({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0,
      }),
      bud: this.#material({ color: 0x75464a, roughness: 0.9, metalness: 0 }),
      flowerBud: this.#material({
        color: 0x9b7e75,
        roughness: 0.88,
        metalness: 0,
      }),
      flower: this.#material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.76,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      fruit: this.#material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.68,
        metalness: 0,
      }),
      calyx: this.#material({
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    };
  }

  #createWoodMesh() {
    const geometry = this.#geometry(
      createBranchBufferGeometry(createBranchGeometryData()),
    );
    const mesh = new THREE.Mesh(geometry, this.#materials.cane);
    mesh.name = 'Blackcurrant_Wood';
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'woody-architecture-batch';
    this.#woodMesh = mesh;
    this.#woodyGroup.add(mesh);
  }

  #buildStableGraph() {
    const canes = this.#model.canes;
    const annualOrganCounts = new Map();
    const unknownYearCounts = emptyInstanceCounts();
    const historicalCounts = emptyInstanceCounts();
    const addHistoricalOrgans = (additions) => {
      for (const [kind, amount] of Object.entries(additions)) {
        historicalCounts[kind] += amount;
      }
    };
    const addAnnualOrgans = (year, additions) => {
      let counts;
      if (Number.isFinite(year)) {
        counts = annualOrganCounts.get(year);
        if (!counts) {
          counts = emptyInstanceCounts();
          annualOrganCounts.set(year, counts);
        }
      } else {
        counts = unknownYearCounts;
      }
      for (const [kind, amount] of Object.entries(additions)) {
        counts[kind] += amount;
      }
    };

    for (const cane of canes) {
      const nodeAttachments = new Map();

      const axes = cane.axes;
      axes.forEach((axis, axisIndex) => {
        const points = axis.points.map((point) => vector(point));
        const axisNodes = axis.nodes;
        const root = points[0].clone();
        // Every woody axis owns its mature shape in local coordinates. The
        // evaluated snapshot supplies the moving root and growth scale, so a
        // young lateral extends from its parent instead of popping in at full
        // length or floating above a shortened main cane.
        const localPoints = points.map((point) => point.clone().sub(root));
        const isPrimary = axisIndex === 0 || !axis.parentId;
        const axisOrder = axis.order;
        const radiusFactors = TISEL_PROFILE.cane.axisRadiusFactors;
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
              parentSection.radius * TISEL_PROFILE.cane.childParentRadiusRatio,
            )
          : nominalBaseRadius;
        const tubularSegments = isPrimary ? 12 : 7;
        const radialSegments = isPrimary ? 7 : 5;
        const sections = createCurveBranchSections(
          localPoints,
          TISEL_PROFILE.cane.axisTaperRatios.map((ratio) => baseRadius * ratio),
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
        this.#runtime.axes.set(axis.id, axisRuntime);

        for (const node of axisNodes) {
          nodeAttachments.set(node.id, {
            axisRuntime,
            position: THREE.MathUtils.clamp(
              (node.index + 1) / Math.max(1, points.length - 1),
              0,
              1,
            ),
          });
          const nodePosition = vector(node.position);
          let tangent = vector(node.tangent);
          if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
          tangent.normalize();

          for (const leaf of node.leaves) {
            const leafId = leaf.id;
            const angle = leaf.azimuth;
            const generatedRadial = new THREE.Vector3(
              Math.cos(angle),
              0.18,
              Math.sin(angle),
            ).normalize();
            const start = nodePosition.clone();
            const end = vector(leaf.position);
            const radial = end.clone().sub(start).normalize();
            if (radial.lengthSq() < 1e-6) radial.copy(generatedRadial);
            const bladeForward = radial
              .clone()
              .multiplyScalar(0.78)
              .addScaledVector(tangent, 0.22)
              .addScaledVector(UP, 0.12)
              .normalize();
            const quaternion = makeBasisQuaternion(
              bladeForward,
              vector(
                leaf.normal,
                UP.clone().addScaledVector(radial, 0.28).normalize(),
              ),
            );
            const size = THREE.MathUtils.clamp(
              leaf.lengthM *
                keyedRange(this.seed, [leafId, 'size'], 0.94, 1.06),
              0.045,
              0.12,
            );
            const runtime = {
              id: leafId,
              start,
              position: end,
              quaternion,
              size,
              sourceSize: leaf.widthM,
            };
            const leafOrgans = {
              leaves: 1,
              petioles: 1,
              buds: 1,
            };
            addHistoricalOrgans(leafOrgans);
            addAnnualOrgans(leaf.year, leafOrgans);
            this.#runtime.leaves.set(leafId, runtime);
          }

          for (const raceme of node.racemes) {
            const racemeId = raceme.id;
            const racemeRuntime = {
              id: racemeId,
              berries: [],
            };
            addHistoricalOrgans({ racemeAxes: 1 });
            this.#runtime.racemes.set(racemeId, racemeRuntime);

            const berries = raceme.berries;
            const racemeOrgans = {
              racemeAxes: 1,
              pedicels: berries.length,
              flowerBuds: berries.length,
              flowers: berries.length,
              berries: berries.length,
              calyces: berries.length,
            };
            addHistoricalOrgans({
              pedicels: berries.length,
              flowerBuds: berries.length,
              flowers: berries.length,
              berries: berries.length,
              calyces: berries.length,
            });
            addAnnualOrgans(raceme.fruitingYear, racemeOrgans);
            berries.forEach((berry) => {
              const berryId = berry.id;
              const diameter =
                berry.diameterM *
                keyedRange(this.seed, [berryId, 'diameter'], 0.9, 1.1);
              const berryRuntime = {
                id: berryId,
                diameter,
              };
              racemeRuntime.berries.push(berryRuntime);
            });
          }
        }
      });
    }

    // The unpruned graph is the conservative neglected scenario; maintenance,
    // pruning and harvest can only remove organs. Absolute source years make
    // the largest annual bucket a safe concurrent bound for every season.
    const maximumConcurrent = { ...unknownYearCounts };
    for (const counts of annualOrganCounts.values()) {
      for (const kind of INSTANCE_KINDS) {
        maximumConcurrent[kind] = Math.max(
          maximumConcurrent[kind],
          counts[kind] + unknownYearCounts[kind],
        );
      }
    }
    this.#instancePool = new PlantInstancePool({
      capacities: Object.fromEntries(
        INSTANCE_KINDS.map((kind) => {
          const historicalCount = historicalCounts[kind];
          const activeBound = maximumConcurrent[kind];
          const withHeadroom =
            activeBound === 0 ? 0 : Math.ceil(activeBound * 1.15) + 8;
          return [kind, Math.min(historicalCount, withHeadroom)];
        }),
      ),
    });
  }

  #geometry(geometry) {
    return this.#resources.trackGeometry(geometry);
  }

  #renderIdentity(organId, kind) {
    return Object.freeze({ plantId: this.#plantId, organId, kind });
  }

  #writeInstance(kind, identity, matrix, color = null) {
    return this.#instancePool.write(kind, identity, matrix, color);
  }

  #createInstances() {
    const stemGeometry = this.#geometry(createUnitStemGeometry(5));
    const berryGeometry = this.#geometry(createBerryGeometry());
    const add = (kind, options) =>
      this.#resources.trackInstancedMesh(this.#instancePool.add(kind, options));

    add('leaves', {
      name: 'Blackcurrant_Leaves',
      geometry: this.#geometry(
        createLeafCardGeometry({
          roundedNormals: this.#assets.leaf.roundedNormals,
        }),
      ),
      material: this.#materials.leaf,
      group: this.#leafGroup,
    });
    add('petioles', {
      name: 'Blackcurrant_Petioles_RedGreen',
      geometry: stemGeometry,
      material: this.#materials.petiole,
      group: this.#leafGroup,
    });
    add('buds', {
      name: 'Blackcurrant_DormantBuds',
      geometry: berryGeometry,
      material: this.#materials.bud,
      group: this.#woodyGroup,
    });
    add('racemeAxes', {
      name: 'Blackcurrant_RacemeAxes_RedGreen',
      geometry: stemGeometry,
      material: this.#materials.petiole,
      group: this.#flowerGroup,
    });
    add('pedicels', {
      name: 'Blackcurrant_Pedicels_RedGreen',
      geometry: stemGeometry,
      material: this.#materials.petiole,
      group: this.#flowerGroup,
    });
    add('flowerBuds', {
      name: 'Blackcurrant_InflorescenceBuds',
      geometry: berryGeometry,
      material: this.#materials.flowerBud,
      group: this.#flowerGroup,
    });
    add('flowers', {
      name: 'Blackcurrant_Flowers_GreenMauve',
      geometry: this.#geometry(createFlowerGeometry()),
      material: this.#materials.flower,
      group: this.#flowerGroup,
    });
    add('berries', {
      name: 'Blackcurrant_Berries',
      geometry: berryGeometry,
      material: this.#materials.fruit,
      group: this.#fruitGroup,
    });
    add('calyces', {
      name: 'Blackcurrant_RetainedCalyxStars',
      geometry: this.#geometry(createCalyxStarGeometry()),
      material: this.#materials.calyx,
      group: this.#fruitGroup,
    });
    const leafInstances = this.#instancePool.mesh('leaves');
    leafInstances.customDepthMaterial = this.#materials.leafDepth;
    leafInstances.customDistanceMaterial = this.#materials.leafDistance;
  }

  #setLeaf(leafRuntime, leafState, nodeState, detailScale = 1) {
    const identity = (leafRuntime.identity ??= this.#renderIdentity(
      leafRuntime.id,
      'leaf',
    ));
    const unfoldProgress = THREE.MathUtils.clamp(
      leafState.unfoldProgress,
      0,
      1,
    );

    const petioleStart = vector(nodeState.position);
    const position = petioleStart
      .clone()
      .lerp(vector(leafState.position, leafRuntime.position), unfoldProgress);
    const radial = position.clone().sub(petioleStart);
    const tangent = vector(nodeState.tangent);
    if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
    tangent.normalize();
    const leafQuaternion = makeBasisQuaternion(
      radial
        .clone()
        .normalize()
        .multiplyScalar(0.78)
        .addScaledVector(tangent, 0.22)
        .addScaledVector(UP, 0.12)
        .normalize(),
      vector(leafState.normal, UP),
    );
    const sourceScale = leafState.scale / leafRuntime.sourceSize;
    const scale = leafRuntime.size * sourceScale * detailScale;
    const matrix = new THREE.Matrix4().compose(
      position,
      leafQuaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    this.#writeInstance('leaves', identity, matrix);

    const petioleDummy = new THREE.Object3D();
    composeSegmentMatrix(petioleDummy, petioleStart, position, 0.0013);
    this.#writeInstance(
      'petioles',
      identity,
      petioleDummy.matrix,
      PETIOLE_GREEN.clone().lerp(
        PETIOLE_RED,
        keyedRange(this.seed, [leafRuntime.id, 'petiole-red'], 0.35, 0.8),
      ),
    );
    leafRuntime.currentQuaternion = leafQuaternion;
  }

  #setLeafMaterialPhenology(phenology) {
    const leafProgress = THREE.MathUtils.clamp(phenology.leafProgress, 0, 1);
    const autumnProgress = THREE.MathUtils.clamp(
      phenology.autumnProgress,
      0,
      1,
    );
    const springMix = THREE.MathUtils.smoothstep(leafProgress, 0.15, 0.85);
    this.#leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, springMix)
      .lerp(AUTUMN_LEAF_TINT, autumnProgress);
    this.#materials.leaf.color
      .copy(this.#leafBaseColor)
      .multiply(this.#leafSeasonTint);
  }

  #setBud(leafRuntime, nodeState, visible) {
    if (!visible) return;
    const identity = (leafRuntime.identity ??= this.#renderIdentity(
      leafRuntime.id,
      'leaf',
    ));
    const position = vector(nodeState.position);
    const quaternion = leafRuntime.currentQuaternion ?? leafRuntime.quaternion;
    const scale = new THREE.Vector3(0.007, 0.012, 0.007);
    this.#writeInstance(
      'buds',
      identity,
      new THREE.Matrix4().compose(position, quaternion, scale),
    );
  }

  #berryColor(progress, id) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const color =
      p < 0.58
        ? GREEN_BERRY.clone().lerp(TURNING_BERRY, p / 0.58)
        : TURNING_BERRY.clone().lerp(RIPE_BERRY, (p - 0.58) / 0.42);
    return color.multiplyScalar(
      keyedRange(this.seed, [id, 'fruit-color'], 0.82, 1.1),
    );
  }

  #setRaceme(racemeRuntime, racemeState, axisGrowth = 1) {
    const flowerProgress = THREE.MathUtils.clamp(
      racemeState.flowerProgress,
      0,
      1,
    );
    const fruitProgress = THREE.MathUtils.clamp(
      racemeState.fruitProgress,
      0,
      1,
    );
    const flowerVisibility = THREE.MathUtils.clamp(
      racemeState.flowerVisibility,
      0,
      1,
    );
    const flowerOpenVisibility = THREE.MathUtils.clamp(
      racemeState.flowerOpenVisibility,
      0,
      1,
    );
    const berryVisibility = THREE.MathUtils.clamp(
      racemeState.berryVisibility,
      0,
      1,
    );
    const colorProgress = THREE.MathUtils.clamp(
      racemeState.fruitColorProgress,
      0,
      1,
    );
    const showFlowers =
      racemeState.visible !== false && flowerVisibility > 0.015;
    const showFruit = racemeState.visible !== false && berryVisibility > 0.015;
    if (!showFlowers && !showFruit) return;
    const racemeIdentity = (racemeRuntime.identity ??= this.#renderIdentity(
      racemeRuntime.id,
      'raceme',
    ));

    const start = vector(racemeState.position);
    const direction = vector(racemeState.direction);
    if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
    direction.normalize();
    const length = racemeState.lengthM * axisGrowth;
    const end = start.clone().addScaledVector(direction, length);
    const axisDummy = new THREE.Object3D();
    composeSegmentMatrix(axisDummy, start, end, 0.00075);
    this.#writeInstance(
      'racemeAxes',
      racemeIdentity,
      axisDummy.matrix,
      PETIOLE_GREEN.clone().lerp(PETIOLE_RED, 0.58),
    );

    const stateById = new Map(
      racemeState.berries.map((berry) => [berry.id, berry]),
    );
    for (const [berryIndex, berryRuntime] of racemeRuntime.berries.entries()) {
      const berryState = stateById.get(berryRuntime.id);
      const berryIdentity = (berryRuntime.identity ??= this.#renderIdentity(
        berryRuntime.id,
        'berry',
      ));
      const t = (berryIndex + 1) / (racemeRuntime.berries.length + 1);
      const pedicelStart = start.clone().lerp(end, t);
      const berryPosition = vector(berryState.position);
      const pedicelDummy = new THREE.Object3D();
      composeSegmentMatrix(pedicelDummy, pedicelStart, berryPosition, 0.00045);
      this.#writeInstance(
        'pedicels',
        berryIdentity,
        pedicelDummy.matrix,
        PETIOLE_GREEN.clone().lerp(PETIOLE_RED, 0.48),
      );

      if (showFlowers) {
        const flowerIdentity = (berryRuntime.flowerIdentity ??=
          this.#renderIdentity(berryRuntime.id, 'flower'));
        const flowerQuaternion = makeBasisQuaternion(
          berryPosition.clone().sub(pedicelStart).normalize().negate(),
          new THREE.Vector3(0, 0, 1),
        );
        if (flowerOpenVisibility > 0.015) {
          const flowerScale =
            0.0125 *
            THREE.MathUtils.lerp(0.45, 1, flowerProgress) *
            Math.sqrt(flowerOpenVisibility);
          this.#writeInstance(
            'flowers',
            flowerIdentity,
            new THREE.Matrix4().compose(
              berryPosition,
              flowerQuaternion,
              new THREE.Vector3(flowerScale, flowerScale, flowerScale),
            ),
          );
        } else {
          const budScale = 0.0055 * Math.sqrt(flowerVisibility);
          this.#writeInstance(
            'flowerBuds',
            flowerIdentity,
            new THREE.Matrix4().compose(
              berryPosition,
              flowerQuaternion,
              new THREE.Vector3(budScale * 0.72, budScale, budScale * 0.72),
            ),
          );
        }
      }

      if (
        showFruit &&
        berryState.harvested !== true &&
        berryState.visible !== false
      ) {
        const sizeProgress = THREE.MathUtils.smoothstep(fruitProgress, 0, 0.72);
        const diameter =
          berryRuntime.diameter * THREE.MathUtils.lerp(0.18, 1, sizeProgress);
        const berryQuaternion = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            keyedRange(this.seed, [berryRuntime.id, 'rx'], -0.16, 0.16),
            keyedRange(this.seed, [berryRuntime.id, 'ry'], 0, Math.PI * 2),
            keyedRange(this.seed, [berryRuntime.id, 'rz'], -0.16, 0.16),
          ),
        );
        this.#writeInstance(
          'berries',
          berryIdentity,
          new THREE.Matrix4().compose(
            berryPosition,
            berryQuaternion,
            new THREE.Vector3(diameter, diameter, diameter),
          ),
          this.#berryColor(berryState.colourProgress, berryRuntime.id),
        );

        const distalDirection = berryPosition
          .clone()
          .sub(pedicelStart)
          .normalize();
        const calyxPosition = berryPosition
          .clone()
          .addScaledVector(distalDirection, diameter * 0.51);
        const calyxScale = diameter * 0.38;
        this.#writeInstance(
          'calyces',
          berryIdentity,
          new THREE.Matrix4().compose(
            calyxPosition,
            new THREE.Quaternion().setFromUnitVectors(UP, distalDirection),
            new THREE.Vector3(calyxScale, calyxScale, calyxScale),
          ),
          CALYX_GREEN.clone().lerp(CALYX_BROWN, colorProgress),
        );
      }
    }
  }

  /** Build the cheap, geometry-free state plan and cache signature. */
  #planWoodySnapshot(snapshot, detail = this.#detail) {
    if (!snapshot || !Array.isArray(snapshot.canes)) {
      throw new TypeError('A Blackcurrant snapshot is required.');
    }

    const resolved = normalizePlantDetail(detail, this.#detail);
    const states = new Map();

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      for (const axis of cane.axes) {
        const runtime = this.#runtime.axes.get(axis.id);
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
          state.parentRadiusAtAttachment *
            TISEL_PROFILE.cane.childParentRadiusRatio,
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
  #meshWoodyPlan(plan) {
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
        appendBranchTube(data, sampled.sections, {
          radialSegments,
          caps: runtime.caps,
        });
      }
    }

    return {
      data,
      signature: plan.signature,
    };
  }

  /** Repack the live wood mesh at a new private PlantDetail level. */
  #setDetail(detail = {}) {
    const resolved = Object.freeze(normalizePlantDetail(detail, this.#detail));
    const unchanged =
      resolved.sectionStride === this.#detail.sectionStride &&
      resolved.segmentFactor === this.#detail.segmentFactor &&
      resolved.leafStride === this.#detail.leafStride &&
      resolved.leafScale === this.#detail.leafScale &&
      resolved.billboard === this.#detail.billboard;
    if (unchanged) return this;

    const woodChanged =
      resolved.sectionStride !== this.#detail.sectionStride ||
      resolved.segmentFactor !== this.#detail.segmentFactor;
    this.#detail = resolved;
    if (woodChanged) this.#woodSnapshotKey = null;
    if (this.#snapshot) this.#applySnapshot(this.#snapshot);
    return this;
  }

  #enableLOD() {
    this.#lodController?.dispose();
    this.#lodController = new PlantLODController({
      target: this,
      detail: this.#detail,
      levels: DEFAULT_LOD_LEVELS,
      applyDetail: (detail) => this.#setDetail(detail),
    });
  }

  #rebuildWoodyGeometry(snapshot) {
    const plan = this.#planWoodySnapshot(snapshot, this.#detail);
    if (plan.signature === this.#woodSnapshotKey) return false;
    const meshed = this.#meshWoodyPlan(plan);
    const replacement = createBranchBufferGeometry(meshed.data);
    this.#resources.replaceGeometry(this.#woodMesh, replacement);
    this.#woodMesh.visible = meshed.data.indices.length > 0;
    this.#woodSnapshotKey = meshed.signature;
    return true;
  }

  #applySnapshot(snapshot) {
    this.#instancePool.beginFrame();
    this.#rebuildWoodyGeometry(snapshot);

    const phenology = snapshot.phenology;
    this.#setLeafMaterialPhenology(phenology);
    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;
    let visibleFlowerBuds = 0;
    let visibleFlowers = 0;
    let visibleBerries = 0;
    let visibleGreenBerries = 0;
    let visibleRipeBerries = 0;
    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      visibleCanes++;
      for (const axis of cane.axes) {
        const axisRuntime = this.#runtime.axes.get(axis.id);
        if (!axisRuntime) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes++;
        const axisGrowth = THREE.MathUtils.clamp(axis.growthScale, 0, 1);

        for (const node of axis.nodes) {
          for (const state of node.leaves) {
            const leafRuntime = this.#runtime.leaves.get(state.id);
            if (!leafRuntime) {
              throw new Error(
                `Missing render leaf for model organ ${state.id}.`,
              );
            }
            const biologicallyVisible = state.visible;
            const detailScale = stablePlantOrganDetailScale(
              this.seed,
              state.id,
              this.#detail.leafStride,
              this.#detail.leafScale,
              'blackcurrant-plant-detail-leaf-stride',
            );
            const visible = biologicallyVisible && detailScale > 0;
            if (visible) {
              this.#setLeaf(leafRuntime, state, node, detailScale);
            }
            this.#setBud(
              leafRuntime,
              node,
              !biologicallyVisible || phenology.leafProgress < 0.24,
            );
            if (visible) visibleLeaves++;
          }

          for (const state of node.racemes) {
            const racemeRuntime = this.#runtime.racemes.get(state.id);
            if (!racemeRuntime) {
              throw new Error(
                `Missing render raceme for model organ ${state.id}.`,
              );
            }
            this.#setRaceme(racemeRuntime, state, axisGrowth);
            const flowerVisibility = state.flowerVisibility;
            const flowerOpenVisibility = state.flowerOpenVisibility;
            const berryVisibility = state.berryVisibility;
            if (state.visible !== false && flowerVisibility > 0.015) {
              const count = state.berries.length;
              if (flowerOpenVisibility > 0.015) visibleFlowers += count;
              else visibleFlowerBuds += count;
            }
            if (state.visible !== false && berryVisibility > 0.015) {
              for (const berry of state.berries) {
                if (berry.harvested || berry.visible === false) continue;
                visibleBerries++;
                if (berry.ripe) {
                  visibleRipeBerries++;
                } else {
                  visibleGreenBerries++;
                }
              }
            }
          }
        }
      }
    }

    this.#instancePool.commitFrame();

    const woodyDrawCalls =
      this.#woodMesh.visible && this.#woodMesh.geometry.index?.count > 0
        ? 1
        : 0;

    this.#renderStats = {
      visibleCanes,
      visibleAxes,
      visibleLeaves,
      visibleFlowerBuds,
      visibleFlowers,
      visibleBerries,
      visibleGreenBerries,
      visibleRipeBerries,
      woodyDrawCalls,
      drawCalls:
        woodyDrawCalls +
        this.#instancePool.activeMeshes().filter((mesh) => mesh.count > 0)
          .length,
    };
  }

  #evaluate() {
    return evaluateTiselModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this.#events,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
  }

  setTime({ ageYears = this.ageYears, dayOfYear = this.dayOfYear } = {}) {
    return this.setState({ ageYears, dayOfYear });
  }

  setState({
    ageYears = this.ageYears,
    dayOfYear = this.dayOfYear,
    scenario = this.scenario,
    trialYear = this.trialYear,
    offsetDays = this.offsetDays,
  } = {}) {
    const previousAge = this.ageYears;
    const previousDay = this.dayOfYear;
    const previousScenario = this.scenario;
    const previousTrialYear = this.trialYear;
    const previousOffsetDays = this.offsetDays;
    this.ageYears = simulationYear(ageYears, this.ageYears, this.maxYears);
    this.dayOfYear = THREE.MathUtils.clamp(
      Math.floor(number(dayOfYear, this.dayOfYear)),
      1,
      365,
    );
    this.scenario = scenario;
    this.trialYear = trialYear;
    this.offsetDays = offsetDays;
    try {
      this.#snapshot = this.#evaluate();
    } catch (error) {
      this.ageYears = previousAge;
      this.dayOfYear = previousDay;
      this.scenario = previousScenario;
      this.trialYear = previousTrialYear;
      this.offsetDays = previousOffsetDays;
      throw error;
    }
    this.#applySnapshot(this.#snapshot);
    return this;
  }

  setScenario(scenario) {
    return this.setState({ scenario: scenario ?? 'maintained' });
  }

  setPhenologyProfile({
    trialYear = this.trialYear,
    offsetDays = this.offsetDays,
  } = {}) {
    return this.setState({ trialYear, offsetDays });
  }

  #normaliseEvent(event, index = 0) {
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
    const normalised = {
      ...event,
      id,
      ageYears,
      dayOfYear,
    };
    if (normalised.type === 'harvest') {
      return { ...normalised, ...createHarvestEvent(normalised) };
    }
    if (normalised.type === 'prune') {
      return { ...normalised, ...createPruneEvent(normalised) };
    }
    return normalised;
  }

  addEvent(event) {
    const normalised = this.#normaliseEvent(event, this.#events.length);
    if (this.#events.some((existing) => existing.id === normalised.id)) {
      throw new Error(`Duplicate care event id: ${normalised.id}`);
    }
    this.#events.push(normalised);
    try {
      this.#snapshot = this.#evaluate();
    } catch (error) {
      this.#events.pop();
      throw error;
    }
    this.#applySnapshot(this.#snapshot);
    return normalised;
  }

  pruneOldestCane(options = {}) {
    const targetAge = number(options.ageYears, this.ageYears);
    const targetDay = THREE.MathUtils.clamp(
      Math.floor(number(options.dayOfYear, this.dayOfYear)),
      1,
      365,
    );
    const minimumAge = TISEL_PROFILE.management.renewalPruningMinimumAgeYears;
    const reject = (reason) => ({
      event: null,
      applied: false,
      reason,
    });

    // Management actions must use the same selected trial/weather calendar as
    // the visible twin and its care hints. Mean-calendar gating would make the
    // UI recommend dormant pruning while the action itself rejects it.
    const targetSnapshot = evaluateTiselModel(this.#model, {
      ageYears: targetAge,
      dayOfYear: targetDay,
      events: this.#events,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
    const targetCalendar = targetSnapshot.phenology.calendar;
    const dormant =
      targetDay <= targetCalendar.dormantEnd ||
      targetDay > targetCalendar.leafFallEnd;

    if (!options.force && !dormant) {
      return reject('outside-dormant-pruning-window');
    }
    const cycleYears = TISEL_PROFILE.architecture.replacementCycleYears;
    const cycleAge = targetAge % cycleYears;
    if (!options.force && cycleAge < minimumAge) {
      return reject('plant-too-young-for-renewal-pruning');
    }

    // Candidate selection must use the requested event time, not whichever
    // year happens to be on screen. This keeps back-dated or scheduled care
    // events from targeting canes that do not yet exist (or no longer exist).
    const currentYear = Math.floor(targetAge);
    const sameYearPrunes = this.#events.filter(
      (event) =>
        event.type === 'prune' &&
        Math.floor(number(event.ageYears, event.year)) === currentYear,
    );
    const reservedCaneIds = new Set(
      sameYearPrunes.map((event) => event.caneId).filter(Boolean),
    );
    const activeCanes = targetSnapshot.canes.filter((cane) => !cane.removed);
    const unprunedYearEnd = evaluateTiselModel(this.#model, {
      ageYears: currentYear,
      dayOfYear: 365,
      events: this.#events.filter((event) => !sameYearPrunes.includes(event)),
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
    const startingCaneCount = unprunedYearEnd.canes.filter(
      (cane) => !cane.removed,
    ).length;
    const maintainedMinimum = TISEL_PROFILE.architecture.maintainedCaneRange[0];
    const annualLimit = Math.max(
      0,
      Math.min(
        Math.floor(
          startingCaneCount *
            TISEL_PROFILE.management.oldestCaneRemovalFraction,
        ),
        startingCaneCount - maintainedMinimum,
      ),
    );
    if (!options.force && activeCanes.length <= maintainedMinimum) {
      return reject('maintained-six-cane-minimum-reached');
    }
    if (
      !options.force &&
      startingCaneCount - (reservedCaneIds.size + 1) < maintainedMinimum
    ) {
      return reject('maintained-six-cane-minimum-reached');
    }
    if (!options.force && reservedCaneIds.size >= annualLimit) {
      return reject('annual-one-third-pruning-limit-reached');
    }

    const candidates = activeCanes
      .filter(
        (cane) =>
          !cane.removed &&
          !reservedCaneIds.has(cane.id) &&
          (options.force || number(cane.ageYears, 0) >= minimumAge),
      )
      .sort((a, b) => number(b.ageYears, 0) - number(a.ageYears, 0));
    const cane = options.caneId
      ? candidates.find((candidate) => candidate.id === options.caneId)
      : candidates[0];
    if (!cane) return reject('no-eligible-old-cane');

    const payload = {
      id: options.id ?? `prune:${cane.id}:${targetAge}:${targetDay}`,
      ageYears: targetAge,
      year: currentYear,
      dayOfYear: targetDay,
      caneId: cane.id,
      reason: options.reason ?? 'remove-oldest-cane',
    };
    const event = createPruneEvent(payload);
    return this.addEvent(event);
  }

  harvest(options = {}) {
    const before = this.stats();
    if (before.ripeBerries <= 0) {
      return {
        event: null,
        amountKg: 0,
        reason: 'no-ripe-fruit',
      };
    }
    const payload = {
      id:
        options.id ?? `harvest:${Math.floor(this.ageYears)}:${this.dayOfYear}`,
      ageYears: this.ageYears,
      year: Math.floor(this.ageYears),
      dayOfYear: this.dayOfYear,
      amountKg:
        options.amountKg === undefined
          ? before.estimatedYieldKg
          : options.amountKg,
      note: options.note,
    };
    const event = createHarvestEvent(payload);
    const added = this.addEvent(event);
    return { event: added, amountKg: payload.amountKg };
  }

  resetEvents() {
    this.#events.length = 0;
    this.#snapshot = this.#evaluate();
    this.#applySnapshot(this.#snapshot);
    return this;
  }

  update(deltaSeconds = 0, elapsedSeconds, camera) {
    this.#leafWind.advance(deltaSeconds, elapsedSeconds);
    if (camera && this.#lodController) this.#lodController.update(camera);
  }

  stats() {
    const source = this.#snapshot.stats;
    const harvestedYieldKg = this.#events
      .filter(
        (event) =>
          event.type === 'harvest' &&
          tiselEventTime(event) <=
            tiselEventTime({
              ageYears: this.ageYears,
              dayOfYear: this.dayOfYear,
            }),
      )
      .reduce((sum, event) => sum + number(event.amountKg, 0), 0);

    return {
      ...source,
      ...this.#renderStats,
      species: this.#snapshot.species,
      cultivar: this.cultivar,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      phenology: this.#snapshot.phenology,
      careHints: this.#snapshot.careHints,
      estimatedYieldKg: source.estimatedYieldKg,
      harvestedYieldKg,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Blackcurrant',
      plantId: this.#plantId,
      species: 'Ribes nigrum',
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
      events: this.#events.map((event) => ({ ...event })),
    };
  }

  dispose() {
    if (this.#resources.disposed) return;
    this.#lodController?.dispose({ restore: false });
    this.#lodController = null;
    this.#resources.dispose();
    this.clear();
  }
}

export default Blackcurrant;
