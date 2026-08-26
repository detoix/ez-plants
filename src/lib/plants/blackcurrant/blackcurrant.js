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
import { keyedRange } from '../../keyed-random.js';
import {
  composeSegmentMatrix,
  createUnitStemGeometry,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import { PlantRenderer } from '../../plant-renderer.js';

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

/**
 * A persistent, cultivar-specific blackcurrant renderer. Stable organ pools
 * are sized from annual concurrency in the 50-year graph; each changed growth
 * snapshot repacks active instances and one combined EZ-Tree woody mesh.
 *
 * The currant's own contribution is the fruiting habit: alternate leaves on
 * long renewal canes, pendent racemes that carry a flower and then a berry at
 * every pedicel, and a retained calyx star on each ripening fruit. Everything
 * else -- stable organ pools, the combined EZ-Tree woody mesh, distance LOD
 * and the validated state cycle -- comes from PlantRenderer.
 */

export class Blackcurrant extends PlantRenderer {
  #model;

  constructor(options = {}) {
    const requestedCultivar = options.cultivar ?? TISEL_PROFILE.cultivar;
    if (requestedCultivar !== TISEL_PROFILE.cultivar) {
      throw new RangeError(
        `This renderer currently supports only the ${TISEL_PROFILE.cultivar} cultivar profile.`,
      );
    }

    super({
      profile: TISEL_PROFILE,
      organKinds: INSTANCE_KINDS,
      namePrefix: 'Blackcurrant',
      detailStrideSalt: 'blackcurrant-plant-detail-leaf-stride',
      plantId: options.plantId,
      seed: options.seed ?? 20260811,
      maxYears: PlantRenderer.number(options.maxYears, 50),
      ageYears: options.ageYears ?? 4,
      dayOfYear: PlantRenderer.number(options.dayOfYear, 190),
      assets: options.assets ?? {},
      events: options.events,
      extraStateKeys: ['scenario', 'trialYear', 'offsetDays'],
      lodLevels: DEFAULT_LOD_LEVELS,
    });

    this.scenario = options.scenario ?? 'maintained';
    this.trialYear = options.trialYear ?? 'mean';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createTiselModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });

    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();
    this._runtime.racemes = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.cane);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
    if (options.lod) this._enableLOD();
  }

  #createMaterials() {
    const cane = this._barkMaterial();
    const leafMaterials = createLeafMaterialSet({
      name: 'Blackcurrant_Leaves',
      map: this._assets.leaf.map,
      tint: this._assets.leaf.tint,
      alphaTest: this._assets.leaf.alphaTest,
      roundedNormals: this._assets.leaf.roundedNormals,
      wind: this._leafWind,
      windVariant: 'blackcurrant-leaves',
    });
    this._resources.trackMaterial(leafMaterials.surface);
    this._resources.trackMaterial(leafMaterials.depth);
    this._resources.trackMaterial(leafMaterials.distance);
    this._protect('_leafBaseColor', '_leafSeasonTint');
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();

    this._materials = {
      cane,
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

  #buildStableGraph() {
    const canes = this.#model.canes;
    const annualOrganCounts = new Map();
    const unknownYearCounts = this._emptyInstanceCounts();
    const historicalCounts = this._emptyInstanceCounts();
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
          counts = this._emptyInstanceCounts();
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

      cane.axes.forEach((axis, axisIndex) => {
        this._buildAxisRuntime({ cane, axis, axisIndex, nodeAttachments });

        for (const node of axis.nodes) {
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
            this._runtime.leaves.set(leafId, runtime);
          }

          for (const raceme of node.racemes) {
            const racemeId = raceme.id;
            const racemeRuntime = {
              id: racemeId,
              berries: [],
            };
            addHistoricalOrgans({ racemeAxes: 1 });
            this._runtime.racemes.set(racemeId, racemeRuntime);

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

    this._sizeInstancePool({
      historicalCounts,
      annualOrganCounts,
      unknownYearCounts,
    });
  }

  #createInstances() {
    const stemGeometry = this._geometry(createUnitStemGeometry(5));
    const berryGeometry = this._geometry(createBerryGeometry());

    this._addInstancedOrgan('leaves', {
      name: 'Blackcurrant_Leaves',
      geometry: this._geometry(
        createLeafCardGeometry({
          roundedNormals: this._assets.leaf.roundedNormals,
        }),
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('petioles', {
      name: 'Blackcurrant_Petioles_RedGreen',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('buds', {
      name: 'Blackcurrant_DormantBuds',
      geometry: berryGeometry,
      material: this._materials.bud,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('racemeAxes', {
      name: 'Blackcurrant_RacemeAxes_RedGreen',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('pedicels', {
      name: 'Blackcurrant_Pedicels_RedGreen',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('flowerBuds', {
      name: 'Blackcurrant_InflorescenceBuds',
      geometry: berryGeometry,
      material: this._materials.flowerBud,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('flowers', {
      name: 'Blackcurrant_Flowers_GreenMauve',
      geometry: this._geometry(createFlowerGeometry()),
      material: this._materials.flower,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('berries', {
      name: 'Blackcurrant_Berries',
      geometry: berryGeometry,
      material: this._materials.fruit,
      group: this._fruitGroup,
    });
    this._addInstancedOrgan('calyces', {
      name: 'Blackcurrant_RetainedCalyxStars',
      geometry: this._geometry(createCalyxStarGeometry()),
      material: this._materials.calyx,
      group: this._fruitGroup,
    });
    const leafInstances = this._instancePool.mesh('leaves');
    leafInstances.customDepthMaterial = this._materials.leafDepth;
    leafInstances.customDistanceMaterial = this._materials.leafDistance;
  }

  #setLeaf(leafRuntime, leafState, nodeState, detailScale = 1) {
    const identity = (leafRuntime.identity ??= this._renderIdentity(
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
    this._writeInstance('leaves', identity, matrix);

    const petioleDummy = new THREE.Object3D();
    composeSegmentMatrix(petioleDummy, petioleStart, position, 0.0013);
    this._writeInstance(
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
    this._leafSeasonTint
      .copy(SPRING_LEAF_TINT)
      .lerp(SUMMER_LEAF_TINT, springMix)
      .lerp(AUTUMN_LEAF_TINT, autumnProgress);
    this._materials.leaf.color
      .copy(this._leafBaseColor)
      .multiply(this._leafSeasonTint);
  }

  #setBud(leafRuntime, nodeState, visible) {
    if (!visible) return;
    const identity = (leafRuntime.identity ??= this._renderIdentity(
      leafRuntime.id,
      'leaf',
    ));
    const position = vector(nodeState.position);
    const quaternion = leafRuntime.currentQuaternion ?? leafRuntime.quaternion;
    const scale = new THREE.Vector3(0.007, 0.012, 0.007);
    this._writeInstance(
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
    const racemeIdentity = (racemeRuntime.identity ??= this._renderIdentity(
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
    this._writeInstance(
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
      const berryIdentity = (berryRuntime.identity ??= this._renderIdentity(
        berryRuntime.id,
        'berry',
      ));
      const t = (berryIndex + 1) / (racemeRuntime.berries.length + 1);
      const pedicelStart = start.clone().lerp(end, t);
      const berryPosition = vector(berryState.position);
      const pedicelDummy = new THREE.Object3D();
      composeSegmentMatrix(pedicelDummy, pedicelStart, berryPosition, 0.00045);
      this._writeInstance(
        'pedicels',
        berryIdentity,
        pedicelDummy.matrix,
        PETIOLE_GREEN.clone().lerp(PETIOLE_RED, 0.48),
      );

      if (showFlowers) {
        const flowerIdentity = (berryRuntime.flowerIdentity ??=
          this._renderIdentity(berryRuntime.id, 'flower'));
        const flowerQuaternion = makeBasisQuaternion(
          berryPosition.clone().sub(pedicelStart).normalize().negate(),
          new THREE.Vector3(0, 0, 1),
        );
        if (flowerOpenVisibility > 0.015) {
          const flowerScale =
            0.0125 *
            THREE.MathUtils.lerp(0.45, 1, flowerProgress) *
            Math.sqrt(flowerOpenVisibility);
          this._writeInstance(
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
          this._writeInstance(
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
        this._writeInstance(
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
        this._writeInstance(
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

  _applySnapshot(snapshot) {
    this._instancePool.beginFrame();
    this._rebuildWoodyGeometry(snapshot);

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
        const axisRuntime = this._runtime.axes.get(axis.id);
        if (!axisRuntime) {
          throw new Error(`Missing render axis for model organ ${axis.id}.`);
        }
        visibleAxes++;
        const axisGrowth = THREE.MathUtils.clamp(axis.growthScale, 0, 1);

        for (const node of axis.nodes) {
          for (const state of node.leaves) {
            const leafRuntime = this._runtime.leaves.get(state.id);
            if (!leafRuntime) {
              throw new Error(
                `Missing render leaf for model organ ${state.id}.`,
              );
            }
            const biologicallyVisible = state.visible;
            const detailScale = this._organDetailScale(state.id);
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
            const racemeRuntime = this._runtime.racemes.get(state.id);
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

    this._instancePool.commitFrame();

    this._renderStats = {
      visibleCanes,
      visibleAxes,
      visibleLeaves,
      visibleFlowerBuds,
      visibleFlowers,
      visibleBerries,
      visibleGreenBerries,
      visibleRipeBerries,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateTiselModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this._events,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
    });
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

  /** Blackcurrant care events carry harvest and whole-cane pruning payloads. */
  _decorateEvent(event) {
    if (event.type === 'harvest') {
      return { ...event, ...createHarvestEvent(event) };
    }
    if (event.type === 'prune') {
      return { ...event, ...createPruneEvent(event) };
    }
    return event;
  }

  pruneOldestCane(options = {}) {
    const targetAge = PlantRenderer.number(options.ageYears, this.ageYears);
    const targetDay = THREE.MathUtils.clamp(
      Math.floor(PlantRenderer.number(options.dayOfYear, this.dayOfYear)),
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
      events: this._events,
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
    const sameYearPrunes = this._events.filter(
      (event) =>
        event.type === 'prune' &&
        Math.floor(PlantRenderer.number(event.ageYears, event.year)) ===
          currentYear,
    );
    const reservedCaneIds = new Set(
      sameYearPrunes.map((event) => event.caneId).filter(Boolean),
    );
    const activeCanes = targetSnapshot.canes.filter((cane) => !cane.removed);
    const unprunedYearEnd = evaluateTiselModel(this.#model, {
      ageYears: currentYear,
      dayOfYear: 365,
      events: this._events.filter((event) => !sameYearPrunes.includes(event)),
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
          (options.force ||
            PlantRenderer.number(cane.ageYears, 0) >= minimumAge),
      )
      .sort(
        (a, b) =>
          PlantRenderer.number(b.ageYears, 0) -
          PlantRenderer.number(a.ageYears, 0),
      );
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

  stats() {
    const source = this._snapshot.stats;
    const harvestedYieldKg = this._events
      .filter(
        (event) =>
          event.type === 'harvest' &&
          tiselEventTime(event) <=
            tiselEventTime({
              ageYears: this.ageYears,
              dayOfYear: this.dayOfYear,
            }),
      )
      .reduce((sum, event) => sum + PlantRenderer.number(event.amountKg, 0), 0);

    return {
      ...source,
      ...this._renderStats,
      species: this._snapshot.species,
      cultivar: this.cultivar,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
      estimatedYieldKg: source.estimatedYieldKg,
      harvestedYieldKg,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Blackcurrant',
      plantId: this._plantId,
      species: 'Ribes nigrum',
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      trialYear: this.trialYear,
      offsetDays: this.offsetDays,
      events: this._events.map((event) => ({ ...event })),
    };
  }
}

export default Blackcurrant;
