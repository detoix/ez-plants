import * as THREE from 'three';
import { LYNWOOD_PROFILE } from './lynwood.js';
import {
  createLynwoodModel,
  createPruneEvent,
  evaluateLynwoodModel,
  lynwoodEventTime,
} from './model.js';
import {
  createCapsuleGeometry,
  createFlowerBudGeometry,
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
// Forsythia foliage runs a fairly deep, slightly blue green in summer, flushes
// bronze-tinted when young, and turns gold to purple-bronze in autumn.
const SPRING_LEAF_TINT = new THREE.Color(0xdcecc0);
const SUMMER_LEAF_TINT = new THREE.Color(0xffffff);
const AUTUMN_LEAF_TINT = new THREE.Color(0xd8a05a);
const PETIOLE_GREEN = new THREE.Color(0x7d8d4e);
const PETIOLE_BRONZE = new THREE.Color(0x7d6340);

const INSTANCE_KINDS = Object.freeze([
  'leaves',
  'petioles',
  'buds',
  'pedicels',
  'flowerBuds',
  'flowers',
  'capsules',
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
      leafScale: 1.18,
    }),
  }),
  Object.freeze({
    distance: 12,
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
 * A persistent, cultivar-specific Forsythia x intermedia 'Lynwood' renderer.
 *
 * The plant this draws is defined by two facts that the blackcurrant renderer
 * never has to handle: the flowers open on bare one- and two-year-old wood
 * before any leaf expands, and the leaves are opposite rather than alternate.
 * Everything else -- stable organ pools, the combined EZ-Tree woody mesh,
 * distance LOD and the validated state cycle -- comes from PlantRenderer.
 */
export class Forsythia extends PlantRenderer {
  #model;

  constructor(options = {}) {
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
      extraStateKeys: ['scenario', 'region', 'offsetDays'],
      lodLevels: DEFAULT_LOD_LEVELS,
      // The blades are broad and the shoots are long and springy, so the wind
      // displacement is wider than the currant's.
      leafWind: {
        strength: new THREE.Vector3(0.115, 0, 0.115),
        frequency: 0.42,
        scale: 1.25,
      },
      barkTint: 0x6a5f4c,
    });

    this.scenario = options.scenario ?? 'maintained';
    this.region = options.region ?? 'central';
    this.offsetDays = options.offsetDays ?? 0;

    this.#model = createLynwoodModel({
      seed: this.seed,
      maxYears: this.maxYears,
    });

    this._initialiseEvents(options.events ?? []);

    this._runtime.leaves = new Map();
    this._runtime.clusters = new Map();

    this.#createMaterials();
    this.#buildStableGraph();
    this._createWoodMesh(this._materials.cane);
    this.#createInstances();
    this.setTime({ ageYears: this.ageYears, dayOfYear: this.dayOfYear });
    if (options.lod) this._enableLOD();
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
    this._leafBaseColor = leafMaterials.surface.color.clone();
    this._leafSeasonTint = new THREE.Color();

    this._materials = {
      cane,
      leaf: leafMaterials.surface,
      leafDepth: leafMaterials.depth,
      leafDistance: leafMaterials.distance,
      petiole: this._material({
        color: 0xffffff,
        roughness: 0.84,
        metalness: 0,
      }),
      // Dormant vegetative buds on bare wood: small, dark and pointed.
      bud: this._material({ color: 0x6b5a3e, roughness: 0.92, metalness: 0 }),
      flowerBud: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.86,
        metalness: 0,
      }),
      flower: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.62,
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
    const stemGeometry = this._geometry(createUnitStemGeometry(5));

    this._addInstancedOrgan('leaves', {
      name: 'Forsythia_Leaves_Opposite',
      geometry: this._geometry(
        createLeafCardGeometry({
          roundedNormals: this._assets.leaf.roundedNormals,
        }),
      ),
      material: this._materials.leaf,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('petioles', {
      name: 'Forsythia_Petioles',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._leafGroup,
    });
    this._addInstancedOrgan('buds', {
      name: 'Forsythia_DormantBuds',
      geometry: this._geometry(
        createFlowerBudGeometry({ segments: 5, rings: 3 }),
      ),
      material: this._materials.bud,
      group: this._woodyGroup,
    });
    this._addInstancedOrgan('pedicels', {
      name: 'Forsythia_Pedicels',
      geometry: stemGeometry,
      material: this._materials.petiole,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('flowerBuds', {
      name: 'Forsythia_FlowerBuds',
      geometry: this._geometry(createFlowerBudGeometry()),
      material: this._materials.flowerBud,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('flowers', {
      name: 'Forsythia_Flowers_FourLobed',
      geometry: this._geometry(createFlowerGeometry()),
      material: this._materials.flower,
      group: this._flowerGroup,
    });
    this._addInstancedOrgan('capsules', {
      name: 'Forsythia_Capsules',
      geometry: this._geometry(createCapsuleGeometry()),
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

    for (const cane of this.#model.canes) {
      const nodeAttachments = new Map();

      cane.axes.forEach((axis, axisIndex) => {
        this._buildAxisRuntime({ cane, axis, axisIndex, nodeAttachments });

        for (const node of axis.nodes) {
          const nodePosition = vector(node.position);
          const tangent = vector(node.tangent);
          if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
          tangent.normalize();

          for (const leaf of node.leaves) {
            const start = nodePosition.clone();
            const end = vector(leaf.position);
            const radial = end.clone().sub(start);
            if (radial.lengthSq() < 1e-6) {
              radial.set(Math.cos(leaf.azimuth), 0.1, Math.sin(leaf.azimuth));
            }
            radial.normalize();
            const size =
              leaf.lengthM *
              keyedRange(this.seed, [leaf.id, 'size'], 0.93, 1.07);

            addHistoricalOrgans({ leaves: 1, petioles: 1, buds: 1 });
            addAnnualOrgans(leaf.year, { leaves: 1, petioles: 1, buds: 1 });
            this._runtime.leaves.set(leaf.id, {
              id: leaf.id,
              start,
              position: end,
              radial,
              size,
              sourceSize: leaf.lengthM,
              widthRatio: leaf.widthM / Math.max(1e-6, leaf.lengthM),
            });
          }

          for (const cluster of node.clusters) {
            const flowerCount = cluster.flowers.length;
            const organs = {
              pedicels: flowerCount,
              flowerBuds: flowerCount,
              flowers: flowerCount,
              capsules: cluster.capsule ? 1 : 0,
            };
            addHistoricalOrgans(organs);
            addAnnualOrgans(cluster.floweringYear, organs);
            this._runtime.clusters.set(cluster.id, { id: cluster.id });
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

  /* ------------------------------------------------------------------ *
   * Per-organ placement
   * ------------------------------------------------------------------ */

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
    if (radial.lengthSq() < 1e-6) radial.copy(leafRuntime.radial);
    const tangent = vector(nodeState.tangent);
    if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
    tangent.normalize();

    // The blade projects away from the shoot with only a little alignment to
    // it, which is what gives an opposite-leaved shrub its flat, ranked look.
    const bladeForward = radial
      .clone()
      .normalize()
      .multiplyScalar(0.84)
      .addScaledVector(tangent, 0.16)
      .normalize();
    const leafQuaternion = makeBasisQuaternion(
      bladeForward,
      vector(leafState.normal, UP),
    );
    const sourceScale = leafState.scale / leafRuntime.sourceSize;
    const scale = leafRuntime.size * sourceScale * detailScale;
    const matrix = new THREE.Matrix4().compose(
      position,
      leafQuaternion,
      // Forsythia blades are narrow lanceolate cards, not the currant's
      // near-square maple-like blade, so width is scaled independently.
      new THREE.Vector3(scale * leafRuntime.widthRatio * 2.4, scale, scale),
    );
    this._writeInstance('leaves', identity, matrix);

    const petioleDummy = new THREE.Object3D();
    composeSegmentMatrix(petioleDummy, petioleStart, position, 0.0011);
    this._writeInstance(
      'petioles',
      identity,
      petioleDummy.matrix,
      PETIOLE_GREEN.clone().lerp(
        PETIOLE_BRONZE,
        keyedRange(this.seed, [leafRuntime.id, 'petiole-bronze'], 0.2, 0.7),
      ),
    );
    leafRuntime.currentQuaternion = leafQuaternion;
  }

  #setBud(leafRuntime, nodeState, visible) {
    if (!visible) return;
    const identity = (leafRuntime.identity ??= this._renderIdentity(
      leafRuntime.id,
      'leaf',
    ));
    const position = vector(nodeState.position);
    const quaternion =
      leafRuntime.currentQuaternion ??
      makeBasisQuaternion(leafRuntime.radial, UP);
    const scale = new THREE.Vector3(0.006, 0.011, 0.006);
    this._writeInstance(
      'buds',
      identity,
      new THREE.Matrix4().compose(position, quaternion, scale),
    );
  }

  #setCluster(clusterState, nodeState) {
    const openVisibility = THREE.MathUtils.clamp(
      clusterState.flowerOpenVisibility,
      0,
      1,
    );
    const budVisibility = THREE.MathUtils.clamp(
      clusterState.flowerBudVisibility,
      0,
      1,
    );
    const capsuleVisibility = THREE.MathUtils.clamp(
      clusterState.capsuleVisibility,
      0,
      1,
    );
    const nodePosition = vector(nodeState.position);

    for (const flower of clusterState.flowers) {
      const identity = this._renderIdentity(flower.id, 'flower');
      const position = vector(flower.position);
      const direction = vector(flower.direction);
      if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
      direction.normalize();

      // The pedicel is very short: forsythia flowers sit almost directly on
      // the stem rather than hanging from an inflorescence axis.
      if (openVisibility > 0.015 || budVisibility > 0.015) {
        const pedicelDummy = new THREE.Object3D();
        composeSegmentMatrix(pedicelDummy, nodePosition, position, 0.0009);
        this._writeInstance(
          'pedicels',
          identity,
          pedicelDummy.matrix,
          PETIOLE_BRONZE,
        );
      }

      const quaternion = makeBasisQuaternion(direction, UP);

      if (budVisibility > 0.015) {
        const budScale =
          flower.corollaWidthM *
          0.42 *
          budVisibility *
          keyedRange(this.seed, [flower.id, 'bud-size'], 0.85, 1.15);
        this._writeInstance(
          'flowerBuds',
          identity,
          new THREE.Matrix4().compose(
            position,
            quaternion,
            new THREE.Vector3(budScale, budScale * 1.6, budScale),
          ),
        );
      }

      if (openVisibility > 0.015) {
        // The corolla expands as it opens rather than fading in at full size.
        const openScale =
          flower.corollaWidthM *
          THREE.MathUtils.lerp(0.55, 1, openVisibility) *
          keyedRange(this.seed, [flower.id, 'corolla-size'], 0.88, 1.12);
        const spin = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          flower.roll,
        );
        this._writeInstance(
          'flowers',
          identity,
          new THREE.Matrix4().compose(
            position,
            quaternion.clone().multiply(spin),
            new THREE.Vector3(openScale, openScale, openScale),
          ),
        );
      }
    }

    if (clusterState.capsule && capsuleVisibility > 0.02) {
      const capsule = clusterState.capsule;
      const direction = vector(capsule.direction);
      if (direction.lengthSq() < 1e-6) direction.set(0, -1, 0);
      direction.normalize();
      const scale = capsule.lengthM * capsuleVisibility;
      this._writeInstance(
        'capsules',
        this._renderIdentity(capsule.id, 'capsule'),
        new THREE.Matrix4().compose(
          vector(capsule.position),
          makeBasisQuaternion(direction, UP),
          new THREE.Vector3(scale, scale, scale),
        ),
      );
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
    this._rebuildWoodyGeometry(snapshot);

    const phenology = snapshot.phenology;
    this.#setLeafMaterialPhenology(phenology);

    let visibleCanes = 0;
    let visibleAxes = 0;
    let visibleLeaves = 0;
    let visibleFlowers = 0;
    let visibleFlowerBuds = 0;
    let visibleCapsules = 0;

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
              visibleLeaves++;
            }
            // Bare-wood buds stand in for the leaf all winter and through the
            // entire flowering display, which is most of what makes a
            // forsythia in bloom read as leafless.
            this.#setBud(
              leafRuntime,
              node,
              !biologicallyVisible || phenology.leafProgress < 0.2,
            );
          }

          for (const state of node.clusters) {
            if (!state.visible) continue;
            this.#setCluster(state, node);
            if (state.flowerOpenVisibility > 0.015) {
              visibleFlowers += state.flowers.length;
            } else if (state.flowerBudVisibility > 0.015) {
              visibleFlowerBuds += state.flowers.length;
            }
            if (state.capsule && state.capsuleVisibility > 0.02) {
              visibleCapsules++;
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
      visibleFlowers,
      visibleFlowerBuds,
      visibleCapsules,
      ...this._drawCallStats(),
    };
  }

  _evaluate() {
    return evaluateLynwoodModel(this.#model, {
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      events: this._events,
      scenario: this.scenario,
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

  setScenario(scenario) {
    return this.setState({ scenario: scenario ?? 'maintained' });
  }

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

    const calendar = this._snapshot.phenology.calendar;
    if (targetDay <= calendar.floweringEnd) {
      return reject('before-flowering-ends');
    }
    if (targetDay > management.latestSafePruningDay) {
      return reject('after-bud-set');
    }

    const candidates = this._snapshot.canes
      .filter((cane) => !cane.removed)
      .sort(
        (a, b) => a.birthAgeYears - b.birthAgeYears || a.id.localeCompare(b.id),
      );
    if (candidates.length === 0) return reject('no-canes');

    // RHS group 2 takes up to one fifth of the oldest stems at the base, per
    // season. Pruned canes leave the evaluated snapshot, so the quota has to
    // be measured against the stand as it stood before this season's cuts --
    // counting only what is left would let the fifth be taken over and over.
    const prunedThisSeason = this._events.filter(
      (event) =>
        event.type === 'prune' &&
        Math.floor(event.ageYears) === Math.floor(targetAge),
    );
    const standSize = candidates.length + prunedThisSeason.length;
    const quota = Math.max(
      1,
      Math.floor(standSize * management.oldestCaneRemovalFraction),
    );
    if (prunedThisSeason.length >= quota) return reject('quota-reached');

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
      scenario: this.scenario,
      region: this.region,
      dimensions: this._snapshot.dimensions,
      phenology: this._snapshot.phenology,
      careHints: this._snapshot.careHints,
    };
  }

  serialize() {
    return {
      schemaVersion: 1,
      type: 'Forsythia',
      plantId: this._plantId,
      species: LYNWOOD_PROFILE.species,
      cultivar: this.cultivar,
      seed: this.seed,
      maxYears: this.maxYears,
      ageYears: this.ageYears,
      dayOfYear: this.dayOfYear,
      scenario: this.scenario,
      region: this.region,
      offsetDays: this.offsetDays,
      events: this._events.map((event) => ({ ...event })),
    };
  }
}

export { lynwoodEventTime };
export default Forsythia;
