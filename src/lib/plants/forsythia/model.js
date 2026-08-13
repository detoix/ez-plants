import {
  LYNWOOD_CALENDAR,
  getLynwoodCareHints,
  getLynwoodPhenology,
} from './phenology.js';
import { LYNWOOD_PROFILE } from './lynwood.js';
import * as THREE from 'three';
import RNG from '../../rng.js';
import { growWoodyAxis } from '../../woody-axis.js';
import {
  keyedInteger as randomInt,
  keyedRandom,
  keyedRange as randomRange,
} from '../../keyed-random.js';

const TAU = Math.PI * 2;

/**
 * EZ-Tree's branch model consumes a sequential RNG, while this model is keyed
 * so any organ can be regenerated in isolation. Deriving the axis seed from
 * the organ key keeps both: the graph is built once, and rebuilding it from
 * the same seed reproduces every cane exactly.
 */
const caneRngSeed = (seed, caneId) =>
  Math.floor(keyedRandom(seed, caneId, 'axis-rng') * 0xffffffff);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const vector = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => vector(a.x + b.x, a.y + b.y, a.z + b.z);
const scale = (value, amount) =>
  vector(value.x * amount, value.y * amount, value.z * amount);
const length = (value) => Math.hypot(value.x, value.y, value.z);
const normalize = (value) => {
  const magnitude = length(value) || 1;
  return scale(value, 1 / magnitude);
};
const lerp = (a, b, amount) => a + (b - a) * amount;

function sampleAnchors(anchors, value) {
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [endAge, endValue] = anchors[index];
    const [startAge, startValue] = anchors[index - 1];
    if (value <= endAge) {
      return lerp(
        startValue,
        endValue,
        (value - startAge) / Math.max(0.0001, endAge - startAge),
      );
    }
  }
  return anchors.at(-1)[1];
}

function tangentAt(points, index) {
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  return normalize(
    vector(after.x - before.x, after.y - before.y, after.z - before.z),
  );
}

