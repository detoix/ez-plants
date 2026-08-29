import {
  LYNWOOD_CALENDAR,
  getLynwoodCareHints,
  getLynwoodPhenology,
} from './phenology.js';
import { LYNWOOD_PROFILE, LYNWOOD_RENDER_PRIORS } from './lynwood.js';
import RNG from '../../rng.js';
import { growWoodyAxis } from '../../woody-axis.js';
import {
  keyedInteger as randomInt,
  keyedRandom,
  keyedRange as randomRange,
} from '../../keyed-random.js';
import {
  add,
  clamp,
  cross,
  dot,
  length,
  lerp,
  normalize,
  sampleAnchors,
  scale,
  smoothstep01,
  tangentAt,
  TAU,
  vector,
} from '../../model-math.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * EZ-Tree's branch model consumes a sequential RNG, while this model is keyed
 * so any organ can be regenerated in isolation. Deriving the axis seed from
 * the organ key keeps both: the graph is built once, and rebuilding it from
 * the same seed reproduces every cane exactly.
 */
const caneRngSeed = (seed, caneId) =>
  Math.floor(keyedRandom(seed, caneId, 'axis-rng') * 0xffffffff);

/**
 * The 'Lynwood' cane: stiff and upright for most of its length, then arching
 * outward and drooping near the tip. A minority of central shoots stay nearly
 * upright while the outer layer receives the stronger fountain-forming force.
 */
/**
 * Grow one cane through EZ-Tree's own branch model.
 *
 * A forsythia cane is not a curve to be fitted; it is a shoot that grows up
 * and bends over as it thins. EZ-Tree already models exactly that: its force
 * step is `strength / sectionRadius`, so a thick base holds its line while the
 * thin distal wood turns further per section. Pointing that force outward and
 * down produces the cultivar's fountain from the same code the trees use,
 * instead of a hand-fitted polynomial that has to be re-tuned by eye.
 */
function mainAxisPoints(seed, cane) {
  const architecture = LYNWOOD_PROFILE.architecture;
  const count = randomInt(
    seed,
    [cane.id, 'main-node-count'],
    LYNWOOD_PROFILE.cane.mainAxisNodeCount[0],
    LYNWOOD_PROFILE.cane.mainAxisNodeCount[1],
  );
  const outward = vector(Math.cos(cane.azimuth), 0, Math.sin(cane.azimuth));
  const upright =
    keyedRandom(seed, cane.id, 'upright-cane') <
    architecture.uprightCaneFraction;
  const archRange = upright
    ? architecture.uprightArchMultiplier
    : architecture.outerArchMultiplier;
  const archMultiplier = randomRange(
    seed,
    [cane.id, 'arch-multiplier'],
    archRange[0],
    archRange[1],
  );

  // Canes lean outward a little at the crown before the force takes over.
  const lean = upright
    ? randomRange(seed, [cane.id, 'lean'], 0.015, 0.08)
    : randomRange(seed, [cane.id, 'lean'], 0.07, 0.18);
  const orientation = vector(
    Math.sin(cane.azimuth) * lean,
    keyedRandom(seed, cane.id, 'sway-phase') * TAU,
    -Math.cos(cane.azimuth) * lean,
  );

  const sections = growWoodyAxis({
    origin: vector(cane.position.x, cane.position.y, cane.position.z),
    orientation,
    // The cane's arc is longer than its final height, because the arch trades
    // height for reach.
    length: cane.targetHeightM * architecture.caneArcLengthFactor,
    radius: cane.baseRadiusM,
    sectionCount: count,
    gnarliness: architecture.caneGnarliness,
    taper: LYNWOOD_PROFILE.cane.axisTaperRatios[1],
    force: {
      direction: vector(outward.x, -architecture.archDrop, outward.z),
      // Force is applied once per section, so without normalising by the
      // section count a denser cane would arch further for the same strength
      // and node spacing would silently change the plant's habit.
      strength:
        ((architecture.caneForceStrength * architecture.caneReferenceSections) /
          count) *
        archMultiplier,
    },
    rng: new RNG(caneRngSeed(seed, cane.id)),
  });

  return sections.map((section) =>
    vector(section.origin.x, section.origin.y, section.origin.z),
  );
}

function sideAxisPoints(
  seed,
  { parentId, parentAzimuth, parentPoints, childIndex, childCount, axisClass },
) {
  const isShortShoot = axisClass === 'short-shoot';
  const rankedAttachment = clamp(
    (childIndex +
      randomRange(seed, [parentId, 'attach-jitter', childIndex], 0.05, 0.95)) /
      Math.max(1, childCount) +
      randomRange(seed, [parentId, 'attach-drift', childIndex], -0.055, 0.055),
    0,
    1,
  );
  const distributedAttachment = isShortShoot
    ? rankedAttachment
    : Math.pow(rankedAttachment, 0.82);
  const attachFraction = clamp(
    0.28 + distributedAttachment * (isShortShoot ? 0.66 : 0.64),
    isShortShoot ? 0.24 : 0.2,
    isShortShoot ? 0.94 : 0.92,
  );
  const attachIndex = clamp(
    Math.round(attachFraction * (parentPoints.length - 1)),
    2,
    parentPoints.length - (isShortShoot ? 2 : 3),
  );
  const origin = parentPoints[attachIndex];
  const side = childIndex % 2 === 0 ? -1 : 1;
  const parentTangent = tangentAt(parentPoints, attachIndex);
  const radialOut = vector(Math.cos(parentAzimuth), 0, Math.sin(parentAzimuth));
  let sideNormal = normalize(cross(vector(0, 1, 0), parentTangent));
  if (
    length(sideNormal) < 1e-5 ||
    Math.abs(dot(sideNormal, sideNormal)) < 1e-5
  ) {
    sideNormal = vector(-radialOut.z, 0, radialOut.x);
  }
  let localUp = normalize(cross(parentTangent, sideNormal));
  if (localUp.y < 0) localUp = scale(localUp, -1);

  const direction = isShortShoot
    ? normalize(
        add(
          scale(
            parentTangent,
            randomRange(seed, [parentId, 'forward', childIndex], 0.38, 0.68),
          ),
          add(
            scale(
              sideNormal,
              side *
                randomRange(seed, [parentId, 'side', childIndex], 0.32, 0.72),
            ),
            scale(
              localUp,
              randomRange(seed, [parentId, 'rise', childIndex], 0.2, 0.55),
            ),
          ),
        ),
      )
    : normalize(
        add(
          scale(
            radialOut,
            randomRange(seed, [parentId, 'forward', childIndex], 0.32, 0.72),
          ),
          add(
            scale(
              sideNormal,
              side *
                randomRange(seed, [parentId, 'side', childIndex], 0.38, 0.78),
            ),
            vector(
              0,
              randomRange(seed, [parentId, 'rise', childIndex], 0.48, 0.92),
              0,
            ),
          ),
        ),
      );
  const azimuth = Math.atan2(direction.z, direction.x);
  const axisLength = isShortShoot
    ? randomRange(
        seed,
        [parentId, 'short-shoot-length', childIndex],
        LYNWOOD_PROFILE.cane.shortShootLengthM[0],
        LYNWOOD_PROFILE.cane.shortShootLengthM[1],
      )
    : randomRange(seed, [parentId, 'lateral-length', childIndex], 0.24, 0.56);
  const nodeRange = isShortShoot
    ? LYNWOOD_PROFILE.cane.shortShootNodeCount
    : LYNWOOD_PROFILE.cane.lateralNodeCount;
  const count = randomInt(
    seed,
    [parentId, `${axisClass}-node-count`, childIndex],
    nodeRange[0],
    nodeRange[1],
  );
  const distalDroop = randomRange(
    seed,
    [parentId, `${axisClass}-droop`, childIndex],
    isShortShoot ? 0.04 : 0.1,
    isShortShoot ? 0.18 : 0.28,
  );
  const sideCurve = randomRange(
    seed,
    [parentId, `${axisClass}-side-curve`, childIndex],
    -0.12,
    0.12,
  );
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    points.push(
      add(
        origin,
        add(
          scale(direction, axisLength * t),
          add(
            scale(sideNormal, Math.sin(t * Math.PI) * axisLength * sideCurve),
            vector(0, -axisLength * distalDroop * t * t, 0),
          ),
        ),
      ),
    );
  }

  return { points, azimuth, attachIndex };
}

