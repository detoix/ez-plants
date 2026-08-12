import * as THREE from 'three';
import { TISEL_PROFILE } from './tisel.js';
import { TISEL_CALENDAR } from './phenology.js';
import {
  createHarvestEvent,
  createPruneEvent,
  createTiselModel,
  evaluateTiselModel,
} from './model.js';
import {
  createBerryGeometry,
  createCalyxStarGeometry,
  createFlowerGeometry,
} from './geometry.js';
import { createLeafCardGeometry } from '../../leaf-geometry.js';
import { createLeafMaterialSet } from '../../leaf-material.js';
import { LeafWind } from '../../leaf-wind.js';
import { keyedRandom, keyedRange } from '../../keyed-random.js';
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
const WOOD_AGE_BANDS = Object.freeze(['young', 'mature', 'old']);
const WOOD_MATERIAL_KEYS = Object.freeze({
  young: 'caneYoung',
  mature: 'caneMature',
  old: 'caneOld',
});
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

function rangeMidpoint([minimum, maximum]) {
  return (minimum + maximum) / 2;
}

function eventTime(event) {
  if (Number.isFinite(event?.ageYears)) {
    return event.ageYears + (number(event.dayOfYear, 1) - 1) / 365;
  }
  if (Number.isFinite(event?.year)) {
    return event.year + (number(event.dayOfYear, 1) - 1) / 365;
  }
  return 0;
}

function woodAgeBand(axisAge) {
  if (axisAge < 1.2) return 'young';
  if (axisAge < 3.5) return 'mature';
  return 'old';
}

/**
 * A persistent, cultivar-specific blackcurrant renderer. Stable organ pools
 * are sized from annual concurrency in the 50-year graph; each changed growth
 * snapshot repacks active instances and three combined woody age-band meshes.
 */
