import * as THREE from 'three';
import { growWoodyAxis } from '../../woody-axis.js';
import {
  keyedInteger as randomInt,
  keyedRandom,
  keyedRange as randomRange,
} from '../../keyed-random.js';
import {
  add,
  axisRng,
  clamp,
  clamp01,
  deepFreeze,
  lerp,
  normalize,
  orientationFor,
  progress,
  sampleAnchors,
  scale,
  smoothstep01,
  subtract,
  tangentAt,
  TAU,
  vector,
} from '../../model-math.js';
import { getLimelightCareHints, getLimelightPhenology } from './phenology.js';
import { LIMELIGHT_PROFILE, LIMELIGHT_SOURCES } from './limelight.js';

function growAxisPoints(
  seed,
  {
    id,
    origin,
    direction,
    forceDirection,
    axisLength,
    baseRadius,
    sectionCount,
    gnarliness,
    forceStrength,
  },
) {
  const sections = growWoodyAxis({
    origin: new THREE.Vector3(origin.x, origin.y, origin.z),
    orientation: orientationFor(direction),
    length: axisLength,
    radius: baseRadius,
    sectionCount,
    gnarliness,
    taper: LIMELIGHT_PROFILE.cane.axisTaperRatios[1],
    force: {
      direction: new THREE.Vector3(
        forceDirection.x,
        forceDirection.y,
        forceDirection.z,
      ),
      // Normalise for point density: changing internode sampling must not
      // silently change the habit of the plant.
      strength: (forceStrength * 28) / sectionCount,
    },
    rng: axisRng(seed, id),
  });
  return sections.map((section) =>
    vector(section.origin.x, section.origin.y, section.origin.z),
  );
}