/**
 * Build one decussate leaf pair.
 *
 * Forsythia leaves are opposite: two blades emerge from the same node, 180
 * degrees apart. Successive nodes rotate by 90 degrees, which is what makes a
 * forsythia shoot read as a flat-ranked cross rather than the currant's spiral.
 */
function phyllotacticAngle(seed, node) {
  const axisPhase = randomRange(seed, [node.axisId, 'leaf-phase'], -0.18, 0.18);
  const pairJitter = randomRange(
    seed,
    [node.id, 'pair-azimuth-jitter'],
    -0.2,
    0.2,
  );
  return (
    node.index * LYNWOOD_PROFILE.leaf.decussateTurnRadians +
    axisPhase +
    pairJitter
  );
}

function makeLeafPair(seed, node) {
  const leaf = LYNWOOD_PROFILE.leaf;
  const decussateTurn = phyllotacticAngle(seed, node);
  const leaves = [];

  for (let side = 0; side < leaf.leavesPerNode; side += 1) {
    // A woody node carries the same opposite bud sites from year to year. Reuse
    // one stable blade blueprint per side instead of materialising identical
    // leaf objects for every simulated year.
    const id = `${node.id}:leaf:${side}`;
    const azimuth = node.azimuth + decussateTurn + side * Math.PI;
    const petioleLengthM = randomRange(
      seed,
      [id, 'petiole'],
      leaf.petioleLengthM[0],
      leaf.petioleLengthM[1],
    );
    const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
    const sideways = vector(-outward.z, 0, outward.x);
    // Blades hang outward and slightly down from an arching shoot rather than
    // presenting flat upward like a currant leaf.
    const bladeTilt = randomRange(seed, [id, 'blade-tilt'], 0.55, 1.05);
    const bladeRoll = randomRange(seed, [id, 'blade-roll'], -0.35, 0.35);
    const bladeDroop = randomRange(seed, [id, 'blade-droop'], -0.34, -0.06);
    const position = add(
      node.position,
      add(scale(outward, petioleLengthM), vector(0, 0.004, 0)),
    );
    const lengthM = randomRange(
      seed,
      [id, 'length'],
      leaf.lengthM[0],
      leaf.lengthM[1],
    );
    // Published blades run 4-10 x 2-5 cm, so roughly 2:1 to 2.5:1.
    const widthRatio = randomRange(seed, [id, 'width-ratio'], 0.4, 0.56);

    leaves.push({
      id,
      side,
      position,
      normal: normalize(
        add(
          vector(0, 1, 0),
          add(
            scale(outward, bladeTilt),
            add(scale(sideways, bladeRoll), vector(0, bladeDroop, 0)),
          ),
        ),
      ),
      azimuth,
      lengthM,
      widthM: clamp(lengthM * widthRatio, leaf.widthM[0], leaf.widthM[1]),
    });
  }

  return leaves;
}

/**
 * Build one flower cluster for a node in a given spring.
 *
 * Forsythia flowers open from buds set in the previous summer, sitting in the
 * axils of the fallen leaves of one- and two-year-old wood. The cluster is not
 * an inflorescence axis like a currant raceme: each flower hangs on its own
 * very short pedicel straight off the stem, 1-6 to a leaf-scar.
 */