export class Blackcurrant extends THREE.Group {
  /** Metre-scale detail bands for a garden shrub viewed in a browser scene. */
  static defaultLODLevels = Object.freeze([
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

  constructor(options = {}) {
    super();

    const suppliedModel = options.model;
    const requestedCultivar =
      options.cultivar ??
      suppliedModel?.cultivar ??
      TISEL_PROFILE.cultivar ??
      'Tisel';
    if (
      requestedCultivar !== TISEL_PROFILE.cultivar ||
      (suppliedModel?.cultivar != null &&
        suppliedModel.cultivar !== TISEL_PROFILE.cultivar)
    ) {
      throw new RangeError(
        `This renderer currently supports only the ${TISEL_PROFILE.cultivar} cultivar profile.`,
      );
    }
    this.cultivar = TISEL_PROFILE.cultivar;
    this.name = `Blackcurrant_${this.cultivar}`;
    this.seed = options.seed ?? suppliedModel?.seed ?? 20260811;
    this.maxYears = THREE.MathUtils.clamp(
      Math.floor(number(suppliedModel?.maxYears, number(options.maxYears, 50))),
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
    this.bark = options.bark ?? null;
    const leaf = options.leaf ?? {};
    this.leaf = {
      map: leaf.map ?? null,
      tint: leaf.tint ?? 0xffffff,
      alphaTest: leaf.alphaTest ?? 0.5,
      roundedNormals: leaf.roundedNormals ?? true,
    };
    this.model =
      suppliedModel ??
      createTiselModel({ seed: this.seed, maxYears: this.maxYears });
    if (
      this.model?.kind !== 'blackcurrant-growth-model' ||
      !Number.isInteger(this.model.maxYears) ||
      !Array.isArray(this.model.canes)
    ) {
      throw new TypeError('Expected a model returned by createTiselModel');
    }
    this.events = Array.isArray(options.events)
      ? options.events.map((event, index) => this._normaliseEvent(event, index))
      : [];
    if (
      new Set(this.events.map((event) => event.id)).size !== this.events.length
    ) {
      throw new Error('Initial care event ids must be unique.');
    }
    this._snapshot = null;
    this._renderStats = {};
    this._resources = new ResourceTracker();
    this.detail = Object.freeze(normalizePlantDetail(options.detail));
    this._woodSnapshotKey = null;
    this._woodRevision = 0;
    this._woodMeshPasses = 0;
    this.autoLOD = null;

    this._runtime = {
      maps: {
        canes: new Map(),
        axes: new Map(),
        leaves: new Map(),
        racemes: new Map(),
        berries: new Map(),
      },
    };
    Object.defineProperty(this.userData, 'sculptRuntime', {
      value: this._runtime,
      enumerable: false,
      configurable: true,
    });
    this.userData.species = 'Ribes nigrum';
    this.userData.cultivar = this.cultivar;
    this.userData.units = 'metres';

    this._leafWind = new LeafWind({
      // Instancing scales this leaf-local displacement into model metres.
      strength: new THREE.Vector3(0.085, 0, 0.085),
      frequency: 0.5,
      scale: 1.4,
    });

    this._createGroups();
    this._createMaterials();
    this._buildStableGraph();
    this._createWoodMeshes();
    this._createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
    if (options.autoLOD) {
      this.enableAutoLOD(
        Array.isArray(options.autoLOD)
          ? options.autoLOD
          : Blackcurrant.defaultLODLevels,
      );
    }
  }

  _createGroups() {
    this.crown = new THREE.Group();
    this.crown.name = 'Blackcurrant_Crown';

    this.woodyGroup = new THREE.Group();
    this.woodyGroup.name = 'Blackcurrant_WoodyArchitecture';
    this.leafGroup = new THREE.Group();
    this.leafGroup.name = 'Blackcurrant_Leaves';
    this.flowerGroup = new THREE.Group();
    this.flowerGroup.name = 'Blackcurrant_Inflorescences';
    this.fruitGroup = new THREE.Group();
    this.fruitGroup.name = 'Blackcurrant_Fruit';

    this.crown.add(
      this.woodyGroup,
      this.leafGroup,
      this.flowerGroup,
      this.fruitGroup,
    );
    this.add(this.crown);
  }

  _material(parameters) {
    return this._resources.trackMaterial(
      new THREE.MeshStandardMaterial(parameters),
    );
  }

  _barkMaterial(parameters) {
    return this._resources.trackMaterial(
      createBarkMaterial({
        textured: false,
        tint: 0x5b5247,
        ...this.bark,
        ...parameters,
      }),
    );
  }

  _createMaterials() {
    // The three geometry batches represent age/visibility, not three different
    // bark systems. They share the exact EZ-Tree bark material supplied by the
    // host (the demo passes TreePreset['Bush 1'].bark unchanged).
    const cane = this._barkMaterial();
    const leafMaterials = createLeafMaterialSet({
      name: 'Blackcurrant_Leaves',
      map: this.leaf.map,
      tint: this.leaf.tint,
      alphaTest: this.leaf.alphaTest,
      roundedNormals: this.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'blackcurrant-leaves',
    });
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();

    this.materials = {
      caneYoung: cane,
      caneMature: cane,
      caneOld: cane,
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      petiole: this._material({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0,
      }),
      bud: this._material({ color: 0x75464a, roughness: 0.9, metalness: 0 }),
      flowerBud: this._material({
        color: 0x9b7e75,
        roughness: 0.88,
        metalness: 0,
      }),
      flower: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.76,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
      fruit: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.68,
        metalness: 0,
      }),
      calyx: this._material({
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    };
  }

  _createWoodMeshes() {
    this.woodMeshes = {};
    for (const ageBand of WOOD_AGE_BANDS) {
      const geometry = this._geometry(
        createBranchBufferGeometry(createBranchGeometryData()),
      );
      const mesh = new THREE.Mesh(
        geometry,
        this.materials[WOOD_MATERIAL_KEYS[ageBand]],
      );
      mesh.name = `Blackcurrant_Wood_${ageBand}`;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.kind = 'woody-architecture-batch';
      mesh.userData.woodAgeBand = ageBand;
      mesh.userData.axisRanges = [];
      this.woodMeshes[ageBand] = mesh;
      this.woodyGroup.add(mesh);
    }
  }

  _buildStableGraph() {
    const canes = this.model.canes;
    const annualOrganCounts = new Map();
    const unknownYearCounts = emptyInstanceCounts();
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
    const leafLength = rangeMidpoint(TISEL_PROFILE.leaf.widthM);
    const petioleLength = rangeMidpoint(TISEL_PROFILE.leaf.petioleLengthM);
    const racemeLength = rangeMidpoint(TISEL_PROFILE.raceme.lengthM);
    const berryDiameter = rangeMidpoint(TISEL_PROFILE.berry.diameterM);

    this._organs = {
      leaves: [],
      petioles: [],
      buds: [],
      racemeAxes: [],
      pedicels: [],
      flowerBuds: [],
      flowers: [],
      berries: [],
      calyces: [],
    };

    for (const cane of canes) {
      const nodeAttachments = new Map();
      const caneRuntime = {
        id: cane.id,
        source: cane,
        birthAgeYears: number(cane.birthAgeYears, number(cane.birthYear, 0)),
        base: vector(cane.position),
        meshes: [],
        axes: [],
      };
      this._runtime.maps.canes.set(cane.id, caneRuntime);

      const axes = cane.axes;
      axes.forEach((axis, axisIndex) => {
        const points = axis.points.map((point) => vector(point));
        const axisNodes = axis.nodes ?? [];
        const root = points[0].clone();
        // Every woody axis owns its mature shape in local coordinates. The
        // evaluated snapshot supplies the moving root and growth scale, so a
        // young lateral extends from its parent instead of popping in at full
        // length or floating above a shortened main cane.
        const localPoints = points.map((point) => point.clone().sub(root));
        const isPrimary = axisIndex === 0 || !axis.parentId;
        const axisOrder = number(axis.order, isPrimary ? 0 : 1);
        const radiusFactors = TISEL_PROFILE.cane.axisRadiusFactors;
        const radiusFactor =
          axisOrder <= 0
            ? radiusFactors.primary
            : axisOrder === 1
              ? radiusFactors.lateral
              : radiusFactors.higherOrder;
        const nominalBaseRadius =
          number(cane.baseRadiusM, number(cane.baseRadius, 0.012)) *
          radiusFactor;
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
          ...axisNodes.map((node, nodeIndex) => ({
            position: THREE.MathUtils.clamp(
              (number(node.index, nodeIndex) + 1) /
                Math.max(1, points.length - 1),
              0,
              1,
            ),
            origin: vector(
              node.position,
              points[Math.min(points.length - 1, nodeIndex + 1)] ?? root,
            ).sub(root),
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
          source: axis,
          caneId: cane.id,
          points,
          root,
          isPrimary,
          sections,
          baseRadius,
          parentRadiusAtAttachment: parentSection?.radius ?? null,
          parentAxisId: parentAttachment?.axisRuntime.id ?? null,
          attachmentPosition: parentAttachment?.position ?? null,
          caps,
          radialSegments,
          landmarks,
          mesh: null,
          range: null,
        };
        caneRuntime.axes.push(axisRuntime);
        this._runtime.maps.axes.set(axis.id, axisRuntime);

        for (const [nodeIndex, node] of axisNodes.entries()) {
          nodeAttachments.set(node.id, {
            axisRuntime,
            position: THREE.MathUtils.clamp(
              (number(node.index, nodeIndex) + 1) /
                Math.max(1, points.length - 1),
              0,
              1,
            ),
          });
          const nodePosition = vector(
            node.position,
            points[Math.min(points.length - 1, nodeIndex + 1)] ?? root,
          );
          let tangent = vector(node.tangent, new THREE.Vector3(0, 1, 0));
          if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
          tangent.normalize();

          for (const [leafIndex, leaf] of (node.leaves ?? []).entries()) {
            const leafId = leaf.id ?? `${node.id}:leaf:${leafIndex}`;
            const angle = Number.isFinite(leaf.azimuth)
              ? leaf.azimuth
              : Number.isFinite(leaf.rotation)
                ? leaf.rotation
                : keyedRandom(this.seed, leafId, 'rotation') * Math.PI * 2;
            const generatedRadial = new THREE.Vector3(
              Math.cos(angle),
              0.18,
              Math.sin(angle),
            ).normalize();
            const lengthVariation = keyedRange(
              this.seed,
              [leafId, 'petiole'],
              0.82,
              1.13,
            );
            const start = nodePosition.clone();
            const generatedEnd = start
              .clone()
              .addScaledVector(
                generatedRadial,
                petioleLength * lengthVariation,
              );
            const end = vector(leaf.position, generatedEnd);
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
            const measuredLeafSize = Number.isFinite(leaf.lengthM)
              ? leaf.lengthM
              : Number.isFinite(leaf.widthM)
                ? leaf.widthM
                : number(leaf.scale, leafLength);
            const size = THREE.MathUtils.clamp(
              measuredLeafSize *
                keyedRange(this.seed, [leafId, 'size'], 0.94, 1.06),
              0.045,
              0.12,
            );
            const runtime = {
              id: leafId,
              caneId: cane.id,
              nodeId: node.id,
              source: leaf,
              start,
              end,
              position: end,
              quaternion,
              size,
            };
            this._organs.leaves.push(runtime);
            this._organs.petioles.push(runtime);
            this._organs.buds.push(runtime);
            addAnnualOrgans(leaf.year, {
              leaves: 1,
              petioles: 1,
              buds: 1,
            });
            this._runtime.maps.leaves.set(leafId, runtime);
          }

          for (const [racemeIndex, raceme] of (node.racemes ?? []).entries()) {
            const racemeId = raceme.id ?? `${node.id}:raceme:${racemeIndex}`;
            const angle =
              keyedRandom(this.seed, racemeId, 'azimuth') * Math.PI * 2;
            const outward = new THREE.Vector3(
              Math.cos(angle),
              0,
              Math.sin(angle),
            );
            const start = vector(
              raceme.position,
              nodePosition.clone().addScaledVector(outward, 0.008),
            );
            const direction = vector(
              raceme.direction,
              outward.clone().multiplyScalar(0.32).addScaledVector(UP, -1),
            ).normalize();
            const end = start
              .clone()
              .addScaledVector(direction, number(raceme.lengthM, racemeLength));
            const racemeRuntime = {
              id: racemeId,
              caneId: cane.id,
              nodeId: node.id,
              source: raceme,
              start,
              end,
              berries: [],
            };
            this._organs.racemeAxes.push(racemeRuntime);
            this._runtime.maps.racemes.set(racemeId, racemeRuntime);

            const berries = raceme.berries ?? [];
            addAnnualOrgans(raceme.fruitingYear, {
              racemeAxes: 1,
              pedicels: berries.length,
              flowerBuds: berries.length,
              flowers: berries.length,
              berries: berries.length,
              calyces: berries.length,
            });
            berries.forEach((berry, berryIndex) => {
              const berryId = berry.id ?? `${racemeId}:berry:${berryIndex}`;
              const t = (berryIndex + 1) / (berries.length + 1);
              const axisPoint = start.clone().lerp(end, t);
              const pedicelAngle = angle + berryIndex * 2.39996;
              const side = new THREE.Vector3(
                Math.cos(pedicelAngle),
                -0.25,
                Math.sin(pedicelAngle),
              ).normalize();
              const pedicelStart = axisPoint;
              const center = vector(
                berry.position,
                axisPoint
                  .clone()
                  .addScaledVector(
                    side,
                    keyedRange(this.seed, [berryId, 'pedicel'], 0.014, 0.022),
                  ),
              );
              const measuredBerryDiameter = Number.isFinite(berry.diameterM)
                ? berry.diameterM
                : number(berry.scale, berryDiameter);
              const diameter =
                measuredBerryDiameter *
                keyedRange(this.seed, [berryId, 'diameter'], 0.9, 1.1);
              const berryRuntime = {
                id: berryId,
                caneId: cane.id,
                racemeId,
                source: berry,
                start: pedicelStart,
                position: center,
                diameter,
              };
              racemeRuntime.berries.push(berryRuntime);
              this._organs.pedicels.push(berryRuntime);
              this._organs.flowerBuds.push(berryRuntime);
              this._organs.flowers.push(berryRuntime);
              this._organs.berries.push(berryRuntime);
              this._organs.calyces.push(berryRuntime);
              this._runtime.maps.berries.set(berryId, berryRuntime);
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
    this._instancePool = new PlantInstancePool({
      capacities: Object.fromEntries(
        INSTANCE_KINDS.map((kind) => {
          const historicalCount = this._organs[kind].length;
          const activeBound = maximumConcurrent[kind];
          const withHeadroom =
            activeBound === 0 ? 0 : Math.ceil(activeBound * 1.15) + 8;
          return [kind, Math.min(historicalCount, withHeadroom)];
        }),
      ),
    });
  }

  _geometry(geometry) {
    return this._resources.trackGeometry(geometry);
  }

  _createInstances() {
    const stemGeometry = this._geometry(createUnitStemGeometry(5));
    const berryGeometry = this._geometry(createBerryGeometry());
    const add = (kind, options) =>
      this._resources.trackInstancedMesh(this._instancePool.add(kind, options));

    add('leaves', {
      name: 'Blackcurrant_Leaves',
      geometry: this._geometry(
        createLeafCardGeometry({ roundedNormals: this.leaf.roundedNormals }),
      ),
      material: this.materials.leaf,
      organCount: this._organs.leaves.length,
      group: this.leafGroup,
    });
    add('petioles', {
      name: 'Blackcurrant_Petioles_RedGreen',
      geometry: stemGeometry,
      material: this.materials.petiole,
      organCount: this._organs.petioles.length,
      group: this.leafGroup,
    });
    add('buds', {
      name: 'Blackcurrant_DormantBuds',
      geometry: berryGeometry,
      material: this.materials.bud,
      organCount: this._organs.buds.length,
      group: this.woodyGroup,
    });
    add('racemeAxes', {
      name: 'Blackcurrant_RacemeAxes_RedGreen',
      geometry: stemGeometry,
      material: this.materials.petiole,
      organCount: this._organs.racemeAxes.length,
      group: this.flowerGroup,
    });
    add('pedicels', {
      name: 'Blackcurrant_Pedicels_RedGreen',
      geometry: stemGeometry,
      material: this.materials.petiole,
      organCount: this._organs.pedicels.length,
      group: this.flowerGroup,
    });
    add('flowerBuds', {
      name: 'Blackcurrant_InflorescenceBuds',
      geometry: berryGeometry,
      material: this.materials.flowerBud,
      organCount: this._organs.flowerBuds.length,
      group: this.flowerGroup,
    });
    add('flowers', {
      name: 'Blackcurrant_Flowers_GreenMauve',
      geometry: this._geometry(createFlowerGeometry()),
      material: this.materials.flower,
      organCount: this._organs.flowers.length,
      group: this.flowerGroup,
    });
    add('berries', {
      name: 'Blackcurrant_Berries',
      geometry: berryGeometry,
      material: this.materials.fruit,
      organCount: this._organs.berries.length,
      group: this.fruitGroup,
    });
    add('calyces', {
      name: 'Blackcurrant_RetainedCalyxStars',
      geometry: this._geometry(createCalyxStarGeometry()),
      material: this.materials.calyx,
      organCount: this._organs.calyces.length,
      group: this.fruitGroup,
    });
    this.instances = this._instancePool.meshes;

    this.instances.leaves.customDepthMaterial = this.materials.leafDepth;
    this.instances.leaves.customDistanceMaterial = this.materials.leafDistance;
  }

  _setLeaf(leafRuntime, leafState, nodeState, phenology, detailScale = 1) {
    const leafVisible =
      leafState.visible !== false && number(phenology.leafOpacity, 1) > 0.025;
    const leafProgress = THREE.MathUtils.clamp(
      number(phenology.leafProgress, 1),
      0,
      1,
    );
    const unfoldProgress = THREE.MathUtils.clamp(
      number(leafState.unfoldProgress, 1),
      0,
      1,
    );

    if (!leafVisible) return;

    const mesh = this.instances.leaves;
    const index = this._instancePool.allocate('leaves');
    const petioleStart = vector(nodeState?.position, leafRuntime.start);
    const position = petioleStart
      .clone()
      .lerp(vector(leafState.position, leafRuntime.position), unfoldProgress);
    const radial = position.clone().sub(petioleStart);
    const tangent = vector(nodeState?.tangent, new THREE.Vector3(0, 1, 0));
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
    const seasonalScale = leafProgress * unfoldProgress;
    const scale = leafRuntime.size * seasonalScale * detailScale;
    const matrix = new THREE.Matrix4().compose(
      position,
      leafQuaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    mesh.setMatrixAt(index, matrix);

    const petioleIndex = this._instancePool.allocate('petioles');
    const petioleDummy = new THREE.Object3D();
    composeSegmentMatrix(petioleDummy, petioleStart, position, 0.0013);
    this.instances.petioles.setMatrixAt(petioleIndex, petioleDummy.matrix);
    this.instances.petioles.setColorAt(
      petioleIndex,
      PETIOLE_GREEN.clone().lerp(
        PETIOLE_RED,
        keyedRange(this.seed, [leafRuntime.id, 'petiole-red'], 0.35, 0.8),
      ),
    );
    leafRuntime.currentQuaternion = leafQuaternion;
  }

  _setLeafMaterialPhenology(phenology) {
    const leafProgress = THREE.MathUtils.clamp(
      number(phenology.leafProgress, 1),
      0,
      1,
    );
    const autumnProgress = THREE.MathUtils.clamp(
      number(phenology.autumnProgress, 0),
      0,
      1,
    );
    const springMix = THREE.MathUtils.smoothstep(leafProgress, 0.15, 0.85);
    this._leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, springMix)
      .lerp(AUTUMN_LEAF_TINT, autumnProgress);
    this.materials.leaf.color
      .copy(this._leafBaseColor)
      .multiply(this._leafSeasonTint);
  }

  _setBud(leafRuntime, nodeState, visible) {
    if (!visible) return;
    const index = this._instancePool.allocate('buds');
    const position = vector(nodeState?.position, leafRuntime.start);
    const quaternion = leafRuntime.currentQuaternion ?? leafRuntime.quaternion;
    const scale = new THREE.Vector3(0.007, 0.012, 0.007);
    this.instances.buds.setMatrixAt(
      index,
      new THREE.Matrix4().compose(position, quaternion, scale),
    );
  }

  _berryColor(progress, id) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const color =
      p < 0.58
        ? GREEN_BERRY.clone().lerp(TURNING_BERRY, p / 0.58)
        : TURNING_BERRY.clone().lerp(RIPE_BERRY, (p - 0.58) / 0.42);
    return color.multiplyScalar(
      keyedRange(this.seed, [id, 'fruit-color'], 0.82, 1.1),
    );
  }

  _setRaceme(racemeRuntime, racemeState, phenology, axisGrowth = 1) {
    const flowerProgress = THREE.MathUtils.clamp(
      number(racemeState.flowerProgress, number(phenology.flowerProgress, 0)),
      0,
      1,
    );
    const fruitProgress = THREE.MathUtils.clamp(
      number(racemeState.fruitProgress, number(phenology.fruitProgress, 0)),
      0,
      1,
    );
    const flowerVisibility = THREE.MathUtils.clamp(
      number(
        racemeState.flowerVisibility,
        number(phenology.flowerVisibility, 0),
      ),
      0,
      1,
    );
    const flowerOpenVisibility = THREE.MathUtils.clamp(
      number(
        racemeState.flowerOpenVisibility,
        number(phenology.flowerOpenVisibility, 0),
      ),
      0,
      1,
    );
    const berryVisibility = THREE.MathUtils.clamp(
      number(racemeState.berryVisibility, number(phenology.berryVisibility, 0)),
      0,
      1,
    );
    const colorProgress = THREE.MathUtils.clamp(
      number(
        racemeState.fruitColorProgress,
        number(phenology.fruitColorProgress, 0),
      ),
      0,
      1,
    );
    const showFlowers =
      racemeState.visible !== false && flowerVisibility > 0.015;
    const showFruit = racemeState.visible !== false && berryVisibility > 0.015;
    if (!showFlowers && !showFruit) return;

    const start = vector(racemeState.position, racemeRuntime.start);
    const direction = vector(
      racemeState.direction,
      racemeRuntime.end.clone().sub(racemeRuntime.start),
    );
    if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
    direction.normalize();
    const length =
      number(
        racemeState.lengthM,
        racemeRuntime.end.distanceTo(racemeRuntime.start),
      ) * axisGrowth;
    const end = start.clone().addScaledVector(direction, length);
    const racemeIndex = this._instancePool.allocate('racemeAxes');
    const axisDummy = new THREE.Object3D();
    composeSegmentMatrix(axisDummy, start, end, 0.00075);
    this.instances.racemeAxes.setMatrixAt(racemeIndex, axisDummy.matrix);
    this.instances.racemeAxes.setColorAt(
      racemeIndex,
      PETIOLE_GREEN.clone().lerp(PETIOLE_RED, 0.58),
    );

    const stateById = new Map(
      (racemeState.berries ?? []).map((berry) => [berry.id, berry]),
    );
    for (const [berryIndex, berryRuntime] of racemeRuntime.berries.entries()) {
      const berryState = stateById.get(berryRuntime.id) ?? berryRuntime.source;
      const t = (berryIndex + 1) / (racemeRuntime.berries.length + 1);
      const pedicelStart = start.clone().lerp(end, t);
      const berryPosition = vector(berryState.position, berryRuntime.position);
      const pedicelIndex = this._instancePool.allocate('pedicels');
      const pedicelDummy = new THREE.Object3D();
      composeSegmentMatrix(pedicelDummy, pedicelStart, berryPosition, 0.00045);
      this.instances.pedicels.setMatrixAt(pedicelIndex, pedicelDummy.matrix);
      this.instances.pedicels.setColorAt(
        pedicelIndex,
        PETIOLE_GREEN.clone().lerp(PETIOLE_RED, 0.48),
      );

      if (showFlowers) {
        const flowerQuaternion = makeBasisQuaternion(
          berryPosition.clone().sub(pedicelStart).normalize().negate(),
          new THREE.Vector3(0, 0, 1),
        );
        if (flowerOpenVisibility > 0.015) {
          const flowerIndex = this._instancePool.allocate('flowers');
          const flowerScale =
            0.0125 *
            THREE.MathUtils.lerp(0.45, 1, flowerProgress) *
            Math.sqrt(flowerOpenVisibility);
          this.instances.flowers.setMatrixAt(
            flowerIndex,
            new THREE.Matrix4().compose(
              berryPosition,
              flowerQuaternion,
              new THREE.Vector3(flowerScale, flowerScale, flowerScale),
            ),
          );
        } else {
          const budIndex = this._instancePool.allocate('flowerBuds');
          const budScale = 0.0055 * Math.sqrt(flowerVisibility);
          this.instances.flowerBuds.setMatrixAt(
            budIndex,
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
        const activeBerryIndex = this._instancePool.allocate('berries');
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
        this.instances.berries.setMatrixAt(
          activeBerryIndex,
          new THREE.Matrix4().compose(
            berryPosition,
            berryQuaternion,
            new THREE.Vector3(diameter, diameter, diameter),
          ),
        );
        this.instances.berries.setColorAt(
          activeBerryIndex,
          this._berryColor(
            number(berryState.colourProgress, colorProgress),
            berryRuntime.id,
          ),
        );

        const distalDirection = berryPosition
          .clone()
          .sub(pedicelStart)
          .normalize();
        const calyxPosition = berryPosition
          .clone()
          .addScaledVector(distalDirection, diameter * 0.51);
        const calyxScale = diameter * 0.38;
        const calyxIndex = this._instancePool.allocate('calyces');
        this.instances.calyces.setMatrixAt(
          calyxIndex,
          new THREE.Matrix4().compose(
            calyxPosition,
            new THREE.Quaternion().setFromUnitVectors(UP, distalDirection),
            new THREE.Vector3(calyxScale, calyxScale, calyxScale),
          ),
        );
        this.instances.calyces.setColorAt(
          calyxIndex,
          CALYX_GREEN.clone().lerp(CALYX_BROWN, colorProgress),
        );
      }
    }
  }

  /** Build the cheap, geometry-free state plan and cache signature. */
  _planWoodySnapshot(snapshot, detail = this.detail) {
    if (!snapshot || !Array.isArray(snapshot.canes)) {
      throw new TypeError('A Blackcurrant snapshot is required.');
    }

    const resolved = normalizePlantDetail(detail, this.detail);
    const states = new Map();
    const snapshotNow =
      number(snapshot.ageYears, this.ageYears) +
      (number(snapshot.dayOfYear, this.dayOfYear) - 1) / 365;

    for (const cane of snapshot.canes) {
      if (cane.removed) continue;
      const caneRuntime = this._runtime.maps.canes.get(cane.id);
      if (!caneRuntime) continue;
      const caneAge = number(
        cane.ageYears,
        number(snapshot.ageYears, this.ageYears) - caneRuntime.birthAgeYears,
      );
      const caneGrowth = THREE.MathUtils.clamp(
        number(cane.growthScale, 0.42 + caneAge * 0.52),
        0.12,
        1,
      );

      for (const axis of cane.axes ?? []) {
        const runtime = this._runtime.maps.axes.get(axis.id);
        if (!runtime) continue;
        const growth = THREE.MathUtils.clamp(
          number(axis.growthScale, runtime.isPrimary ? caneGrowth : 1),
          0,
          1,
        );
        const axisAge = Math.max(
          0,
          snapshotNow - number(axis.birthAgeYears, caneRuntime.birthAgeYears),
        );
        states.set(axis.id, {
          axis,
          cane,
          caneRuntime,
          runtime,
          root: vector(axis.root ?? axis.points?.[0], runtime.root),
          growth,
          ageBand: woodAgeBand(axisAge),
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
      const { axis, root, growth, radiusScale, ageBand } = state;
      signatureAxes.push([
        axis.id,
        ageBand,
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
   * Pack one planned snapshot into one EZ-Tree branch buffer per bark age
   * band. This is the only CPU-heavy woody meshing pass.
   */
  _meshWoodyPlan(plan, { countPass = false } = {}) {
    if (countPass) this._woodMeshPasses++;
    const { states, detail: resolved } = plan;
    const batches = Object.fromEntries(
      WOOD_AGE_BANDS.map((ageBand) => [
        ageBand,
        { data: createBranchGeometryData(), ranges: [] },
      ]),
    );

    for (const state of states.values()) {
      const { axis, cane, runtime, root, growth, radiusScale, ageBand } = state;
      const batch = batches[ageBand];
      const radialSegments = Math.max(
        3,
        Math.round(runtime.radialSegments * resolved.segmentFactor),
      );
      const zeroGrowth = growth <= 1e-9 || radiusScale <= 1e-9;
      let sections = [];
      let sectionPositions = [];
      let appended = {
        vertexOffset: batch.data.verts.length / 3,
        vertexCount: 0,
        indexOffset: batch.data.indices.length,
        indexCount: 0,
      };

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
        sections = sampled.sections;
        sectionPositions = sampled.positions;
        appended = appendBranchTube(batch.data, sections, {
          radialSegments,
          caps: runtime.caps,
        });
      }

      const base = zeroGrowth ? root : sections[0].origin;
      const tip = zeroGrowth ? root : sections.at(-1).origin;
      const rangeLandmarks = runtime.landmarks.map((landmark) => {
        const sectionIndex = zeroGrowth
          ? null
          : sectionPositions.findIndex(
              (position) => Math.abs(position - landmark.position) < 1e-10,
            );
        return {
          organId: landmark.organId,
          kind: landmark.kind,
          position: landmark.position,
          sectionIndex,
          origin: zeroGrowth
            ? root.toArray()
            : sections[sectionIndex].origin.toArray(),
        };
      });
      const range = {
        axisId: axis.id,
        caneId: cane.id,
        parentId: axis.parentId ?? cane.id,
        kind: runtime.isPrimary ? 'cane' : 'shoot-axis',
        ageBand,
        vertexOffset: appended.vertexOffset,
        vertexCount: appended.vertexCount,
        indexOffset: appended.indexOffset,
        indexCount: appended.indexCount,
        base: base.toArray(),
        tip: tip.toArray(),
        baseRadius: zeroGrowth ? 0 : sections[0].radius,
        tipRadius: zeroGrowth ? 0 : sections.at(-1).radius,
        parentRadiusAtAttachment: state.parentRadiusAtAttachment,
        growthScale: growth,
        radiusScale,
        zeroGrowth,
        caps: runtime.caps,
        radialSegments,
        sectionCount: sections.length,
        sectionPositions,
        landmarks: rangeLandmarks,
        sourceSectionCount: runtime.sections.length,
      };
      batch.ranges.push(range);
    }

    return {
      batches,
      detail: resolved,
      signature: plan.signature,
    };
  }

  /** Plan and mesh a snapshot without mutating the live renderer. */
  _meshWoodySnapshot(snapshot, detail = this.detail) {
    return this._meshWoodyPlan(this._planWoodySnapshot(snapshot, detail));
  }

  _createWoodBatchGeometry(ageBand, batch, detail) {
    const geometry = createBranchBufferGeometry(batch.data);
    geometry.userData.woodAgeBand = ageBand;
    geometry.userData.plantDetail = {
      sectionStride: detail.sectionStride,
      segmentFactor: detail.segmentFactor,
    };
    geometry.userData.axisRanges = batch.ranges;
    return geometry;
  }

  /**
   * Create caller-owned current-snapshot woody geometries without mutating the
   * live renderer or consuming keyed randomness.
   */
  createGeometry(detail = this.detail) {
    const meshed = this._meshWoodySnapshot(this._snapshot, detail);
    const geometries = {};
    try {
      for (const ageBand of WOOD_AGE_BANDS) {
        geometries[ageBand] = this._createWoodBatchGeometry(
          ageBand,
          meshed.batches[ageBand],
          meshed.detail,
        );
      }
      return geometries;
    } catch (error) {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      throw error;
    }
  }

  /** Repack the live wood meshes at a new shared PlantDetail level. */
  setDetail(detail = {}) {
    const resolved = Object.freeze(normalizePlantDetail(detail, this.detail));
    const unchanged =
      resolved.sectionStride === this.detail.sectionStride &&
      resolved.segmentFactor === this.detail.segmentFactor &&
      resolved.leafStride === this.detail.leafStride &&
      resolved.leafScale === this.detail.leafScale &&
      resolved.billboard === this.detail.billboard;
    if (unchanged) return this;

    const woodChanged =
      resolved.sectionStride !== this.detail.sectionStride ||
      resolved.segmentFactor !== this.detail.segmentFactor;
    this.detail = resolved;
    if (woodChanged) this._woodSnapshotKey = null;
    if (this._snapshot) this._applySnapshot(this._snapshot);
    return this;
  }

  /** Enable lazy camera-distance detail switching without duplicating organs. */
  enableAutoLOD(levels = Blackcurrant.defaultLODLevels) {
    this.disableAutoLOD();
    this.autoLOD = new PlantLODController(this, levels);
    return this;
  }

  /** Apply the active automatic detail level for a camera. */
  updateLOD(camera) {
    return this.autoLOD?.update(camera) ?? false;
  }

  /** Stop automatic switching and restore the detail active before enabling. */
  disableAutoLOD() {
    this.autoLOD?.dispose();
    this.autoLOD = null;
    return this;
  }

  _rebuildWoodyGeometry(snapshot) {
    const plan = this._planWoodySnapshot(snapshot, this.detail);
    if (plan.signature === this._woodSnapshotKey) return false;
    const meshed = this._meshWoodyPlan(plan, { countPass: true });
    const replacements = {};

    try {
      for (const ageBand of WOOD_AGE_BANDS) {
        replacements[ageBand] = this._createWoodBatchGeometry(
          ageBand,
          meshed.batches[ageBand],
          meshed.detail,
        );
      }
    } catch (error) {
      for (const geometry of Object.values(replacements)) geometry.dispose();
      throw error;
    }

    for (const runtime of this._runtime.maps.axes.values()) {
      runtime.mesh = null;
      runtime.range = null;
    }
    for (const runtime of this._runtime.maps.canes.values()) {
      runtime.meshes.length = 0;
    }

    for (const ageBand of WOOD_AGE_BANDS) {
      const batch = meshed.batches[ageBand];
      const mesh = this.woodMeshes[ageBand];
      this._resources.replaceGeometry(mesh, replacements[ageBand]);
      mesh.visible = batch.data.indices.length > 0;
      mesh.userData.axisRanges = batch.ranges;

      for (const range of batch.ranges) {
        const axisRuntime = this._runtime.maps.axes.get(range.axisId);
        const caneRuntime = this._runtime.maps.canes.get(range.caneId);
        if (!axisRuntime || !caneRuntime) continue;
        axisRuntime.mesh = mesh;
        axisRuntime.range = range;
        if (!caneRuntime.meshes.includes(mesh)) caneRuntime.meshes.push(mesh);
      }
    }

    this._woodSnapshotKey = meshed.signature;
    this._woodRevision++;
    return true;
  }

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this._rebuildWoodyGeometry(snapshot);

    const phenology = snapshot.phenology ?? {};
    this._setLeafMaterialPhenology(phenology);
    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;
    let visibleFlowerBuds = 0;
    let visibleFlowers = 0;
    let visibleBerries = 0;
    let visibleGreenBerries = 0;
    let visibleRipeBerries = 0;
    this._activeLeafIds = [];
    for (const cane of snapshot.canes ?? []) {
      const caneRuntime = this._runtime.maps.canes.get(cane.id);
      if (!caneRuntime || cane.removed) continue;
      visibleCanes++;
      const caneAge = number(
        cane.ageYears,
        this.ageYears - caneRuntime.birthAgeYears,
      );
      const growth = THREE.MathUtils.clamp(
        number(cane.growthScale, 0.42 + caneAge * 0.52),
        0.12,
        1,
      );
      for (const axis of cane.axes ?? []) {
        const axisRuntime = this._runtime.maps.axes.get(axis.id);
        if (!axisRuntime) continue;
        visibleAxes++;
        const axisGrowth = THREE.MathUtils.clamp(
          number(axis.growthScale, axisRuntime.isPrimary ? growth : 1),
          0,
          1,
        );

        for (const node of axis.nodes ?? []) {
          for (const state of node.leaves ?? []) {
            const leafRuntime = this._runtime.maps.leaves.get(state.id);
            if (!leafRuntime) continue;
            const biologicallyVisible =
              state.visible !== false &&
              number(phenology.leafOpacity, 1) > 0.025;
            const detailScale = stablePlantOrganDetailScale(
              this.seed,
              state.id,
              this.detail.leafStride,
              this.detail.leafScale,
              'blackcurrant-plant-detail-leaf-stride',
            );
            const visible = biologicallyVisible && detailScale > 0;
            if (visible) {
              this._setLeaf(leafRuntime, state, node, phenology, detailScale);
              this._activeLeafIds.push(state.id);
            }
            this._setBud(
              leafRuntime,
              node,
              !biologicallyVisible || number(phenology.leafProgress, 1) < 0.24,
            );
            if (visible) visibleLeaves++;
          }

          for (const state of node.racemes ?? []) {
            const racemeRuntime = this._runtime.maps.racemes.get(state.id);
            if (!racemeRuntime) continue;
            this._setRaceme(racemeRuntime, state, phenology, axisGrowth);
            const flowerVisibility = number(
              state.flowerVisibility,
              number(phenology.flowerVisibility, 0),
            );
            const flowerOpenVisibility = number(
              state.flowerOpenVisibility,
              number(phenology.flowerOpenVisibility, 0),
            );
            const berryVisibility = number(
              state.berryVisibility,
              number(phenology.berryVisibility, 0),
            );
            if (state.visible !== false && flowerVisibility > 0.015) {
              const count =
                state.berries?.length ?? racemeRuntime.berries.length;
              if (flowerOpenVisibility > 0.015) visibleFlowers += count;
              else visibleFlowerBuds += count;
            }
            if (state.visible !== false && berryVisibility > 0.015) {
              const berryStates =
                state.berries ??
                racemeRuntime.berries.map((berry) => berry.source);
              for (const berry of berryStates) {
                if (berry.harvested || berry.visible === false) continue;
                visibleBerries++;
                const isRipe =
                  berry.ripe === true ||
                  (berry.ripe == null &&
                    number(phenology.dayOfYear, 0) >=
                      number(
                        phenology.calendar?.harvestStart,
                        TISEL_CALENDAR.harvestStart,
                      ));
                if (isRipe) {
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

    this._instancePool.commitFrame();

    const woodyDrawCalls = Object.values(this.woodMeshes).filter(
      (mesh) => mesh.visible && mesh.geometry.index?.count > 0,
    ).length;

    this._renderStats = {
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
        Object.values(this.instances).filter((mesh) => mesh.count > 0).length,
    };
  }

  _evaluate() {
    return evaluateTiselModel(this.model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this.events,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
  }

  setTime({ ageYears = this.ageYears, dayOfYear = this.dayOfYear } = {}) {
    const previousAge = this.ageYears;
    const previousDay = this.dayOfYear;
    this.ageYears = simulationYear(ageYears, this.ageYears, this.maxYears);
    this.dayOfYear = THREE.MathUtils.clamp(
      Math.floor(number(dayOfYear, this.dayOfYear)),
      1,
      365,
    );
    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      this.ageYears = previousAge;
      this.dayOfYear = previousDay;
      throw error;
    }
    this._applySnapshot(this._snapshot);
    return this;
  }

  setScenario(scenario) {
    const previous = this.scenario;
    this.scenario = scenario ?? 'maintained';
    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      this.scenario = previous;
      throw error;
    }
    this._applySnapshot(this._snapshot);
    return this;
  }

  setPhenologyProfile({
    trialYear = this.trialYear,
    offsetDays = this.offsetDays,
  } = {}) {
    const previousTrialYear = this.trialYear;
    const previousOffsetDays = this.offsetDays;
    this.trialYear = trialYear;
    this.offsetDays = offsetDays;
    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      this.trialYear = previousTrialYear;
      this.offsetDays = previousOffsetDays;
      throw error;
    }
    this._applySnapshot(this._snapshot);
    return this;
  }

  _normaliseEvent(event, index = 0) {
    if (!event || typeof event !== 'object') {
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
    const normalised = this._normaliseEvent(event, this.events.length);
    if (this.events.some((existing) => existing.id === normalised.id)) {
      throw new Error(`Duplicate care event id: ${normalised.id}`);
    }
    this.events.push(normalised);
    try {
      this._snapshot = this._evaluate();
    } catch (error) {
      this.events.pop();
      throw error;
    }
    this._applySnapshot(this._snapshot);
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
    const targetSnapshot = evaluateTiselModel(this.model, {
      ageYears: targetAge,
      dayOfYear: targetDay,
      events: this.events,
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
    const sameYearPrunes = this.events.filter(
      (event) =>
        event?.type === 'prune' &&
        Math.floor(number(event.ageYears, event.year)) === currentYear,
    );
    const reservedCaneIds = new Set(
      sameYearPrunes.map((event) => event.caneId).filter(Boolean),
    );
    const activeCanes = [...(targetSnapshot.canes ?? [])].filter(
      (cane) => !cane.removed,
    );
    const unprunedYearEnd = evaluateTiselModel(this.model, {
      ageYears: currentYear,
      dayOfYear: 365,
      events: this.events.filter((event) => !sameYearPrunes.includes(event)),
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
    const startingCaneCount = [...(unprunedYearEnd.canes ?? [])].filter(
      (cane) => !cane.removed,
    ).length;
    const maintainedMinimum =
      TISEL_PROFILE.architecture.maintainedCaneRange?.[0] ?? 6;
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
    if (number(before.visibleRipeBerries, 0) <= 0) {
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
    this.events.length = 0;
    this._snapshot = this._evaluate();
    this._applySnapshot(this._snapshot);
    return this;
  }

  update(deltaSeconds = 0, elapsedSeconds, camera) {
    this._leafWind.advance(deltaSeconds, elapsedSeconds);
    if (camera && this.autoLOD) this.autoLOD.update(camera);
  }

  stats() {
    const source = this._snapshot?.stats ?? {};
    const berryMassG = rangeMidpoint(TISEL_PROFILE.berry.massG);
    const estimatedYieldKg = number(
      source.estimatedYieldKg ?? source.yieldKg,
      (this._renderStats.visibleBerries * berryMassG) / 1000,
    );
    const harvestedYieldKg = this.events
      .filter(
        (event) =>
          event.type === 'harvest' && eventTime(event) <= eventTime(this),
      )
      .reduce((sum, event) => sum + number(event.amountKg, 0), 0);

    return {
      ...source,
      ...this._renderStats,
      species: this._snapshot?.species ?? 'Ribes nigrum',
      cultivar: this.cultivar,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      phenology: this._snapshot?.phenology,
      careHints: this._snapshot?.careHints ?? [],
      estimatedYieldKg,
      harvestedYieldKg,
    };
  }

  serialize() {
    return {
      type: 'Blackcurrant',
      species: 'Ribes nigrum',
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  dispose() {
    if (this._resources.disposed) return;
    this.autoLOD?.dispose({ restore: false });
    this.autoLOD = null;
    this._resources.dispose();
    this.clear();
  }
}

export default Blackcurrant;