function mainAxisPoints(seed, cane) {
  const id = `${cane.id}:axis:0`;
  const sectionCount = randomInt(
    seed,
    [id, 'node-count'],
    LIMELIGHT_PROFILE.cane.mainAxisNodeCount[0],
    LIMELIGHT_PROFILE.cane.mainAxisNodeCount[1],
  );
  const outward = vector(Math.cos(cane.azimuth), 0, Math.sin(cane.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const lean = randomRange(seed, [id, 'lean'], 0.1, 0.25);
  const sideLean = randomRange(seed, [id, 'side-lean'], -0.06, 0.06);
  const direction = normalize(
    add(vector(0, 1, 0), add(scale(outward, lean), scale(sideways, sideLean))),
  );
  const forceDirection = normalize(
    add(
      vector(0, 1, 0),
      scale(outward, randomRange(seed, [id, 'spread'], 0.2, 0.43)),
    ),
  );

  return growAxisPoints(seed, {
    id,
    origin: cane.position,
    direction,
    forceDirection,
    // The profile's 1.65 m measured display includes the 15-25 cm cone and
    // its long peduncle, so the woody axis must finish appreciably below it.
    axisLength: cane.targetHeightM * 0.82,
    baseRadius: cane.baseRadiusM,
    sectionCount,
    gnarliness: 0.0016,
    forceStrength: 0.000035,
  });
}

function childAxisPoints(
  seed,
  cane,
  parent,
  childId,
  childIndex,
  childCount,
  order,
) {
  const lower = order === 1 ? 0.2 : 0.22;
  const upper = order === 1 ? 0.79 : 0.83;
  const attachFraction = clamp(
    lower +
      ((childIndex + randomRange(seed, [childId, 'attach-jitter'], 0.2, 0.8)) /
        Math.max(1, childCount)) *
        (upper - lower),
    lower,
    upper,
  );
  const attachIndex = clamp(
    Math.round(attachFraction * (parent.points.length - 1)),
    2,
    parent.points.length - 2,
  );
  const origin = parent.points[attachIndex];
  const side = childIndex % 2 === 0 ? -1 : 1;
  const azimuth =
    cane.azimuth +
    side *
      randomRange(
        seed,
        [childId, 'azimuth-spread'],
        order === 1 ? 0.5 : 0.42,
        order === 1 ? 1.33 : 1.02,
      ) +
    childIndex * 0.19;
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const parentTangent = tangentAt(parent.points, attachIndex);
  const rise = randomRange(
    seed,
    [childId, 'rise'],
    order === 1 ? 0.55 : 0.42,
    order === 1 ? 0.9 : 0.78,
  );
  const direction = normalize(
    add(
      scale(outward, 1),
      add(vector(0, rise, 0), scale(parentTangent, order === 1 ? 0.18 : 0.1)),
    ),
  );
  const axisLength = randomRange(
    seed,
    [childId, 'length'],
    order === 1 ? 0.34 : 0.2,
    order === 1 ? 0.68 - attachFraction * 0.12 : 0.36,
  );
  const sectionCount = randomInt(
    seed,
    [childId, 'node-count'],
    order === 1 ? 8 : 5,
    order === 1 ? 12 : 7,
  );
  const radiusFactor =
    order === 1
      ? LIMELIGHT_PROFILE.cane.axisRadiusFactors.lateral
      : LIMELIGHT_PROFILE.cane.axisRadiusFactors.higherOrder;
  const forceDirection = normalize(add(vector(0, 0.82, 0), outward));
  const points = growAxisPoints(seed, {
    id: childId,
    origin,
    direction,
    forceDirection,
    axisLength,
    baseRadius: cane.baseRadiusM * radiusFactor,
    sectionCount,
    gnarliness: order === 1 ? 0.00085 : 0.00055,
    forceStrength: order === 1 ? 0.000022 : 0.000013,
  });

  return { points, attachIndex, azimuth };
}

/**
 * One opposite leaf pair (occasionally a whorl of three at a vigorous tip).
 * Successive pairs turn 90 degrees, reproducing Hydrangea's decussate ranks.
 */
function makeLeaves(seed, axis, node) {
  const leaf = LIMELIGHT_PROFILE.leaf;
  const nearTip = node.index >= axis.pointCount * 0.82;
  const leafCount =
    nearTip && keyedRandom(seed, node.id, 'tip-whorl') < 0.075 ? 3 : 2;
  const leaves = [];
  const nodeTurn = node.index * leaf.decussateTurnRadians;

  for (let side = 0; side < leafCount; side += 1) {
    const id = `${node.id}:leaf:${side}`;
    const aroundTurn = leafCount === 3 ? (side * TAU) / 3 : side * Math.PI;
    const azimuth =
      axis.azimuth +
      nodeTurn +
      aroundTurn +
      randomRange(seed, [id, 'azimuth-jitter'], -0.1, 0.1);
    const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
    const sideways = vector(-outward.z, 0, outward.x);
    const petioleLengthM = randomRange(
      seed,
      [id, 'petiole-length'],
      leaf.petioleLengthM[0],
      leaf.petioleLengthM[1],
    );
    const bladePosition = add(
      node.position,
      add(scale(outward, petioleLengthM), vector(0, 0.004, 0)),
    );
    const bladeTilt = randomRange(seed, [id, 'blade-tilt'], 0.38, 0.82);
    const bladeRoll = randomRange(seed, [id, 'blade-roll'], -0.22, 0.22);
    const bladeDroop = randomRange(seed, [id, 'blade-droop'], -0.2, 0.06);
    const lengthM = randomRange(
      seed,
      [id, 'length'],
      leaf.lengthM[0],
      leaf.lengthM[1],
    );
    const widthM = clamp(
      lengthM * randomRange(seed, [id, 'aspect'], 0.45, 0.55),
      leaf.widthM[0],
      leaf.widthM[1],
    );

    leaves.push({
      id,
      side,
      position: bladePosition,
      normal: normalize(
        add(
          vector(0, 1 + bladeDroop, 0),
          add(scale(outward, bladeTilt), scale(sideways, bladeRoll)),
        ),
      ),
      azimuth,
      lengthM,
      widthM,
      petioleLengthM,
    });
  }

  return leaves;
}

function makeTerminalPanicle(seed, axis) {
  const profile = LIMELIGHT_PROFILE.panicle;
  const id = `${axis.id}:panicle`;
  const direction = tangentAt(axis.points, axis.points.length - 1);
  const shootRoot = axis.points[Math.max(0, axis.points.length - 2)];
  const shootTurn = randomRange(seed, [id, 'current-shoot-turn'], -0.48, 0.48);
  const shootOutward = vector(
    Math.cos(axis.azimuth + shootTurn),
    0,
    Math.sin(axis.azimuth + shootTurn),
  );
  const shootDirection = normalize(
    add(
      scale(direction, 0.9),
      add(scale(shootOutward, 0.12), vector(0, 0.18, 0)),
    ),
  );
  const orderSize = axis.order === 0 ? 1.03 : axis.order === 1 ? 0.95 : 0.82;
  const lengthM =
    randomRange(seed, [id, 'length'], profile.lengthM[0], profile.lengthM[1]) *
    orderSize;
  const widthM = Math.min(
    lengthM * randomRange(seed, [id, 'aspect'], 0.68, 0.84),
    profile.widthM[1] * orderSize,
  );

  return {
    id,
    // This is the woody shoot tip and peduncle start. The rendered cone begins
    // one peduncleLengthM further along direction.
    position: axis.points.at(-1),
    direction,
    // A stable axillary shoot below the previous terminal carries this year's
    // head. Keeping it separate lets a neglected plant retain last year's dry
    // head while the new shoot and panicle develop beside it.
    currentShoot: {
      id: `${id}:current-shoot`,
      root: shootRoot,
      direction: shootDirection,
      lengthM: randomRange(
        seed,
        [id, 'current-shoot-length'],
        axis.order === 0 ? 0.1 : axis.order === 1 ? 0.075 : 0.055,
        axis.order === 0 ? 0.17 : axis.order === 1 ? 0.135 : 0.1,
      ),
    },
    lengthM,
    widthM: Math.max(profile.widthM[0] * orderSize, widthM),
    peduncleLengthM: randomRange(
      seed,
      [id, 'peduncle-length'],
      profile.peduncleLengthM[0],
      profile.peduncleLengthM[1],
    ),
    representativeFlowerCount: randomInt(
      seed,
      [id, 'flower-count'],
      profile.representativeFlowerCount[0],
      profile.representativeFlowerCount[1],
    ),
    sterileFraction: randomRange(
      seed,
      [id, 'sterile-fraction'],
      profile.showySterileFraction[0],
      profile.showySterileFraction[1],
    ),
    firstFloweringYear:
      Math.max(1, Math.ceil(axis.birthAgeYears)) +
      (axis.order === 0 && keyedRandom(seed, id, 'juvenile-delay') > 0.58
        ? 1
        : 0),
  };
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
    seasonalClass = 'framework',
  },
) {
  const shell = {
    id,
    parentId,
    order,
    birthAgeYears,
    azimuth,
    seasonalClass,
    pointCount: points.length,
    points,
  };
  const nodes = points.slice(1).map((point, index) => {
    const node = {
      id: `${id}:node:${index}`,
      axisId: id,
      index,
      birthAgeYears:
        birthAgeYears + ((index + 1) / Math.max(1, points.length - 1)) * 0.38,
      position: point,
      tangent: tangentAt(points, index + 1),
      azimuth,
      leaves: [],
    };
    node.leaves = makeLeaves(seed, shell, node);
    return node;
  });
  const axis = { ...shell, nodes };
  axis.terminalPanicle = makeTerminalPanicle(seed, axis);
  return axis;
}

function makeCane(seed, sequence, birthAgeYears, maxYears) {
  const cohort =
    sequence < LIMELIGHT_PROFILE.architecture.initialFrameworkStemCount
      ? 'initial'
      : 'framework';
  const id = `limelight:cane:${String(sequence).padStart(2, '0')}`;
  const azimuth =
    (sequence / LIMELIGHT_PROFILE.architecture.maximumFrameworkStemCount) *
      TAU +
    randomRange(seed, [id, 'azimuth-jitter'], -0.23, 0.23);
  const crownRadius = randomRange(
    seed,
    [id, 'crown-radius'],
    0.018,
    LIMELIGHT_PROFILE.cane.crownRadiusM,
  );
  const position = vector(
    Math.cos(azimuth) * crownRadius,
    0,
    Math.sin(azimuth) * crownRadius,
  );
  const cane = {
    id,
    sequence,
    cohort,
    birthAgeYears,
    position,
    azimuth,
    targetHeightM: randomRange(
      seed,
      [id, 'target-height'],
      LIMELIGHT_PROFILE.cane.targetHeightM[0],
      LIMELIGHT_PROFILE.cane.targetHeightM[1],
    ),
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      LIMELIGHT_PROFILE.cane.baseRadiusM[0],
      LIMELIGHT_PROFILE.cane.baseRadiusM[1],
    ),
    axes: [],
  };

  const mainPoints = mainAxisPoints(seed, cane);
  const mainId = `${id}:axis:0`;
  const main = makeAxis(seed, {
    id: mainId,
    parentId: id,
    order: 0,
    birthAgeYears,
    azimuth,
    points: mainPoints,
  });
  cane.axes.push(main);

  const lateralCount = randomInt(
    seed,
    [id, 'lateral-count'],
    LIMELIGHT_PROFILE.cane.lateralAxisCount[0],
    LIMELIGHT_PROFILE.cane.lateralAxisCount[1],
  );
  const laterals = [];
  for (let index = 0; index < lateralCount; index += 1) {
    const axisId = `${id}:axis:${index + 1}`;
    const child = childAxisPoints(
      seed,
      cane,
      main,
      axisId,
      index,
      lateralCount,
      1,
    );
    // The framework fills in over several seasons, then remains bounded. This
    // is direct chronological age, not a modulo replacement cycle.
    const lateralBirthAgeYears =
      birthAgeYears +
      0.62 +
      (index / Math.max(1, lateralCount - 1)) * 2.25 +
      randomRange(seed, [axisId, 'birth-jitter'], -0.12, 0.16);
    if (lateralBirthAgeYears > maxYears) continue;
    const lateral = makeAxis(seed, {
      id: axisId,
      parentId: `${mainId}:node:${child.attachIndex - 1}`,
      order: 1,
      birthAgeYears: lateralBirthAgeYears,
      azimuth: child.azimuth,
      points: child.points,
    });
    cane.axes.push(lateral);
    laterals.push(lateral);
  }

  // Lightly maintained plants retain a modest extra tier of fine flowering
  // twigs. They produce more, smaller heads and broaden the outline, but are
  // omitted from the medium-pruned view. They are still bounded persistent
  // organs, not newly allocated annual copies.
  const twigCount = 1;
  for (let index = 0; index < twigCount && laterals.length > 0; index += 1) {
    const parent = laterals[(index * 3 + sequence) % laterals.length];
    const axisId = `${parent.id}:retained-twig:${index}`;
    const child = childAxisPoints(
      seed,
      cane,
      parent,
      axisId,
      index,
      twigCount,
      2,
    );
    const birthAgeYears =
      parent.birthAgeYears +
      randomRange(seed, [axisId, 'birth-delay'], 0.68, 1.45);
    if (birthAgeYears > maxYears) continue;
    cane.axes.push(
      makeAxis(seed, {
        id: axisId,
        parentId: `${parent.id}:node:${child.attachIndex - 1}`,
        order: 2,
        birthAgeYears,
        azimuth: child.azimuth,
        points: child.points,
        seasonalClass: 'retained-light-pruning',
      }),
    );
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

/** Build the finite, stable all-ages Limelight organ graph once. */
export function createLimelightModel({
  seed = 'limelight-demo',
  maxYears = LIMELIGHT_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertModelOptions(seed, maxYears);
  const canes = [];
  const architecture = LIMELIGHT_PROFILE.architecture;

  for (
    let sequence = 0;
    sequence < architecture.maximumFrameworkStemCount;
    sequence += 1
  ) {
    const birthAgeYears =
      sequence < architecture.initialFrameworkStemCount
        ? 0
        : 1 +
          ((sequence - architecture.initialFrameworkStemCount) /
            Math.max(
              1,
              architecture.maximumFrameworkStemCount -
                architecture.initialFrameworkStemCount -
                1,
            )) *
            4.65 +
          randomRange(seed, ['cane', sequence, 'birth-jitter'], -0.08, 0.12);
    if (birthAgeYears > maxYears) continue;
    canes.push(makeCane(seed, sequence, birthAgeYears, maxYears));
  }

  return deepFreeze({
    schemaVersion: 1,
    kind: 'hydrangea-limelight-growth-model',
    species: LIMELIGHT_PROFILE.species,
    cultivar: LIMELIGHT_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: LIMELIGHT_PROFILE.metresPerUnit,
    topologyMaturesByAgeYears: architecture.yearsToMaturity[1],
    canes,
  });
}

function scaledFromRoot(position, sourceRoot, evaluatedRoot, amount) {
  return add(evaluatedRoot, scale(subtract(position, sourceRoot), amount));
}

function annualAxisGrowthScale(axis, now, seasonalProgress) {
  if (now < axis.birthAgeYears) return 0;
  const birthYear = Math.floor(axis.birthAgeYears);
  const currentYear = Math.floor(now);
  if (currentYear > birthYear) return 1;
  // The fractional part is a position inside the spring shoot-extension
  // window, not a literal fraction of the whole calendar year. This prevents
  // cohorts scheduled late in an age year from appearing during dormancy.
  const birthProgress = axis.birthAgeYears - birthYear;
  return smoothstep01(progress(seasonalProgress, birthProgress, 1));
}

function annualShootDirection(seed, panicle, role) {
  const base = panicle.currentShoot.direction;
  const side =
    keyedRandom(seed, panicle.id, 'annual-shoot-pair-side') < 0.5 ? -1 : 1;
  const turn =
    (role === 'previous' ? side : -side) *
    randomRange(seed, [panicle.id, 'annual-shoot-pair-separation'], 0.14, 0.3);
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);
  return normalize(
    vector(
      base.x * cosine - base.z * sine,
      base.y,
      base.x * sine + base.z * cosine,
    ),
  );
}

function evaluatePanicle(
  seed,
  panicle,
  transform,
  plantSizeScale,
  currentYear,
  dayOfYear,
  phenology,
  scenario,
) {
  const hasCurrentHead = currentYear >= panicle.firstFloweringYear;
  const hasPreviousHead = currentYear - 1 >= panicle.firstFloweringYear;
  const calendar = phenology.calendar;
  let oldVisibility = hasPreviousHead ? phenology.oldPanicleVisibility : 0;

  if (scenario === 'neglected' && hasPreviousHead) {
    oldVisibility =
      dayOfYear < calendar.panicleInitiationStart
        ? 1
        : 1 -
          progress(
            dayOfYear,
            calendar.panicleInitiationStart,
            calendar.floweringStart,
          );
  }

  const currentVisibility = hasCurrentHead
    ? phenology.currentPanicleVisibility
    : 0;
  const currentDryProgress =
    hasCurrentHead && dayOfYear >= calendar.dryPanicleStart
      ? progress(dayOfYear, calendar.dryPanicleStart, calendar.dryPanicleFull)
      : 0;
  const freshVisibility = currentVisibility * (1 - currentDryProgress);
  const dryVisibility = Math.max(oldVisibility, currentDryProgress);
  const headVisibility = Math.max(currentVisibility, oldVisibility);
  const currentSterileVisibility = Math.max(
    currentDryProgress,
    hasCurrentHead ? phenology.flowerOpenVisibility : 0,
  );
  const currentFertileVisibility = Math.max(
    currentDryProgress * 0.5,
    hasCurrentHead ? phenology.panicleBudVisibility : 0,
    hasCurrentHead ? phenology.flowerOpenVisibility * 0.78 : 0,
  );
  const currentSizeProgress = hasCurrentHead
    ? lerp(0.12, 1, phenology.panicleGrowthProgress)
    : 0;
  const neglectHeadScale = scenario === 'neglected' ? 0.82 : 1;
  const lengthM = panicle.lengthM * plantSizeScale * neglectHeadScale;
  const widthM = panicle.widthM * plantSizeScale * neglectHeadScale;
  const peduncleLengthM =
    panicle.peduncleLengthM * plantSizeScale * neglectHeadScale;
  const shootRoot = transform(panicle.currentShoot.root);
  const previousDirection = annualShootDirection(seed, panicle, 'previous');
  const currentDirection = annualShootDirection(seed, panicle, 'current');
  const previousShootLengthM = panicle.currentShoot.lengthM * plantSizeScale;
  const shootLengthM =
    panicle.currentShoot.lengthM *
    plantSizeScale *
    phenology.shootGrowthProgress;
  const shootTip = add(shootRoot, scale(currentDirection, shootLengthM));
  const previousPosition = add(
    shootRoot,
    scale(previousDirection, previousShootLengthM),
  );

  const previousPanicle = {
    id: `${panicle.id}:previous`,
    visible: oldVisibility > 0.015,
    position: previousPosition,
    direction: previousDirection,
    lengthM,
    widthM,
    peduncleLengthM,
    scale: 1,
    headVisibility: oldVisibility,
    currentVisibility: 0,
    freshVisibility: 0,
    budVisibility: 0,
    sterileVisibility: oldVisibility,
    fertileVisibility: oldVisibility * 0.38,
    dryVisibility: oldVisibility,
    retainedFromPreviousYear: true,
  };
  const currentPanicle = {
    id: `${panicle.id}:current`,
    visible: currentVisibility > 0.015,
    position: shootTip,
    direction: currentDirection,
    lengthM,
    widthM,
    peduncleLengthM,
    scale: currentSizeProgress,
    headVisibility: currentVisibility,
    currentVisibility,
    freshVisibility,
    budVisibility: hasCurrentHead ? phenology.panicleBudVisibility : 0,
    sterileVisibility: currentSterileVisibility,
    fertileVisibility: currentFertileVisibility,
    dryVisibility: currentDryProgress,
    retainedFromPreviousYear: false,
  };
  const currentShoot = {
    id: panicle.currentShoot.id,
    visible: phenology.shootGrowthProgress > 0.015,
    root: shootRoot,
    tip: shootTip,
    direction: currentDirection,
    lengthM: shootLengthM,
    scale: phenology.shootGrowthProgress,
  };
  const display = currentPanicle.visible ? currentPanicle : previousPanicle;

  return {
    id: panicle.id,
    visible: headVisibility > 0.015,
    // Compatibility aggregate: physical rendering uses the two stable slots
    // below so retained and emerging heads never shrink or recolour as one.
    position: display.position,
    direction: display.direction,
    lengthM,
    widthM,
    peduncleLengthM,
    scale: display.scale,
    headVisibility,
    currentVisibility,
    freshVisibility,
    budVisibility: hasCurrentHead ? phenology.panicleBudVisibility : 0,
    sterileVisibility: Math.max(
      previousPanicle.sterileVisibility,
      currentPanicle.sterileVisibility,
    ),
    fertileVisibility: Math.max(
      previousPanicle.fertileVisibility,
      currentPanicle.fertileVisibility,
    ),
    dryVisibility,
    retainedFromPreviousYear: previousPanicle.visible,
    firstFloweringYear: panicle.firstFloweringYear,
    representativeFlowerCount: panicle.representativeFlowerCount,
    sterileFraction: panicle.sterileFraction,
    currentShoot,
    previousPanicle,
    currentPanicle,
  };
}

function evaluateCane(
  cane,
  seed,
  now,
  currentYear,
  phenology,
  scenario,
  plantGrowthScale,
) {
  const axisByNode = new Map();
  const axes = [];
  const caneAgeYears = Math.max(0, now - cane.birthAgeYears);
  const organSizeScale = lerp(0.68, 1, clamp01(caneAgeYears));

  for (const axis of cane.axes) {
    if (axis.birthAgeYears > now) continue;
    if (
      scenario === 'maintained' &&
      axis.seasonalClass === 'retained-light-pruning'
    ) {
      continue;
    }

    const parentNode = axisByNode.get(axis.parentId);
    if (axis.order > 0 && !parentNode) {
      throw new Error(`Missing evaluated parent node ${axis.parentId}`);
    }
    const root = axis.order === 0 ? cane.position : parentNode.position;
    const seasonalGrowth = annualAxisGrowthScale(
      axis,
      now,
      phenology.shootGrowthProgress,
    );
    const axisGrowthScale = plantGrowthScale * seasonalGrowth;
    const sourceRoot = axis.points[0];
    const transform = (position) =>
      scaledFromRoot(position, sourceRoot, root, axisGrowthScale);
    const nodes = axis.nodes.map((node) => {
      const nodeProgress =
        (node.index + 1) / Math.max(1, axis.points.length - 1);
      const localLeafProgress = smoothstep01(
        progress(
          seasonalGrowth,
          nodeProgress * 0.82,
          Math.min(1, nodeProgress * 0.82 + 0.14),
        ),
      );
      const evaluatedNode = {
        id: node.id,
        index: node.index,
        position: transform(node.position),
        tangent: node.tangent,
        azimuth: node.azimuth,
        leaves: node.leaves.map((leaf) => {
          // Real leaf fall is progressive. A keyed threshold gives every leaf
          // a stable abscission time and restores the exact set when scrubbing
          // A-B-A, instead of dropping the whole shrub on one calendar day.
          const retainedInAutumn =
            phenology.autumnProgress <= 0 ||
            keyedRandom(seed, leaf.id, 'autumn-abscission') <
              phenology.leafOpacity;
          return {
            id: leaf.id,
            side: leaf.side,
            visible:
              localLeafProgress > 0.015 &&
              phenology.leafOpacity > 0.015 &&
              retainedInAutumn,
            unfoldProgress: Math.min(phenology.leafProgress, localLeafProgress),
            position: transform(leaf.position),
            normal: leaf.normal,
            azimuth: leaf.azimuth,
            lengthM: leaf.lengthM,
            widthM: leaf.widthM,
            petioleLengthM: leaf.petioleLengthM,
            scale:
              organSizeScale *
              lerp(
                0.12,
                1,
                Math.min(phenology.leafProgress, localLeafProgress),
              ),
          };
        }),
      };
      axisByNode.set(node.id, evaluatedNode);
      return evaluatedNode;
    });
    const terminalPanicle = evaluatePanicle(
      seed,
      axis.terminalPanicle,
      transform,
      plantGrowthScale,
      currentYear,
      phenology.dayOfYear,
      phenology,
      scenario,
    );

    axes.push({
      id: axis.id,
      order: axis.order,
      parentId: axis.parentId,
      seasonalClass: axis.seasonalClass,
      root,
      growthScale: axisGrowthScale,
      nodes,
      terminalPanicle,
    });
  }

  return {
    id: cane.id,
    cohort: cane.cohort,
    birthAgeYears: cane.birthAgeYears,
    ageYears: caneAgeYears,
    growthScale: plantGrowthScale,
    position: cane.position,
    baseRadiusM: cane.baseRadiusM,
    targetHeightM: cane.targetHeightM,
    removed: false,
    axes,
  };
}

function physicalPanicles(head) {
  if (!head) return [];
  if (head.previousPanicle && head.currentPanicle) {
    return [head.previousPanicle, head.currentPanicle];
  }
  return [head];
}

function snapshotDimensions(canes) {
  let height = 0;
  let radius = 0;
  for (const cane of canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        height = Math.max(height, node.position.y);
        radius = Math.max(radius, Math.hypot(node.position.x, node.position.z));
      }
      const shoot = axis.terminalPanicle?.currentShoot;
      if (shoot?.visible) {
        height = Math.max(height, shoot.tip.y);
        radius = Math.max(radius, Math.hypot(shoot.tip.x, shoot.tip.z));
      }
      for (const head of physicalPanicles(axis.terminalPanicle)) {
        if (!head.visible) continue;
        const extent = (head.peduncleLengthM + head.lengthM) * head.scale;
        const tip = add(head.position, scale(head.direction, extent));
        const halfWidth = (head.widthM * head.scale) / 2;
        height = Math.max(height, tip.y + halfWidth * 0.25);
        radius = Math.max(radius, Math.hypot(tip.x, tip.z) + halfWidth);
      }
    }
  }
  return { heightM: height, radiusM: radius, spreadM: radius * 2 };
}