function makeFlowerCluster(seed, node, floweringYear, woodAgeYears) {
  const flower = LYNWOOD_PROFILE.flower;
  const id = `${node.id}:cluster:y${floweringYear}`;
  // Sources constrain a scar to 1-6 flowers but do not publish a cultivar
  // frequency table, so the frequencies are a renderer prior; the range is not.
  //
  // The range is PER LEAF-SCAR, and this species is opposite-leaved: a node has
  // two scars, and each of them draws its own count. Reading the sourced range
  // as a per-node total halved the display, which is most of why earlier
  // renders read as dotted whips rather than the yellow ropes every reference
  // photograph of a cane in full bloom shows.
  const order = clamp(
    node.axisOrder,
    0,
    LYNWOOD_RENDER_PRIORS.clusterSizeWeightsByOrder.length - 1,
  );
  const weights = LYNWOOD_RENDER_PRIORS.clusterSizeWeightsByOrder[order];
  const [minimumCount, maximumCount] = flower.perScarRange;
  if (weights.length !== maximumCount - minimumCount + 1) {
    throw new RangeError(
      'Forsythia cluster weights must cover the configured 1-6 range.',
    );
  }
  const drawScarCount = (channel) => {
    const draw = keyedRandom(seed, id, channel);
    let cumulative = 0;
    for (let index = 0; index < weights.length; index += 1) {
      cumulative += weights[index];
      if (draw <= cumulative) return minimumCount + index;
    }
    return maximumCount;
  };
  const perScar = [drawScarCount('count'), drawScarCount('count-far-scar')];
  const count = perScar[0] + perScar[1];
  const flowers = [];
  const axisOffset = randomRange(
    seed,
    [node.axisId, 'anthesis-offset'],
    LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[0],
    LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[1],
  );
  const anthesisOffsetDays = clamp(
    axisOffset -
      node.positionAlongAxis * 0.8 +
      randomRange(seed, [id, 'anthesis-jitter'], -0.8, 0.8),
    LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[0],
    LYNWOOD_RENDER_PRIORS.anthesisOffsetDays[1],
  );
  const displayDurationDays = randomRange(
    seed,
    [id, 'display-duration'],
    LYNWOOD_RENDER_PRIORS.individualFlowerDisplayDays[0],
    LYNWOOD_RENDER_PRIORS.individualFlowerDisplayDays[1],
  );
  const decussateTurn = phyllotacticAngle(seed, node);

  for (let index = 0; index < count; index += 1) {
    const flowerId = `${id}:f${index}`;
    // Flowers fan tightly from the two opposite leaf scars. A broad ring hides
    // the node rhythm and makes every cluster look like a manufactured rosette.
    const scarSide = index < perScar[0] ? 0 : Math.PI;
    const azimuth =
      node.azimuth +
      decussateTurn +
      scarSide +
      randomRange(seed, [flowerId, 'azimuth'], -0.34, 0.34);
    const pedicelLengthM = randomRange(
      seed,
      [flowerId, 'pedicel'],
      flower.pedicelLengthM[0],
      flower.pedicelLengthM[1],
    );
    const corollaWidthM = randomRange(
      seed,
      [flowerId, 'width'],
      flower.corollaWidthM[0],
      flower.corollaWidthM[1],
    );
    const tubeLengthM = randomRange(
      seed,
      [flowerId, 'tube'],
      flower.corollaTubeLengthM[0],
      flower.corollaTubeLengthM[1],
    );
    // Corollas nod outward and downward off the stem.
    const nod = randomRange(seed, [flowerId, 'nod'], 0.2, 0.65);
    const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));

    flowers.push({
      id: flowerId,
      index,
      azimuth,
      pedicelLengthM,
      corollaWidthM,
      tubeLengthM,
      nod,
      roll: randomRange(seed, [flowerId, 'roll'], 0, TAU),
      direction: normalize(add(outward, vector(0, -nod, 0))),
      position: add(
        add(
          node.position,
          scale(
            node.tangent,
            randomRange(seed, [flowerId, 'axial-offset'], -0.003, 0.003),
          ),
        ),
        scale(
          normalize(add(outward, vector(0, -nod * 0.5, 0))),
          pedicelLengthM,
        ),
      ),
    });
  }

  // 'Lynwood' is a thrum clone: a solitary plant sets almost no seed, so only
  // a small fraction of clusters carry a visible capsule into the summer.
  const setsCapsule =
    keyedRandom(seed, id, 'capsule-set') < LYNWOOD_PROFILE.capsule.setFraction;
  const capsule = setsCapsule
    ? {
        id: `${id}:capsule`,
        lengthM: randomRange(
          seed,
          [id, 'capsule-length'],
          LYNWOOD_PROFILE.capsule.lengthM[0],
          LYNWOOD_PROFILE.capsule.lengthM[1],
        ),
        azimuth: flowers[0].azimuth,
        direction: flowers[0].direction,
        position: flowers[0].position,
      }
    : null;

  return {
    id,
    floweringYear,
    woodAgeYears,
    anthesisOffsetDays,
    displayDurationDays,
    flowers,
    capsule,
  };
}

function makeNode(
  seed,
  axis,
  index,
  position,
  tangent,
  deathAgeYears,
  maxYears,
) {
  const id = `${axis.id}:node:${index}`;
  const node = {
    id,
    axisId: axis.id,
    axisOrder: axis.order,
    index,
    positionAlongAxis: (index + 1) / Math.max(1, axis.pointCount - 1),
    birthAgeYears:
      axis.birthAgeYears +
      ((index + 1) / Math.max(1, axis.pointCount - 1)) *
        axis.growthDurationYears,
    position,
    tangent,
    azimuth: axis.azimuth,
    leaves: [],
    clusters: [],
  };
  const finalYear = Math.min(Math.ceil(deathAgeYears), maxYears + 1);
  const foliageOrder = clamp(
    axis.order,
    0,
    LYNWOOD_RENDER_PRIORS.foliageStartFractionByOrder.length - 1,
  );
  const foliageEligible =
    node.positionAlongAxis >=
      LYNWOOD_RENDER_PRIORS.foliageStartFractionByOrder[foliageOrder] &&
    keyedRandom(seed, node.id, 'foliage-proxy') <
      LYNWOOD_RENDER_PRIORS.foliageNodeOccupancyByOrder[foliageOrder];
  if (foliageEligible) node.leaves.push(...makeLeafPair(seed, node));

  // The rule that defines this plant: a bud set on wood grown in year Y opens
  // once, in spring Y+1. Nothing flowers on the year's own new growth, which
  // is exactly why pruning must follow flowering rather than precede it.
  const positionAlongAxis = node.positionAlongAxis;
  // Wood age follows the shoot's own growing-season cohort, so a whole module
  // flowers together rather than carrying an artificial travelling age band.
  const woodYear = Math.floor(node.birthAgeYears);
  const order = clamp(
    axis.order,
    0,
    LYNWOOD_PROFILE.flower.floweringStartFractionByOrder.length - 1,
  );
  const floweringStart =
    LYNWOOD_PROFILE.flower.floweringStartFractionByOrder[order];
  const occupancy = LYNWOOD_PROFILE.flower.floweringNodeOccupancyByOrder[order];
  const exposureProxy = clamp(
    0.62 +
      0.17 *
        clamp(
          node.position.y / LYNWOOD_PROFILE.architecture.matureHeightM,
          0,
          1,
        ) +
      0.28 *
        clamp(
          Math.hypot(node.position.x, node.position.z) /
            LYNWOOD_PROFILE.architecture.matureRadiusM,
          0,
          1,
        ),
    0.68,
    1,
  );
  const bearsFlowers =
    positionAlongAxis >= floweringStart &&
    keyedRandom(seed, node.id, 'flowering-node') < occupancy * exposureProxy;
  if (bearsFlowers) {
    // One axillary bud opens once, in the spring after its shoot formed. Short
    // shoots borne by older laterals provide the display associated with
    // two-year supporting wood; a spent leaf scar must not flower again.
    const floweringYear = woodYear + 1;
    if (floweringYear < finalYear && floweringYear <= maxYears + 1) {
      const supportWoodAgeYears = axis.order >= 2 ? 2 : 1;
      node.clusters.push(
        makeFlowerCluster(seed, node, floweringYear, supportWoodAgeYears),
      );
    }
  }

  return node;
}

