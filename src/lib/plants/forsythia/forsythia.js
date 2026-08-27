import * as THREE from 'three';
import { LYNWOOD_PROFILE, LYNWOOD_RENDER_PRIORS } from './lynwood.js';
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
  createUnitStemGeometry,
  makeBasisQuaternion,
  vector,
} from '../../plant-transforms.js';
import { PlantRenderer } from '../../plant-renderer.js';
import { loadLeafPlate } from '../../leaf-plate.js';

const UP = new THREE.Vector3(0, 1, 0);
// Forsythia foliage runs a fairly deep, slightly blue green in summer, flushes
// bronze-tinted when young, and turns gold to purple-bronze in autumn.
const SPRING_LEAF_TINT = new THREE.Color(0xdcecc0);
const SUMMER_LEAF_TINT = new THREE.Color(0xc2d3ac);
const AUTUMN_LEAF_TINT = new THREE.Color(0xd8a05a);
const PETIOLE_GREEN = new THREE.Color(0x7d8d4e);
const PETIOLE_BRONZE = new THREE.Color(0x7d6340);
const DORMANT_BUD_SCALE = new THREE.Vector3(0.0038, 0.007, 0.0038);

function composeSegmentMatrix(target, direction, start, end, radius) {
  direction.copy(end).sub(start);
  const length = direction.length();
  target.position.copy(start);

  if (length < 1e-7) {
    target.quaternion.identity();
    target.scale.set(0, 0, 0);
  } else {
    target.quaternion.setFromUnitVectors(
      UP,
      direction.multiplyScalar(1 / length),
    );
    target.scale.set(radius, length, radius);
  }

  target.updateMatrix();
  return target.matrix;
}

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
/** This plant's own leaf plate, resolved beside its source. */
const LEAF_PLATE = loadLeafPlate(new URL('./leaf.webp', import.meta.url));

export class Forsythia extends PlantRenderer {
  #model;

  #scratch = {
    direction: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
    nodePosition: new THREE.Vector3(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    segment: new THREE.Object3D(),
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
      petiole: this._material({
        color: 0xffffff,
        roughness: 0.84,
        metalness: 0,
      }),
      // Dormant vegetative buds on bare wood: small, dark and pointed.
      bud: this._material({ color: 0x78694d, roughness: 0.92, metalness: 0 }),
      flowerBud: this._material({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.86,
        metalness: 0,
      }),
      flower: this._material({
        color: 0xffffff,
        vertexColors: true,
        // A small yellow lift keeps shaded, outward-facing corollas clear
        // yellow instead of collapsing into ochre clumps at shrub scale.
        emissive: 0x5a4800,
        emissiveIntensity: 0.25,
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
              position: end,
              radial,
              leafQuaternion: makeBasisQuaternion(
                bladeForward,
                vector(leaf.normal, UP),
              ),
              budQuaternion: makeBasisQuaternion(budForward, UP),
              petioleColor: PETIOLE_GREEN.clone().lerp(
                PETIOLE_BRONZE,
                keyedRange(this.seed, [leaf.id, 'petiole-bronze'], 0.2, 0.7),
              ),
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

  #setLeaf(leafRuntime, leafState, nodeState, detailScale = 1) {
    const identity = leafRuntime.identity;
    const unfoldProgress = THREE.MathUtils.clamp(
      leafState.unfoldProgress,
      0,
      1,
    );

    const { direction, matrix, nodePosition, position, scale, segment } =
      this.#scratch;
    nodePosition.copy(nodeState.position);
    position
      .copy(nodePosition)
      .lerp(leafState.position ?? leafRuntime.position, unfoldProgress);
    const sourceScale = leafState.scale / leafRuntime.sourceSize;
    const leafScale = leafRuntime.size * sourceScale * detailScale;
    scale.set(leafScale, leafScale, leafScale);
    matrix.compose(position, leafRuntime.leafQuaternion, scale);
    this._writeInstance('leaves', identity, matrix);

    composeSegmentMatrix(segment, direction, nodePosition, position, 0.0011);
    this._writeInstance(
      'petioles',
      identity,
      segment.matrix,
      leafRuntime.petioleColor,
    );
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
    this._writeInstance('buds', leafRuntime.identity, matrix);
  }

  #setCluster(
    clusterState,
    nodeState,
    { flowerStride = 1, flowerScale = 1 } = {},
    counts,
  ) {
    const capsuleVisibility = THREE.MathUtils.clamp(
      clusterState.capsuleVisibility,
      0,
      1,
    );
    const { direction, matrix, nodePosition, position, scale, segment } =
      this.#scratch;
    nodePosition.copy(nodeState.position);

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
      position.copy(flower.position);

      // The pedicel is very short: forsythia flowers sit almost directly on
      // the stem rather than hanging from an inflorescence axis.
      if (openVisibility > 0.015 || budVisibility > 0.015) {
        composeSegmentMatrix(
          segment,
          direction,
          nodePosition,
          position,
          0.0009,
        );
        this._writeInstance(
          'pedicels',
          runtime.identity,
          segment.matrix,
          PETIOLE_BRONZE,
        );
      }

      if (budVisibility > 0.015) {
        const budScale =
          flower.corollaWidthM *
          0.42 *
          budVisibility *
          detailScale *
          runtime.budSizeFactor;
        scale.set(budScale, budScale * 1.6, budScale);
        matrix.compose(position, runtime.budQuaternion, scale);
        this._writeInstance('flowerBuds', runtime.identity, matrix);
        counts.visibleFlowerBuds++;
      }

      if (openVisibility > 0.015) {
        // The corolla expands as it opens rather than fading in at full size.
        const openScale =
          flower.corollaWidthM *
          THREE.MathUtils.lerp(0.55, 1, openVisibility) *
          detailScale *
          runtime.corollaSizeFactor;
        scale.set(openScale, openScale * runtime.tubeRatio, openScale);
        matrix.compose(position, runtime.flowerQuaternion, scale);
        this._writeInstance('flowers', runtime.identity, matrix);
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
    let totalVisibleFlowerSites = 0;
    for (const cane of snapshot.canes) {
      for (const axis of cane.axes) {
        for (const node of axis.nodes) {
          totalLeafSites += node.leaves.length;
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
    const flowerStride = capacityStride(
      totalVisibleFlowerSites,
      LYNWOOD_RENDER_PRIORS.instanceCapacities.flowers,
      this._detail.leafStride,
    );
    const leafScale =
      this._detail.leafScale *
      (leafStride > this._detail.leafStride ? 1.08 : 1);
    const flowerScale =
      flowerStride > this._detail.leafStride
        ? Math.min(1.12, 1 + (flowerStride - 1) * 0.035)
        : 1;

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
            const detailScale = this.#detailScale(
              leafRuntime,
              leafStride,
              leafScale,
            );
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
              detailScale > 0 &&
                (!biologicallyVisible || phenology.leafProgress < 0.2),
            );
          }

          for (const state of node.clusters) {
            if (!state.visible) continue;
            this.#setCluster(
              state,
              node,
              { flowerStride, flowerScale },
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