function snapshotStats(canes, phenology) {
  let visibleAxes = 0;
  let visibleLeaves = 0;
  let visiblePanicles = 0;
  let freshPanicles = 0;
  let dryPanicles = 0;
  let panicleBuds = 0;

  for (const cane of canes) {
    visibleAxes += cane.axes.length;
    for (const axis of cane.axes) {
      visibleLeaves += axis.nodes.reduce(
        (count, node) =>
          count + node.leaves.filter((leaf) => leaf.visible).length,
        0,
      );
      for (const head of physicalPanicles(axis.terminalPanicle)) {
        if (!head.visible) continue;
        visiblePanicles += 1;
        if (head.freshVisibility > 0.015) freshPanicles += 1;
        if (head.dryVisibility > 0.015) dryPanicles += 1;
        if (head.budVisibility > 0.015) panicleBuds += 1;
      }
    }
  }

  return {
    visibleCanes: canes.length,
    visibleAxes,
    visibleLeaves,
    visiblePanicles,
    freshPanicles,
    dryPanicles,
    panicleBuds,
    flowersOnCurrentSeasonWood: phenology.flowersOnCurrentSeasonWood,
  };
}

function ageAwarePhenology(phenology, stats, visibleCanes) {
  if (stats.visiblePanicles > 0 || stats.panicleBuds > 0) return phenology;

  const floweringPhase = new Set([
    'panicle-bud',
    'lime-flowering',
    'cream-flowering',
    'pink-ageing',
    'burgundy-ageing',
    'autumn-drying',
  ]);
  let label = null;
  if (phenology.phase === 'dormant') {
    label = visibleCanes
      ? 'Dormant juvenile framework; no retained panicles yet'
      : 'Dormant before the first spring growth';
  } else if (floweringPhase.has(phenology.phase)) {
    label = 'Juvenile vegetative growth; no panicles yet';
  }
  return label
    ? Object.freeze({ ...phenology, stage: label, label })
    : phenology;
}