function makeAxis(
  seed,
  {
    id,
    parentId,
    order,
    birthAgeYears,
    azimuth,
    points,
    deathAgeYears,
    maxYears,
    growthDurationYears = 0.55,
  },
) {
  const sourceYear = Math.floor(birthAgeYears);
  const seasonalEndAgeYears =
    sourceYear + (LYNWOOD_CALENDAR.autumnStart - 1) / 365;
  const seasonalGrowthDurationYears = Math.min(
    growthDurationYears,
    Math.max(1 / 365, seasonalEndAgeYears - birthAgeYears),
  );
  const shell = {
    id,
    parentId,
    order,
    birthAgeYears,
    azimuth,
    pointCount: points.length,
    growthDurationYears: seasonalGrowthDurationYears,
    deathAgeYears,
  };
  const nodes = points
    .slice(1)
    .map((point, index) =>
      makeNode(
        seed,
        shell,
        index,
        point,
        tangentAt(points, index + 1),
        deathAgeYears,
        maxYears,
      ),
    );
  return { ...shell, points, nodes };
}

function calibrateCaneRadius(seed, cane) {
  const architecture = LYNWOOD_PROFILE.architecture;
  let rawRadius = 0;
  for (const axis of cane.axes) {
    for (const point of axis.points) {
      rawRadius = Math.max(rawRadius, Math.hypot(point.x, point.z));
    }
  }
  const targetFactor = randomRange(
    seed,
    [cane.id, 'calibrated-radius'],
    architecture.calibratedRadiusFactor[0],
    architecture.calibratedRadiusFactor[1],
  );
  const targetRadius = architecture.matureRadiusM * targetFactor;
  if (rawRadius <= targetRadius || rawRadius <= 1e-8) return cane;

  const horizontalScale = targetRadius / rawRadius;
  const positions = new Set([cane.position]);
  const directions = new Set();
  for (const axis of cane.axes) {
    for (const point of axis.points) positions.add(point);
    for (const node of axis.nodes) {
      positions.add(node.position);
      directions.add(node.tangent);
      for (const leaf of node.leaves) {
        positions.add(leaf.position);
        directions.add(leaf.normal);
      }
      for (const cluster of node.clusters) {
        for (const flower of cluster.flowers) {
          positions.add(flower.position);
          directions.add(flower.direction);
        }
        if (cluster.capsule) {
          positions.add(cluster.capsule.position);
          directions.add(cluster.capsule.direction);
        }
      }
    }
  }
  for (const position of positions) {
    position.x *= horizontalScale;
    position.z *= horizontalScale;
  }
  for (const direction of directions) {
    direction.x *= horizontalScale;
    direction.z *= horizontalScale;
    const adjusted = normalize(direction);
    direction.x = adjusted.x;
    direction.y = adjusted.y;
    direction.z = adjusted.z;
  }
  for (const axis of cane.axes) {
    axis.nodes.forEach((node, index) => {
      node.tangent = tangentAt(axis.points, index + 1);
    });
  }
  return cane;
}

const caneIdFor = ({ sequence, cohort }) =>
  `lynwood:cane:${cohort}:${String(sequence).padStart(2, '0')}`;

function makeCaneDescriptor({
  sequence,
  cohort,
  birthAgeYears,
  scheduledRemovalYear,
  naturalDeathAgeYears,
}) {
  return {
    id: caneIdFor({ sequence, cohort }),
    sequence,
    cohort,
    birthAgeYears,
    scheduledRemovalYear,
    naturalDeathAgeYears,
  };
}