/**
 * The 'Lynwood' cane: stiff and upright for most of its length, then arching
 * outward and drooping near the tip. The outward reach is driven by
 * architecture.archFraction rather than the blackcurrant's shallow lean, and
 * it is deliberately back-loaded (t^2.1) so the lower cane stays erect.
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

  // Canes lean outward a little at the crown before the force takes over.
  const lean = randomRange(seed, [cane.id, 'lean'], 0.06, 0.2);
  const orientation = new THREE.Euler(
    Math.sin(cane.azimuth) * lean,
    keyedRandom(seed, cane.id, 'sway-phase') * TAU,
    -Math.cos(cane.azimuth) * lean,
  );

  const sections = growWoodyAxis({
    origin: new THREE.Vector3(
      cane.position.x,
      cane.position.y,
      cane.position.z,
    ),
    orientation,
    // The cane's arc is longer than its final height, because the arch trades
    // height for reach.
    length: cane.targetHeightM * architecture.caneArcLengthFactor,
    radius: cane.baseRadiusM,
    sectionCount: count,
    gnarliness: architecture.caneGnarliness,
    taper: LYNWOOD_PROFILE.cane.axisTaperRatios[1],
    force: {
      direction: new THREE.Vector3(outward.x, -architecture.archDrop, outward.z),
      // Force is applied once per section, so without normalising by the
      // section count a denser cane would arch further for the same strength
      // and node spacing would silently change the plant's habit.
      strength:
        ((architecture.caneForceStrength * architecture.caneReferenceSections) /
          count) *
        randomRange(seed, [cane.id, 'arch'], 0.78, 1.26),
    },
    rng: new RNG(caneRngSeed(seed, cane.id)),
  });

  return sections.map((section) =>
    vector(section.origin.x, section.origin.y, section.origin.z),
  );
}

function lateralAxisPoints(seed, cane, mainPoints, lateralIndex, lateralCount) {
  const attachFraction = clamp(
    0.24 +
      ((lateralIndex +
        randomRange(seed, [cane.id, 'attach-jitter', lateralIndex], 0.2, 0.8)) /
        Math.max(1, lateralCount)) *
        0.66,
    0.2,
    0.92,
  );
  const attachIndex = clamp(
    Math.round(attachFraction * (mainPoints.length - 1)),
    2,
    mainPoints.length - 3,
  );
  const origin = mainPoints[attachIndex];
  const side = lateralIndex % 2 === 0 ? -1 : 1;
  const azimuth =
    cane.azimuth +
    side *
      randomRange(seed, [cane.id, 'lateral-angle', lateralIndex], 0.5, 1.24) +
    lateralIndex * 0.11;
  const horizontal = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const axisLength = randomRange(
    seed,
    [cane.id, 'lateral-length', lateralIndex],
    0.26,
    0.52 - attachFraction * 0.16,
  );
  const count = randomInt(
    seed,
    [cane.id, 'lateral-node-count', lateralIndex],
    10,
    16,
  );
  const rise = randomRange(
    seed,
    [cane.id, 'lateral-rise', lateralIndex],
    0.5,
    0.86,
  );
  const distalDroop = randomRange(
    seed,
    [cane.id, 'lateral-droop', lateralIndex],
    0.12,
    0.34,
  );
  const curveSide = vector(-horizontal.z, 0, horizontal.x);
  const sideCurve = randomRange(
    seed,
    [cane.id, 'lateral-side-curve', lateralIndex],
    -0.14,
    0.14,
  );
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    points.push(
      add(
        origin,
        add(
          scale(horizontal, axisLength * t),
          add(
            scale(curveSide, Math.sin(t * Math.PI) * axisLength * sideCurve),
            vector(0, axisLength * (rise * t - distalDroop * t * t), 0),
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
function makeLeafPair(seed, node, year) {
  const leaf = LYNWOOD_PROFILE.leaf;
  const decussateTurn = node.index * leaf.decussateTurnRadians;
  const leaves = [];

  for (let side = 0; side < leaf.leavesPerNode; side += 1) {
    const id = `${node.id}:leaf:y${year}:${side}`;
    const azimuth =
      node.azimuth +
      decussateTurn +
      side * Math.PI +
      randomRange(seed, [id, 'azimuth-jitter'], -0.12, 0.12);
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
    const bladeRoll = randomRange(seed, [id, 'blade-roll'], -0.24, 0.24);
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
      year,
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
  // Sources give 1-6 flowers per leaf-scar. Prime one-year wood in full bloom
  // sits at the top of that range -- that density is what makes the shrub read
  // as a sheet of yellow rather than dots on sticks -- while two-year wood
  // carries a lighter second flush.
  const [minPerNode, maxPerNode] = flower.perNodeRange;
  const count =
    woodAgeYears === 1
      ? randomInt(
          seed,
          [id, 'count'],
          Math.ceil((minPerNode + maxPerNode) / 2),
          maxPerNode,
        )
      : randomInt(
          seed,
          [id, 'count'],
          minPerNode,
          Math.max(minPerNode, maxPerNode - 2),
        );
  const flowers = [];
  const decussateTurn = node.index * LYNWOOD_PROFILE.leaf.decussateTurnRadians;

  for (let index = 0; index < count; index += 1) {
    const flowerId = `${id}:f${index}`;
    // Flowers ring the stem at the node, biased to the two leaf-scar sides.
    const scarSide = index % 2 === 0 ? 0 : Math.PI;
    const azimuth =
      node.azimuth +
      decussateTurn +
      scarSide +
      randomRange(seed, [flowerId, 'azimuth'], -0.85, 0.85);
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
    const nod = randomRange(seed, [flowerId, 'nod'], 0.35, 0.95);
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
        node.position,
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
    index,
    birthAgeYears:
      axis.birthAgeYears + (index / Math.max(1, axis.pointCount - 1)) * 0.34,
    position,
    tangent,
    azimuth: axis.azimuth,
    leaves: [],
    clusters: [],
  };
  const firstLeafYear = Math.floor(axis.birthAgeYears);
  const finalYear = Math.min(Math.ceil(deathAgeYears), maxYears + 1);

  for (let year = firstLeafYear; year < finalYear; year += 1) {
    node.leaves.push(...makeLeafPair(seed, node, year));
  }

  // The rule that defines this plant: buds set on wood grown in year Y open in
  // the spring of year Y+1, and a lighter second flush in Y+2. Nothing flowers
  // on the year's own new growth, which is exactly why pruning must follow
  // flowering rather than precede it.
  // A cane is not one age. It extends every season, so the wood at its tip is
  // young while the wood at its base is old. Flowering therefore sweeps
  // outward along the cane year by year instead of switching the whole cane
  // on and then off, which left long bare stretches on the main stems.
  const positionAlongAxis = (index + 1) / Math.max(1, axis.pointCount - 1);
  // Every living cane puts on a new increment at its tip each season, so the
  // gradient spans the cane's whole life rather than a fixed number of years.
  // That way a band of one- and two-year-old wood exists on EVERY cane at
  // every age, which is why an established forsythia flowers all over instead
  // of only on whichever canes happen to be the right age.
  const extensionYears = LYNWOOD_PROFILE.cane.productiveLifeYears;
  const woodYear = Math.floor(
    axis.birthAgeYears + positionAlongAxis * extensionYears,
  );
  const bearsFlowers =
    index >= 1 && keyedRandom(seed, node.id, 'flowering-node') > 0.06;
  if (bearsFlowers) {
    for (const woodAgeYears of LYNWOOD_PROFILE.flower.bornOnWoodAgeYears) {
      const floweringYear = woodYear + woodAgeYears;
      if (floweringYear >= finalYear || floweringYear > maxYears + 1) continue;
      node.clusters.push(
        makeFlowerCluster(seed, node, floweringYear, woodAgeYears),
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
  const shell = {
    id,
    parentId,
    order,
    birthAgeYears,
    azimuth,
    pointCount: points.length,
    growthDurationYears,
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

function makeCane(
  seed,
  {
    cycleIndex,
    sequence,
    cohort,
    birthAgeYears,
    scheduledRemovalAgeYears,
    naturalDeathAgeYears,
    maxYears,
  },
) {
  const id = `lynwood:c${cycleIndex}:cane:${cohort}:${String(sequence).padStart(2, '0')}`;
  const baseAngle =
    (sequence / LYNWOOD_PROFILE.architecture.initialCaneCount) * TAU +
    cycleIndex * 0.53;
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
    cycleIndex,
    sequence,
    cohort,
    birthAgeYears,
    scheduledRemovalAgeYears,
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
  cane.axes.push(
    makeAxis(seed, {
      id: mainId,
      parentId: id,
      order: 0,
      birthAgeYears,
      azimuth,
      points: mainPoints,
      deathAgeYears: naturalDeathAgeYears,
      maxYears,
    }),
  );
  const lateralCount = randomInt(
    seed,
    [id, 'lateral-count'],
    LYNWOOD_PROFILE.cane.lateralAxisCount[0],
    LYNWOOD_PROFILE.cane.lateralAxisCount[1],
  );
  for (let index = 0; index < lateralCount; index += 1) {
    const lateral = lateralAxisPoints(
      seed,
      cane,
      mainPoints,
      index,
      lateralCount,
    );
    // Laterals are not a single cohort. A forsythia cane extends and branches
    // every season it is alive, and it is that steady supply of one-year wood
    // that keeps an established shrub flowering harder than a young one. Two
    // laterals are assigned to each year of the cane's productive life.
    const lateralCohortYear =
      1 + (index % Math.max(1, LYNWOOD_PROFILE.cane.productiveLifeYears));
    const lateralBirthAgeYears =
      birthAgeYears +
      lateralCohortYear +
      randomRange(seed, [id, 'lateral-birth', index], 0.24, 0.34);
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
      }),
    );

    // Second-order twigs. Most of a forsythia's flowering wood is not the cane
    // or even its main laterals but the short side twigs those laterals throw
    // the following season. Without them the shrub is a handful of long whips
    // and the bloom reads as speckles on bare sticks however many flowers each
    // node carries.
    const lateralId = `${id}:axis:${index + 1}`;
    const twigCount = randomInt(seed, [lateralId, 'twig-count'], 2, 4);
    for (let twig = 0; twig < twigCount; twig += 1) {
      const sub = lateralAxisPoints(
        seed,
        cane,
        lateral.points,
        twig,
        twigCount,
      );
      const twigBirthAgeYears =
        lateralBirthAgeYears +
        1 +
        randomRange(seed, [lateralId, 'twig-birth', twig], 0.1, 0.3);
      if (
        twigBirthAgeYears >= naturalDeathAgeYears ||
        twigBirthAgeYears >= maxYears + 1
      ) {
        continue;
      }
      cane.axes.push(
        makeAxis(seed, {
          id: `${lateralId}:twig:${twig}`,
          parentId: `${lateralId}:node:${sub.attachIndex - 1}`,
          order: 2,
          birthAgeYears: twigBirthAgeYears,
          azimuth: sub.azimuth,
          // Twigs are short: a fraction of the lateral that bore them.
          points: sub.points.map((point) =>
            add(
              sub.points[0],
              scale(
                vector(
                  point.x - sub.points[0].x,
                  point.y - sub.points[0].y,
                  point.z - sub.points[0].z,
                ),
                0.44,
              ),
            ),
          ),
          deathAgeYears: naturalDeathAgeYears,
          maxYears,
        }),
      );
    }
  }
  return cane;
}

function assertModelOptions(seed, maxYears) {
  if (!['string', 'number'].includes(typeof seed)) {
    throw new TypeError('seed must be a string or number');
  }
  if (!Number.isInteger(maxYears) || maxYears < 1 || maxYears > 50) {
    throw new RangeError('maxYears must be an integer from 1 to 50');
  }
}

/** Builds the stable all-years organ graph once. */
export function createLynwoodModel({
  seed = 'lynwood-demo',
  maxYears = 50,
} = {}) {
  assertModelOptions(seed, maxYears);
  const canes = [];
  const architecture = LYNWOOD_PROFILE.architecture;
  const cycleYears = architecture.replacementCycleYears;

  for (let cycleStart = 0; cycleStart <= maxYears; cycleStart += cycleYears) {
    const cycleIndex = cycleStart / cycleYears;
    const cycleEnd = cycleStart + cycleYears;
    for (let index = 0; index < architecture.initialCaneCount; index += 1) {
      canes.push(
        makeCane(seed, {
          cycleIndex,
          sequence: index,
          cohort: 'initial',
          birthAgeYears: cycleStart,
          // RHS renewal takes up to a fifth of the oldest stems every year, so the
          // founding canes are worked out over about one productive life rather
          // than lingering for a decade as unflowering old wood.
          scheduledRemovalAgeYears: Math.min(
            cycleEnd,
            cycleStart + 4 + index * 0.62,
          ),
          naturalDeathAgeYears: cycleEnd,
          maxYears,
        }),
      );
    }

    for (
      let localYear = architecture.renewalStartsAfterYear + 1;
      localYear < cycleYears && cycleStart + localYear <= maxYears;
      localYear += 1
    ) {
      // A vigorous, rapidly growing shrub throws more than one basal shoot a
      // season. Two per year keeps the maintained stool inside the 7-14 stem
      // range while replacing what post-flowering renewal takes out.
      for (let shoot = 0; shoot < 2; shoot += 1) {
        const renewalKey = `lynwood:c${cycleIndex}:renewal:${localYear}:${shoot}`;
        const renewalEmergenceDay = randomRange(
          seed,
          [renewalKey, 'emergence-day'],
          LYNWOOD_PROFILE.growth.renewalEmergenceDayRange[0],
          LYNWOOD_PROFILE.growth.renewalEmergenceDayRange[1],
        );
        canes.push(
          makeCane(seed, {
            cycleIndex,
            sequence: localYear * 2 + shoot,
            cohort: 'renewal',
            birthAgeYears:
              cycleStart + localYear + (renewalEmergenceDay - 1) / 365,
            scheduledRemovalAgeYears: Math.min(
              cycleEnd,
              cycleStart +
                localYear +
                LYNWOOD_PROFILE.cane.productiveLifeYears +
                1,
            ),
            naturalDeathAgeYears: cycleEnd,
            maxYears,
          }),
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    kind: 'forsythia-growth-model',
    species: LYNWOOD_PROFILE.species,
    cultivar: LYNWOOD_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: LYNWOOD_PROFILE.metresPerUnit,
    canes,
  };
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

function smoothstep01(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
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
    if (axisBirthAgeYears > now) continue;
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
      const nodePosition = transformAxisPoint(node.position);
      const organScale = isPrimary ? visibleGrowthScale : axisGrowthScale;

      const leaves = [];
      for (const leaf of node.leaves) {
        if (leaf.year !== currentYear) continue;
        const unfoldProgress = clamp(phenology.leafProgress, 0, 1);
        leaves.push({
          id: leaf.id,
          side: leaf.side,
          visible: phenology.leafOpacity > 0.02,
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
        const capsuleVisible =
          cluster.capsule != null && phenology.capsuleVisibility > 0.02;
        clusters.push({
          id: cluster.id,
          woodAgeYears: cluster.woodAgeYears,
          visible: phenology.flowerVisibility > 0.015 || capsuleVisible,
          flowerVisibility: phenology.flowerVisibility,
          flowerBudVisibility: phenology.flowerBudVisibility,
          flowerOpenVisibility: phenology.flowerOpenVisibility,
          flowerProgress: phenology.flowerProgress,
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
          if (cluster.flowerVisibility > 0.015) {
            floweringNodes++;
            if (cluster.flowerOpenVisibility > 0.015) {
              visibleFlowers += cluster.flowers.length;
            } else {
              visibleFlowerBuds += cluster.flowers.length;
            }
          }
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
    bareWoodFlowering: phenology.bareWoodFlowering,
  };
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
    scenario = 'maintained',
    region = 'central',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'forsythia-growth-model') {
    throw new TypeError('Expected a model returned by createLynwoodModel');
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
  if (scenario !== 'maintained' && scenario !== 'neglected') {
    throw new RangeError("scenario must be 'maintained' or 'neglected'");
  }
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }

  const phenology = getLynwoodPhenology(dayOfYear, { region, offsetDays });
  const now = ageYears + (phenology.dayOfYear - 1) / 365;
  const currentYear = Math.floor(ageYears);
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
      const removalAgeYears =
        scenario === 'maintained'
          ? cane.scheduledRemovalAgeYears
          : cane.naturalDeathAgeYears;
      return (
        effectiveCaneBirthAge(cane, phenology) <= now && now < removalAgeYears
      );
    })
    .map((cane) => evaluateCane(model.seed, cane, now, currentYear, phenology));
  const canes = evaluatedCanes.filter((cane) => !prunedCanes.has(cane.id));
  const cycleYears = LYNWOOD_PROFILE.architecture.replacementCycleYears;
  const cycleAgeYears = ageYears % cycleYears;

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    scenario,
    ageYears,
    dayOfYear: phenology.dayOfYear,
    cycleIndex: Math.floor(ageYears / cycleYears),
    cycleAgeYears,
    dimensions: snapshotDimensions(canes),
    phenology,
    careHints: getLynwoodCareHints(phenology.dayOfYear, {
      plantAgeYears: cycleAgeYears,
      region,
      offsetDays,
    }),
    canes,
    stats: snapshotStats(canes, phenology),
    appliedEvents: appliedEvents.map((event) => event.id),
  };
}