function careHintsForSnapshot(
  phenology,
  stats,
  { ageYears, seasonProfile, offsetDays, floweringEligible },
) {
  const hints = getLimelightCareHints(phenology.dayOfYear, {
    plantAgeYears: ageYears,
    seasonProfile,
    offsetDays,
  });
  if (stats.visiblePanicles > 0 || stats.panicleBuds > 0) return hints;
  // These cues all presuppose a flower-bearing shoot or an existing head.
  const absentOrganHints = new Set([
    'observe-colour-sequence',
    'check-panicle-support',
    'retain-dry-heads',
  ]);
  if (!floweringEligible) absentOrganHints.add('protect-current-shoots');
  return Object.freeze(hints.filter((hint) => !absentOrganHints.has(hint.id)));
}

function validateEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (events.length > 0) {
    throw new RangeError(
      'Limelight does not expose destructive care events; use maintained or neglected scenario.',
    );
  }
}

/**
 * Evaluate the immutable graph directly at an absolute age and day. There is
 * no replacement-cycle modulo: growth reaches its 5-10 year mature plateau
 * and remains stable through the requested model horizon.
 */
export function evaluateLimelightModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 230,
    events = [],
    scenario = 'maintained',
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'hydrangea-limelight-growth-model') {
    throw new TypeError('Expected a model returned by createLimelightModel');
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
  validateEvents(events);

  const phenology = getLimelightPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  // Structural age advances only while shoots can actually extend. Calendar
  // days in autumn and winter therefore cannot make the framework larger.
  const now = ageYears + phenology.shootGrowthProgress;
  const currentYear = ageYears;
  const wholePlantAgeScale = sampleAnchors(
    LIMELIGHT_PROFILE.growth.plantAgeScaleAnchors,
    ageYears,
  );
  // Unpruned framework is a little broader, but remains within the published
  // 1.5-2.5 m garden envelope.
  const scenarioScale = scenario === 'neglected' ? 1.07 : 1;
  const canes = model.canes
    .filter((cane) => cane.birthAgeYears <= now)
    .map((cane) =>
      evaluateCane(
        cane,
        model.seed,
        now,
        currentYear,
        phenology,
        scenario,
        wholePlantAgeScale * scenarioScale,
      ),
    );
  const stats = snapshotStats(canes, phenology);
  const floweringEligible = canes.some((cane) =>
    cane.axes.some(
      (axis) => axis.terminalPanicle.firstFloweringYear <= currentYear,
    ),
  );
  const snapshotPhenology = ageAwarePhenology(phenology, stats, canes.length);
  const careHints = careHintsForSnapshot(phenology, stats, {
    ageYears,
    seasonProfile,
    offsetDays,
    floweringEligible,
  });

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    scenario,
    ageYears,
    dayOfYear: phenology.dayOfYear,
    dimensions: snapshotDimensions(canes),
    phenology: snapshotPhenology,
    careHints,
    provenance: {
      observedDisplay: LIMELIGHT_PROFILE.flowering.observedDisplay,
      sources: LIMELIGHT_SOURCES,
      rendererAssumptions: [
        'bounded 6-to-12-stem persistent framework topology',
        'stable recurring leaves, current shoots and dual terminal-panicle slots',
        'fine retained twigs distinguish neglected from medium-pruned plants',
      ],
    },
    canes,
    stats,
    appliedEvents: [],
  };
}