function makeCane(
  seed,
  {
    id: suppliedId,
    sequence,
    cohort,
    birthAgeYears,
    scheduledRemovalYear,
    naturalDeathAgeYears,
    maxYears,
  },
) {
  const id = suppliedId ?? caneIdFor({ sequence, cohort });
  const baseAngle = sequence * GOLDEN_ANGLE;
  const azimuth =
    baseAngle + randomRange(seed, [id, 'azimuth-jitter'], -0.26, 0.26);
  const crownRadius = randomRange(
    seed,
    [id, 'crown-radius'],
    0.02,
    LYNWOOD_PROFILE.cane.crownRadiusM,
  );
  const position = vector(
    Math.cos(azimuth) * crownRadius,
    0,
    Math.sin(azimuth) * crownRadius,
  );
  const targetHeightM = randomRange(
    seed,
    [id, 'height'],
    LYNWOOD_PROFILE.cane.targetHeightM[0],
    LYNWOOD_PROFILE.cane.targetHeightM[1],
  );
  const cane = {
    id,
    sequence,
    cohort,
    birthAgeYears,
    scheduledRemovalYear,
    naturalDeathAgeYears,
    position,
    azimuth,
    vigour: randomRange(seed, [id, 'vigour'], 0.3, 1),
    targetHeightM,
    height: targetHeightM,
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      LYNWOOD_PROFILE.cane.baseRadiusM[0],
      LYNWOOD_PROFILE.cane.baseRadiusM[1],
    ),
    axes: [],
  };
  const mainPoints = mainAxisPoints(seed, cane);
  const mainId = `${id}:axis:0`;
  const mainSourceYear = Math.floor(birthAgeYears);
  const mainAxisBirthAgeYears = Math.max(
    birthAgeYears,
    mainSourceYear + (LYNWOOD_CALENDAR.leafEmergenceStart - 1) / 365,
  );
  cane.axes.push(
    makeAxis(seed, {
      id: mainId,
      parentId: id,
      order: 0,
      birthAgeYears: mainAxisBirthAgeYears,
      azimuth,
      points: mainPoints,
      deathAgeYears: naturalDeathAgeYears,
      maxYears,
      growthDurationYears: LYNWOOD_PROFILE.cane.mainAxisGrowthDurationYears,
    }),
  );
  const lateralCount = randomInt(
    seed,
    [id, 'lateral-count'],
    LYNWOOD_PROFILE.cane.lateralAxisCount[0],
    LYNWOOD_PROFILE.cane.lateralAxisCount[1],
  );
  for (let index = 0; index < lateralCount; index += 1) {
    const lateral = sideAxisPoints(seed, {
      parentId: mainId,
      parentAzimuth: cane.azimuth,
      parentPoints: mainPoints,
      childIndex: index,
      childCount: lateralCount,
      axisClass: 'long-lateral',
    });
    const lateralTip = lateral.points[lateral.points.length - 1];
    const exposedOuterLateral =
      lateralTip.y / Math.max(0.1, targetHeightM) > 0.46 ||
      Math.hypot(lateralTip.x, lateralTip.z) /
        Math.max(0.1, LYNWOOD_PROFILE.architecture.matureRadiusM) >
        0.58;
    // Laterals are not a single cohort. A forsythia cane extends and branches
    // every season it is alive, and it is that steady supply of one-year wood
    // that keeps an established shrub flowering harder than a young one. Two
    // laterals are assigned to each year of the cane's productive life.
    const lateralCohortYear =
      1 + (index % Math.max(1, LYNWOOD_PROFILE.cane.productiveLifeYears));
    const lateralEmergenceDay = randomRange(
      seed,
      [id, 'lateral-birth', index],
      LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[0],
      LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[1],
    );
    const lateralBirthAgeYears =
      Math.floor(birthAgeYears) +
      lateralCohortYear +
      (lateralEmergenceDay - 1) / 365;
    if (
      lateralBirthAgeYears >= naturalDeathAgeYears ||
      lateralBirthAgeYears >= maxYears + 1
    ) {
      continue;
    }
    cane.axes.push(
      makeAxis(seed, {
        id: `${id}:axis:${index + 1}`,
        parentId: `${mainId}:node:${lateral.attachIndex - 1}`,
        order: 1,
        birthAgeYears: lateralBirthAgeYears,
        azimuth: lateral.azimuth,
        points: lateral.points,
        deathAgeYears: naturalDeathAgeYears,
        maxYears,
        growthDurationYears:
          LYNWOOD_PROFILE.cane.lateralAxisGrowthDurationYears,
      }),
    );

    // Second-order twigs. Most of a forsythia's flowering wood is not the cane
    // or even its main laterals but the short side twigs those laterals throw
    // the following season. Without them the shrub is a handful of long whips
    // and the bloom reads as speckles on bare sticks however many flowers each
    // node carries.
    const lateralId = `${id}:axis:${index + 1}`;
    const firstShortShootYear = Math.floor(lateralBirthAgeYears) + 1;
    const finalShortShootYear = Math.min(
      maxYears,
      scheduledRemovalYear - 1,
      Math.floor(naturalDeathAgeYears) - 1,
    );
    for (
      let formationYear = firstShortShootYear;
      formationYear <= finalShortShootYear;
      formationYear += 1
    ) {
      const cohortId = `${lateralId}:short:y${formationYear}`;
      const baseShootCount = randomInt(
        seed,
        [cohortId, 'count'],
        LYNWOOD_PROFILE.cane.annualShortShootCountPerLateral[0],
        LYNWOOD_PROFILE.cane.annualShortShootCountPerLateral[1],
      );
      // A minority of exposed outer laterals carries one more short flowering
      // spray. This fills real crown gaps without multiplying flowers on every
      // axis or rebuilding the cultivar as a solid yellow blob.
      const shootCount =
        baseShootCount +
        (exposedOuterLateral &&
        keyedRandom(seed, [cohortId, 'outer-extra-shoot']) < 0.4
          ? 1
          : 0);
      for (let shoot = 0; shoot < shootCount; shoot += 1) {
        const sub = sideAxisPoints(seed, {
          parentId: cohortId,
          parentAzimuth: lateral.azimuth,
          parentPoints: lateral.points,
          childIndex: shoot,
          childCount: shootCount,
          axisClass: 'short-shoot',
        });
        const shortShootEmergenceDay = randomRange(
          seed,
          [cohortId, 'birth', shoot],
          LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[0],
          LYNWOOD_RENDER_PRIORS.shootEmergenceDayRange[1],
        );
        const shortShootBirthAgeYears =
          formationYear + (shortShootEmergenceDay - 1) / 365;
        if (
          shortShootBirthAgeYears >= naturalDeathAgeYears ||
          shortShootBirthAgeYears >= maxYears + 1
        ) {
          continue;
        }
        cane.axes.push(
          makeAxis(seed, {
            id: `${cohortId}:${shoot}`,
            parentId: `${lateralId}:node:${sub.attachIndex - 1}`,
            order: 2,
            birthAgeYears: shortShootBirthAgeYears,
            azimuth: sub.azimuth,
            points: sub.points,
            // A short shoot is a brief flowering module, not another immortal
            // twig. Keep the flowering spring and following season, then let
            // younger cohorts replace its visual role on the parent lateral.
            deathAgeYears: Math.min(naturalDeathAgeYears, formationYear + 1.95),
            maxYears,
            growthDurationYears: LYNWOOD_PROFILE.cane.twigGrowthDurationYears,
          }),
        );
      }
    }
  }
  return calibrateCaneRadius(seed, cane);
}

function assertModelOptions(seed, maxYears) {
  if (!['string', 'number'].includes(typeof seed)) {
    throw new TypeError('seed must be a string or number');
  }
  if (!Number.isInteger(maxYears) || maxYears < 1 || maxYears > 50) {
    throw new RangeError('maxYears must be an integer from 1 to 50');
  }
}

/** Builds the absolute-year cane cohort schedule. Geometry stays lazy. */
export function createLynwoodModel({
  seed = 'lynwood-demo',
  maxYears = 50,
} = {}) {
  assertModelOptions(seed, maxYears);
  const canes = [];
  const architecture = LYNWOOD_PROFILE.architecture;
  const annualRenewalCount = architecture.annualRenewalShootCount;
  const firstRenewalYear = architecture.renewalStartsAfterYear + 1;
  const initialRemovalStartYear = LYNWOOD_PROFILE.cane.productiveLifeYears + 1;
  const naturalLifeYears = architecture.naturalCaneLifeYears;

  // The stool persists for the whole horizon. Its founding canes are renewed
  // away in annual post-flowering cohorts, while new basal shoots continue on
  // absolute years; no whole-plant modulo reset or organ-ID reuse is involved.
  for (let index = 0; index < architecture.initialCaneCount; index += 1) {
    canes.push(
      makeCaneDescriptor({
        sequence: index,
        cohort: 'initial',
        birthAgeYears: 0,
        scheduledRemovalYear:
          initialRemovalStartYear + Math.floor(index / annualRenewalCount),
        naturalDeathAgeYears: Math.min(maxYears + 1, naturalLifeYears),
      }),
    );
  }

  for (let year = firstRenewalYear; year <= maxYears; year += 1) {
    for (let shoot = 0; shoot < annualRenewalCount; shoot += 1) {
      const renewalKey = `lynwood:renewal:${year}:${shoot}`;
      const renewalEmergenceDay = randomRange(
        seed,
        [renewalKey, 'emergence-day'],
        LYNWOOD_PROFILE.growth.renewalEmergenceDayRange[0],
        LYNWOOD_PROFILE.growth.renewalEmergenceDayRange[1],
      );
      const birthAgeYears = year + (renewalEmergenceDay - 1) / 365;
      canes.push(
        makeCaneDescriptor({
          sequence: year * annualRenewalCount + shoot,
          cohort: 'renewal',
          birthAgeYears,
          // Retain the cane through its productive extension years and both
          // supported flowering ages, then renew it immediately after bloom.
          scheduledRemovalYear:
            year + LYNWOOD_PROFILE.cane.productiveLifeYears + 2,
          naturalDeathAgeYears: Math.min(
            maxYears + 1,
            birthAgeYears + naturalLifeYears,
          ),
        }),
      );
    }
  }

  const model = {
    schemaVersion: 2,
    kind: 'forsythia-growth-model',
    species: LYNWOOD_PROFILE.species,
    cultivar: LYNWOOD_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: LYNWOOD_PROFILE.metresPerUnit,
    canes,
  };
  // Schema 2 serialises only compact cohort descriptors. A non-enumerable
  // compatibility view keeps direct `cane.axes` inspection available without
  // making JSON/deep comparisons eagerly build fifty years of geometry.
  for (const descriptor of canes) {
    Object.defineProperty(descriptor, 'axes', {
      configurable: false,
      enumerable: false,
      get: () => materializeCane(model, descriptor).axes,
    });
  }
  return model;
}

// A 50-year timeline contains more than one hundred distinct cane identities,
// but only about fourteen coexist in a maintained stool. Materialise geometry
// for live canes on demand and retain a small LRU so A -> B -> A scrubbing is
// fast without turning the model into a permanent all-years organ warehouse.
const MATERIALIZED_CANE_CACHES = new WeakMap();

function materializeCane(model, descriptor) {
  let cache = MATERIALIZED_CANE_CACHES.get(model);
  if (!cache) {
    cache = new Map();
    MATERIALIZED_CANE_CACHES.set(model, cache);
  }
  if (cache.has(descriptor.id)) {
    const cached = cache.get(descriptor.id);
    cache.delete(descriptor.id);
    cache.set(descriptor.id, cached);
    return cached;
  }

  const cane = makeCane(model.seed, {
    ...descriptor,
    maxYears: model.maxYears,
  });
  cache.set(descriptor.id, cane);
  while (cache.size > LYNWOOD_RENDER_PRIORS.liveCaneCacheSize) {
    cache.delete(cache.keys().next().value);
  }
  return cane;
}

export function createPruneEvent({ id, caneId, ageYears, dayOfYear = 1 }) {
  if (!caneId) throw new TypeError('caneId is required for a prune event');
  if (!Number.isInteger(ageYears) || ageYears < 0) {
    throw new TypeError('ageYears must be a non-negative integer');
  }
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
    throw new RangeError('dayOfYear must be an integer from 1 to 365');
  }
  return {
    id: id ?? `prune:${caneId}:${ageYears}:${dayOfYear}`,
    type: 'prune',
    caneId,
    ageYears,
    dayOfYear,
  };
}

export const lynwoodEventTime = (event) => {
  const ageYears = Number(event?.ageYears ?? 0);
  const dayOfYear = Number(event?.dayOfYear ?? 1);
  return ageYears + (dayOfYear - 1) / 365;
};

function scaledPosition(position, origin, amount) {
  return add(
    origin,
    scale(
      vector(
        position.x - origin.x,
        position.y - origin.y,
        position.z - origin.z,
      ),
      amount,
    ),
  );
}

function vegetativeGrowthProgress(day, calendar = LYNWOOD_CALENDAR) {
  return smoothstep01(
    (day - calendar.leafEmergenceStart) /
      Math.max(1, calendar.autumnStart - calendar.leafEmergenceStart),
  );
}

function growthBirthOffsetYears(phenology) {
  return Number(phenology.offsetDays ?? 0) / 365;
}

function localFlowerState(cluster, day, calendar) {
  const anthesisDay = calendar.floweringStart + cluster.anthesisOffsetDays;
  const openDay = anthesisDay + LYNWOOD_RENDER_PRIORS.corollaOpeningDays;
  const endDay = anthesisDay + cluster.displayDurationDays;
  const budStart =
    calendar.budSwellingStart + Math.max(0, cluster.anthesisOffsetDays * 0.2);

  let budVisibility = 0;
  let openVisibility = 0;
  if (day >= budStart && day < openDay) {
    budVisibility = smoothstep01(
      (day - budStart) / Math.max(1, Math.min(9, anthesisDay - budStart)),
    );
  } else if (day >= openDay && day <= endDay) {
    const opening = smoothstep01((day - openDay + 0.35) / 1.5);
    const fadeStart = endDay - LYNWOOD_RENDER_PRIORS.corollaFadeDays;
    const fading =
      1 -
      smoothstep01(
        (day - fadeStart) / Math.max(1, LYNWOOD_RENDER_PRIORS.corollaFadeDays),
      );
    openVisibility = Math.min(opening, fading);
  }

  return {
    budVisibility,
    openVisibility,
    flowerVisibility: Math.max(budVisibility, openVisibility),
    progress: smoothstep01(
      (day - anthesisDay) /
        Math.max(1, LYNWOOD_RENDER_PRIORS.corollaOpeningDays),
    ),
  };
}

function localLeafProgress(seed, axisId, nodeId, day, calendar) {
  const axisOffset = randomRange(
    seed,
    [axisId, 'leaf-break-offset'],
    LYNWOOD_RENDER_PRIORS.leafBreakOffsetDays[0],
    LYNWOOD_RENDER_PRIORS.leafBreakOffsetDays[1],
  );
  const startDay =
    calendar.leafEmergenceStart +
    axisOffset +
    randomRange(seed, [nodeId, 'leaf-break-jitter'], -0.75, 0.75);
  const duration = randomRange(
    seed,
    [axisId, 'leaf-expansion-duration'],
    LYNWOOD_RENDER_PRIORS.leafExpansionDurationDays[0],
    LYNWOOD_RENDER_PRIORS.leafExpansionDurationDays[1],
  );
  return smoothstep01((day - startDay) / Math.max(1, duration));
}

function effectiveCaneBirthAge(cane, phenology) {
  return (
    cane.birthAgeYears +
    (cane.cohort === 'renewal' ? growthBirthOffsetYears(phenology) : 0)
  );
}

function effectiveAxisBirthAge(axis, cane, phenology) {
  const seasonalAxis = axis.order > 0 || cane.cohort === 'renewal';
  return (
    axis.birthAgeYears + (seasonalAxis ? growthBirthOffsetYears(phenology) : 0)
  );
}

function annualAxisGrowthScale(
  axis,
  currentYear,
  day,
  calendar = LYNWOOD_CALENDAR,
  birthAgeYears = axis.birthAgeYears,
) {
  const birthYear = Math.floor(birthAgeYears);
  if (currentYear > birthYear) return 1;
  if (currentYear < birthYear) return 0;
  const birthDay = Math.max(
    1,
    Math.min(365, Math.ceil((birthAgeYears - birthYear) * 365) + 1),
  );
  const start = vegetativeGrowthProgress(birthDay, calendar);
  const current = vegetativeGrowthProgress(day, calendar);
  return smoothstep01((current - start) / Math.max(0.001, 1 - start));
}

function evaluateCane(seed, cane, now, currentYear, phenology) {
  const caneBirthAgeYears = effectiveCaneBirthAge(cane, phenology);
  const caneAgeYears =
    currentYear -
    Math.floor(caneBirthAgeYears) +
    vegetativeGrowthProgress(phenology.dayOfYear, phenology.calendar);
  const growthScale = sampleAnchors(
    LYNWOOD_PROFILE.growth.caneAgeScaleAnchors,
    caneAgeYears,
  );
  const emergingRenewal =
    cane.cohort === 'renewal' && currentYear === Math.floor(caneBirthAgeYears);
  const primaryBirthAgeYears = effectiveAxisBirthAge(
    cane.axes[0],
    cane,
    phenology,
  );
  const emergenceScale = emergingRenewal
    ? annualAxisGrowthScale(
        cane.axes[0],
        currentYear,
        phenology.dayOfYear,
        phenology.calendar,
        primaryBirthAgeYears,
      )
    : 1;
  const visibleGrowthScale = growthScale * emergenceScale;
  const axes = [];

  for (const axis of cane.axes) {
    const axisBirthAgeYears = effectiveAxisBirthAge(axis, cane, phenology);
    if (axisBirthAgeYears > now || now >= axis.deathAgeYears) continue;
    const isPrimary = axis.order === 0;
    const axisGrowthScale = isPrimary
      ? visibleGrowthScale
      : annualAxisGrowthScale(
          axis,
          currentYear,
          phenology.dayOfYear,
          phenology.calendar,
          axisBirthAgeYears,
        );
    const sourceRoot = isPrimary ? cane.position : axis.points[0];
    const grownRoot = isPrimary
      ? cane.position
      : scaledPosition(sourceRoot, cane.position, visibleGrowthScale);
    const transformAxisPoint = (position) =>
      isPrimary
        ? scaledPosition(position, cane.position, visibleGrowthScale)
        : add(
            grownRoot,
            scale(
              vector(
                position.x - sourceRoot.x,
                position.y - sourceRoot.y,
                position.z - sourceRoot.z,
              ),
              axisGrowthScale,
            ),
          );

    const nodes = [];
    for (const node of axis.nodes) {
      const nodeBirthAgeYears =
        node.birthAgeYears + (axisBirthAgeYears - axis.birthAgeYears);
      if (nodeBirthAgeYears > now) continue;
      const nodePosition = transformAxisPoint(node.position);
      const organScale = isPrimary ? visibleGrowthScale : axisGrowthScale;

      const leaves = [];
      const nodeLeafProgress = localLeafProgress(
        seed,
        axis.id,
        node.id,
        phenology.dayOfYear,
        phenology.calendar,
      );
      const lowerOldMainWood =
        isPrimary &&
        currentYear - Math.floor(caneBirthAgeYears) >= 2 &&
        node.positionAlongAxis < 0.62;
      for (const leaf of lowerOldMainWood ? [] : node.leaves) {
        const unfoldProgress = clamp(nodeLeafProgress, 0, 1);
        leaves.push({
          id: leaf.id,
          side: leaf.side,
          visible: phenology.leafOpacity > 0.02 && unfoldProgress > 0.015,
          unfoldProgress,
          position: transformAxisPoint(leaf.position),
          normal: leaf.normal,
          scale: leaf.lengthM * organScale * lerp(0.35, 1, unfoldProgress),
          sourceLength: leaf.lengthM,
          widthM: leaf.widthM,
        });
      }

      const clusters = [];
      for (const cluster of node.clusters) {
        if (cluster.floweringYear !== currentYear) continue;
        const flowerState = localFlowerState(
          cluster,
          phenology.dayOfYear,
          phenology.calendar,
        );
        const capsuleVisible =
          cluster.capsule != null && phenology.capsuleVisibility > 0.02;
        clusters.push({
          id: cluster.id,
          woodAgeYears: cluster.woodAgeYears,
          visible: flowerState.flowerVisibility > 0.015 || capsuleVisible,
          flowerVisibility: flowerState.flowerVisibility,
          flowerBudVisibility: flowerState.budVisibility,
          flowerOpenVisibility: flowerState.openVisibility,
          flowerProgress: flowerState.progress,
          capsuleVisibility: capsuleVisible ? phenology.capsuleVisibility : 0,
          capsuleMaturity: phenology.capsuleMaturity,
          flowers: cluster.flowers.map((flower) => ({
            id: flower.id,
            index: flower.index,
            position: transformAxisPoint(flower.position),
            direction: flower.direction,
            corollaWidthM: flower.corollaWidthM,
            tubeLengthM: flower.tubeLengthM,
            roll: flower.roll,
            budVisibility: flowerState.budVisibility,
            openVisibility: flowerState.openVisibility,
            openProgress: flowerState.progress,
          })),
          capsule: cluster.capsule
            ? {
                id: cluster.capsule.id,
                position: transformAxisPoint(cluster.capsule.position),
                direction: cluster.capsule.direction,
                lengthM: cluster.capsule.lengthM,
              }
            : null,
        });
      }

      nodes.push({
        id: node.id,
        index: node.index,
        position: nodePosition,
        tangent: node.tangent,
        azimuth: node.azimuth,
        leaves,
        clusters,
      });
    }

    axes.push({
      id: axis.id,
      order: axis.order,
      parentId: axis.parentId,
      sourcePoints: axis.points,
      sourceNodes: axis.nodes,
      root: grownRoot,
      growthScale: axisGrowthScale,
      nodes,
    });
  }

  return {
    id: cane.id,
    cohort: cane.cohort,
    birthAgeYears: cane.birthAgeYears,
    ageYears: caneAgeYears,
    growthScale: visibleGrowthScale,
    position: cane.position,
    baseRadiusM: cane.baseRadiusM,
    targetHeightM: cane.targetHeightM,
    removed: false,
    axes,
  };
}

function snapshotDimensions(canes) {
  let height = 0;
  let radius = 0;
  for (const cane of canes) {
    if (cane.removed) continue;
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        height = Math.max(height, node.position.y);
        radius = Math.max(radius, Math.hypot(node.position.x, node.position.z));
      }
    }
  }
  return {
    heightM: height,
    radiusM: radius,
    spreadM: radius * 2,
  };
}

function snapshotStats(canes, phenology) {
  let visibleLeaves = 0;
  let visibleFlowers = 0;
  let visibleFlowerBuds = 0;
  let visibleCapsules = 0;
  let floweringNodes = 0;

  for (const cane of canes) {
    if (cane.removed) continue;
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        for (const leaf of node.leaves) {
          if (leaf.visible) visibleLeaves++;
        }
        for (const cluster of node.clusters) {
          if (!cluster.visible) continue;
          let flowering = false;
          for (const flower of cluster.flowers) {
            if (flower.openVisibility > 0.015) {
              visibleFlowers++;
              flowering = true;
            } else if (flower.budVisibility > 0.015) {
              visibleFlowerBuds++;
              flowering = true;
            }
          }
          if (flowering) floweringNodes++;
          if (cluster.capsule && cluster.capsuleVisibility > 0.02) {
            visibleCapsules++;
          }
        }
      }
    }
  }

  return {
    visibleCanes: canes.filter((cane) => !cane.removed).length,
    visibleLeaves,
    visibleFlowers,
    visibleFlowerBuds,
    visibleCapsules,
    floweringNodes,
    bareWoodFlowering: phenology.bareWoodFlowering && visibleFlowers > 0,
  };
}

function automaticRemovalTime(cane, calendar) {
  const day =
    calendar.floweringEnd +
    LYNWOOD_PROFILE.management.automaticRenewalDelayDays;
  if (day > LYNWOOD_PROFILE.management.latestSafePruningDay) {
    throw new RangeError(
      'Automatic Forsythia renewal falls outside the safe pruning window.',
    );
  }
  return cane.scheduledRemovalYear + (day - 1) / 365;
}

/**
 * Evaluates the immutable graph at a year/day without mutating history. Moving
 * A -> B -> A therefore recreates byte-equivalent organ IDs and coordinates.
 */
export function evaluateLynwoodModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 100,
    events = [],
    region = 'central',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'forsythia-growth-model') {
    throw new TypeError('Expected a model returned by createLynwoodModel');
  }
  if (model.schemaVersion !== 2) {
    throw new RangeError(
      'Unsupported Forsythia model schema; rebuild it with createLynwoodModel.',
    );
  }
  if (
    !Number.isInteger(ageYears) ||
    ageYears < 0 ||
    ageYears > model.maxYears
  ) {
    throw new RangeError(
      `ageYears must be an integer between 0 and ${model.maxYears}`,
    );
  }
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }

  const phenology = getLynwoodPhenology(dayOfYear, { region, offsetDays });
  const now = ageYears + (phenology.dayOfYear - 1) / 365;
  const currentYear = ageYears;
  const appliedEvents = events
    .filter((event) => lynwoodEventTime(event) <= now)
    .slice()
    .sort(
      (a, b) =>
        lynwoodEventTime(a) - lynwoodEventTime(b) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const prunedCanes = new Set(
    appliedEvents
      .filter((event) => event.type === 'prune')
      .map((event) => event.caneId),
  );

  const evaluatedCanes = model.canes
    .filter((cane) => {
      // Canes always leave on the pruning schedule: this library models
      // plants that are looked after, never ones left to run wild.
      const removalAgeYears = automaticRemovalTime(cane, phenology.calendar);
      return (
        effectiveCaneBirthAge(cane, phenology) <= now && now < removalAgeYears
      );
    })
    .map((descriptor) =>
      evaluateCane(
        model.seed,
        materializeCane(model, descriptor),
        now,
        currentYear,
        phenology,
      ),
    );
  const canes = evaluatedCanes.filter((cane) => !prunedCanes.has(cane.id));

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    ageYears,
    dayOfYear: phenology.dayOfYear,
    dimensions: snapshotDimensions(canes),
    phenology,
    careHints: getLynwoodCareHints(phenology.dayOfYear, {
      plantAgeYears: ageYears,
      region,
      offsetDays,
    }),
    canes,
    stats: snapshotStats(canes, phenology),
    appliedEvents: appliedEvents.map((event) => event.id),
  };
}
