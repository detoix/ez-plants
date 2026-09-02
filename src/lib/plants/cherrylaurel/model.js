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
import { growWoodyAxis } from '../../woody-axis.js';
import {
  getRotundifoliaCareHints,
  getRotundifoliaPhenology,
} from './phenology.js';
import {
  ROTUNDIFOLIA_PROFILE,
  ROTUNDIFOLIA_RENDER_PRIORS,
  ROTUNDIFOLIA_SOURCES,
} from './rotundifolia.js';

export const ROTUNDIFOLIA_MODEL_KIND = 'cherrylaurel-rotundifolia-growth-model';

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
    origin: vector(origin.x, origin.y, origin.z),
    orientation: orientationFor(direction),
    length: axisLength,
    radius: baseRadius,
    sectionCount,
    gnarliness,
    taper: ROTUNDIFOLIA_PROFILE.cane.axisTaperRatios[1],
    force: {
      direction: vector(forceDirection.x, forceDirection.y, forceDirection.z),
      // Keep the habit invariant when a node-count calibration changes.
      strength: (forceStrength * 24) / sectionCount,
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
    ROTUNDIFOLIA_PROFILE.cane.mainAxisNodeCount[0],
    ROTUNDIFOLIA_PROFILE.cane.mainAxisNodeCount[1],
  );
  const outward = vector(Math.cos(cane.azimuth), 0, Math.sin(cane.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const direction = normalize(
    add(
      vector(0, 1, 0),
      add(
        scale(outward, randomRange(seed, [id, 'lean'], 0.22, 0.44)),
        scale(sideways, randomRange(seed, [id, 'side-lean'], -0.045, 0.045)),
      ),
    ),
  );
  const forceDirection = normalize(
    add(
      vector(0, 1, 0),
      scale(outward, randomRange(seed, [id, 'crown-spread'], 0.55, 0.82)),
    ),
  );
  return growAxisPoints(seed, {
    id,
    origin: cane.position,
    direction,
    forceDirection,
    axisLength: cane.targetHeightM,
    baseRadius: cane.baseRadiusM,
    sectionCount,
    gnarliness: 0.0011,
    forceStrength: 0.00006,
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
  { matureCrown = false } = {},
) {
  const lower = order === 1 ? 0.055 : matureCrown ? 0.3 : 0.18;
  const upper = order === 1 ? 0.95 : matureCrown ? 0.9 : 0.82;
  const attachFraction = clamp(
    lower +
      ((childIndex +
        randomRange(seed, [childId, 'attach-jitter'], 0.18, 0.82)) /
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
  const alternating = childIndex % 2 === 0 ? -1 : 1;
  const azimuth =
    parent.azimuth +
    alternating *
      randomRange(
        seed,
        [childId, 'spread-angle'],
        order === 1 ? 0.58 : matureCrown ? 0.74 : 0.5,
        order === 1 ? 1.42 : matureCrown ? 1.44 : 1.2,
      ) +
    childIndex * 0.16;
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const parentTangent = tangentAt(parent.points, attachIndex);
  const rise = randomRange(
    seed,
    [childId, 'rise'],
    order === 1 ? lerp(0.28, 0.56, attachFraction) : matureCrown ? 0.08 : 0.32,
    order === 1 ? lerp(0.58, 0.88, attachFraction) : matureCrown ? 0.3 : 0.62,
  );
  const direction = normalize(
    add(
      outward,
      add(vector(0, rise, 0), scale(parentTangent, order === 1 ? 0.16 : 0.1)),
    ),
  );
  const maximumLength =
    order === 1
      ? lerp(1.45, 0.68, attachFraction)
      : matureCrown
        ? lerp(0.74, 0.48, attachFraction)
        : lerp(0.44, 0.26, attachFraction);
  const axisLength = randomRange(
    seed,
    [childId, 'length'],
    order === 1 ? 0.5 : matureCrown ? 0.36 : 0.14,
    maximumLength,
  );
  const sectionCount = randomInt(
    seed,
    [childId, 'node-count'],
    order === 1 ? 5 : matureCrown ? 5 : 1,
    order === 1 ? 7 : matureCrown ? 7 : 2,
  );
  const radiusFactor =
    order === 1
      ? ROTUNDIFOLIA_PROFILE.cane.axisRadiusFactors.lateral
      : ROTUNDIFOLIA_PROFILE.cane.axisRadiusFactors.higherOrder;
  const points = growAxisPoints(seed, {
    id: childId,
    origin,
    direction,
    forceDirection: normalize(
      add(vector(0, matureCrown ? -0.16 : 0.72, 0), outward),
    ),
    axisLength,
    baseRadius: cane.baseRadiusM * radiusFactor,
    sectionCount,
    gnarliness: order === 1 ? 0.00075 : matureCrown ? 0.00042 : 0.0005,
    forceStrength: order === 1 ? 0.00002 : matureCrown ? 0.000018 : 0.000012,
  });
  return { points, attachIndex, azimuth };
}

function makeLeaf(seed, axis, node, slot, attachmentPosition) {
  const profile = ROTUNDIFOLIA_PROFILE.leaf;
  const id = `${node.id}:leaf:${slot}`;
  // Seven physical subnodes per woody sampling section. Their positions are
  // staggered along the internode and their ranks continue the golden-angle
  // spiral; this is still alternate foliage, never an opposite same-node pair.
  const phyllotacticRank =
    node.index * ROTUNDIFOLIA_RENDER_PRIORS.leafSubnodesPerWoodySection + slot;
  const azimuth =
    axis.azimuth +
    phyllotacticRank * profile.phyllotacticTurnRadians +
    randomRange(seed, [id, 'azimuth-jitter'], -0.12, 0.12);
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const petioleLengthM = randomRange(
    seed,
    [id, 'petiole-length'],
    profile.petioleLengthM[0],
    profile.petioleLengthM[1],
  );
  const lengthM = randomRange(
    seed,
    [id, 'length'],
    profile.lengthM[0],
    profile.lengthM[1],
  );
  const widthM = clamp(
    lengthM * randomRange(seed, [id, 'aspect'], 0.42, 0.5),
    profile.widthM[0],
    profile.widthM[1],
  );
  const position = add(
    attachmentPosition,
    add(scale(outward, petioleLengthM), vector(0, 0.004, 0)),
  );
  const nearTip = node.index >= axis.pointCount * 0.72;
  const freshFlush = nearTip
    ? 0.72 + keyedRandom(seed, id, 'tip-flush') * 0.28
    : keyedRandom(seed, id, 'annual-flush') <
        ROTUNDIFOLIA_RENDER_PRIORS.annualFreshFlushFraction
      ? randomRange(seed, [id, 'flush-strength'], 0.32, 0.7)
      : 0;

  return {
    id,
    attachmentPosition,
    position,
    normal: normalize(
      add(
        vector(0, randomRange(seed, [id, 'upward-face'], 0.72, 0.96), 0),
        add(
          scale(outward, randomRange(seed, [id, 'blade-tilt'], 0.35, 0.65)),
          scale(sideways, randomRange(seed, [id, 'blade-roll'], -0.6, 0.6)),
        ),
      ),
    ),
    azimuth,
    lengthM,
    widthM,
    petioleLengthM,
    flushStrength: freshFlush,
  };
}

function makeRaceme(seed, axis, node, slot = 'axillary') {
  const profile = ROTUNDIFOLIA_PROFILE.raceme;
  const id = `${node.id}:raceme:${slot}`;
  const radialDistance = Math.hypot(node.position.x, node.position.z);
  const outward =
    radialDistance > 0.02
      ? normalize(vector(node.position.x, 0, node.position.z))
      : vector(Math.cos(node.azimuth), 0, Math.sin(node.azimuth));
  const direction = normalize(
    add(vector(0, 1, 0), add(scale(outward, 0.13), scale(node.tangent, 0.12))),
  );
  const terminal = slot === 'terminal';
  const heightFraction = clamp01(
    node.position.y / ROTUNDIFOLIA_PROFILE.architecture.matureHeightM,
  );
  const crownShellRadius =
    ROTUNDIFOLIA_PROFILE.architecture.matureRadiusM *
    Math.sin(Math.PI * heightFraction);
  // Raceme-bearing green peduncles are omitted from the mesh. Move the visual
  // sample toward the broad-ovoid shell so the spikes sit where those shoot
  // tips would carry them, rather than disappearing inside the evergreen mass.
  const surfaceOffset = clamp(
    crownShellRadius * 0.92 - radialDistance,
    terminal ? 0.12 : 0.18,
    0.5,
  );
  const orderScale = axis.order === 0 ? 1 : axis.order === 1 ? 0.94 : 0.82;
  return {
    id,
    position: add(
      node.position,
      add(scale(outward, surfaceOffset), vector(0, terminal ? 0.06 : 0.08, 0)),
    ),
    direction,
    lengthM:
      randomRange(
        seed,
        [id, 'length'],
        profile.lengthM[0],
        profile.lengthM[1],
      ) * orderScale,
    widthM:
      randomRange(seed, [id, 'width'], profile.widthM[0], profile.widthM[1]) *
      orderScale,
    firstFloweringAgeYears: Math.max(
      ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears,
      Math.ceil(axis.birthAgeYears) + 1,
    ),
    setsFruit:
      keyedRandom(seed, id, 'fruit-set') <
      ROTUNDIFOLIA_RENDER_PRIORS.fruitSetFraction,
    maturityRank: keyedRandom(seed, id, 'flowering-maturity'),
  };
}

function makeAxis(
  seed,
  { id, parentId, order, birthAgeYears, azimuth, points },
) {
  const shell = {
    id,
    parentId,
    order,
    birthAgeYears,
    azimuth,
    pointCount: points.length,
    points,
  };
  const occupancy =
    ROTUNDIFOLIA_RENDER_PRIORS.foliageNodeOccupancyByOrder[Math.min(order, 2)];
  const racemeOccupancy =
    ROTUNDIFOLIA_RENDER_PRIORS.racemeNodeOccupancyByOrder[Math.min(order, 2)];
  const nodes = points.slice(1).map((point, index) => {
    const id_ = `${id}:node:${index}`;
    const node = {
      id: id_,
      axisId: id,
      index,
      birthAgeYears:
        birthAgeYears + ((index + 1) / Math.max(1, points.length - 1)) * 0.42,
      position: point,
      tangent: tangentAt(points, index + 1),
      azimuth:
        azimuth + index * ROTUNDIFOLIA_PROFILE.leaf.phyllotacticTurnRadians,
      leaves: [],
      racemes: [],
    };
    const sourcePointIndex = index + 1;
    const previousPoint = points[Math.max(0, sourcePointIndex - 1)];
    const nextPoint = points[Math.min(points.length - 1, sourcePointIndex + 1)];
    const beforeLength = Math.hypot(
      point.x - previousPoint.x,
      point.y - previousPoint.y,
      point.z - previousPoint.z,
    );
    const afterLength = Math.hypot(
      nextPoint.x - point.x,
      nextPoint.y - point.y,
      nextPoint.z - point.z,
    );
    const internodeLength = Math.max(
      0.01,
      Math.min(beforeLength || afterLength, afterLength || beforeLength),
    );
    const leafSubnodeCount =
      ROTUNDIFOLIA_RENDER_PRIORS.leafSubnodesPerWoodySection;
    for (let slot = 0; slot < leafSubnodeCount; slot += 1) {
      const leafId = `${id_}:leaf:${slot}`;
      if (keyedRandom(seed, leafId, 'leaf-occupancy') >= occupancy) continue;
      const along = ((slot + 0.5) / Math.max(1, leafSubnodeCount) - 0.5) * 0.88;
      const attachmentPosition = add(
        point,
        scale(node.tangent, internodeLength * along),
      );
      node.leaves.push(makeLeaf(seed, shell, node, slot, attachmentPosition));
    }

    const nodeFraction = (index + 1) / Math.max(1, points.length - 1);
    const upperEnough = nodeFraction >= (order === 0 ? 0.34 : 0.22);
    const terminal = index === points.length - 2;
    const terminalRaceme =
      terminal &&
      keyedRandom(seed, id_, 'terminal-raceme-occupancy') <
        ROTUNDIFOLIA_RENDER_PRIORS.terminalRacemeOccupancyByOrder[
          Math.min(order, 2)
        ];
    if (
      upperEnough &&
      (terminalRaceme ||
        keyedRandom(seed, id_, 'raceme-occupancy') < racemeOccupancy)
    ) {
      node.racemes.push(
        makeRaceme(seed, shell, node, terminal ? 'terminal' : 'axillary'),
      );
    }
    return node;
  });
  return { ...shell, nodes };
}

function makeCane(seed, sequence, birthAgeYears, maxYears) {
  const profile = ROTUNDIFOLIA_PROFILE;
  const id = `rotundifolia:cane:${String(sequence).padStart(2, '0')}`;
  const azimuth =
    (sequence / profile.architecture.maximumFrameworkStemCount) * TAU +
    randomRange(seed, [id, 'azimuth-jitter'], -0.22, 0.22);
  const crownRadius = randomRange(
    seed,
    [id, 'crown-radius'],
    0.025,
    profile.cane.crownRadiusM,
  );
  const cane = {
    id,
    sequence,
    cohort:
      sequence < profile.architecture.initialFrameworkStemCount
        ? 'initial'
        : 'framework',
    birthAgeYears,
    position: vector(
      Math.cos(azimuth) * crownRadius,
      0,
      Math.sin(azimuth) * crownRadius,
    ),
    azimuth,
    targetHeightM: randomRange(
      seed,
      [id, 'target-height'],
      profile.cane.targetHeightM[0],
      profile.cane.targetHeightM[1],
    ),
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      profile.cane.baseRadiusM[0],
      profile.cane.baseRadiusM[1],
    ),
    axes: [],
  };

  const mainId = `${id}:axis:0`;
  const main = makeAxis(seed, {
    id: mainId,
    parentId: id,
    order: 0,
    birthAgeYears,
    azimuth,
    points: mainAxisPoints(seed, cane),
  });
  cane.axes.push(main);

  const lateralCount = randomInt(
    seed,
    [id, 'lateral-count'],
    profile.cane.lateralAxisCount[0],
    profile.cane.lateralAxisCount[1],
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
    const lateralBirthAgeYears =
      birthAgeYears +
      0.55 +
      (index / Math.max(1, lateralCount - 1)) * 2.05 +
      randomRange(seed, [axisId, 'birth-jitter'], -0.1, 0.14);
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

  const twigCount = randomInt(
    seed,
    [id, 'higher-order-count'],
    profile.cane.higherOrderAxisCount[0],
    profile.cane.higherOrderAxisCount[1],
  );
  for (let index = 0; index < twigCount && laterals.length > 0; index += 1) {
    const parent = laterals[(sequence * 3 + index * 5) % laterals.length];
    const axisId = `${parent.id}:twig:${index}`;
    const child = childAxisPoints(
      seed,
      cane,
      parent,
      axisId,
      index,
      twigCount,
      2,
    );
    const twigBirthAgeYears =
      parent.birthAgeYears +
      randomRange(seed, [axisId, 'birth-delay'], 0.72, 1.38);
    if (twigBirthAgeYears > maxYears) continue;
    cane.axes.push(
      makeAxis(seed, {
        id: axisId,
        parentId: `${parent.id}:node:${child.attachIndex - 1}`,
        order: 2,
        birthAgeYears: twigBirthAgeYears,
        azimuth: child.azimuth,
        points: child.points,
      }),
    );
  }

  // Rotundifolia reaches its garden-size envelope quickly, but an old shrub
  // does not freeze at age ten. A small cohort of short, outward and gently
  // sagging crown axes appears over the following decades. This exposes more
  // of the ageing multi-stem framework while rounding the upper silhouette,
  // without pretending that the maintained plant keeps gaining height.
  const lateCrownAxisCount = randomInt(
    seed,
    [id, 'late-crown-axis-count'],
    profile.cane.lateCrownAxisCount[0],
    profile.cane.lateCrownAxisCount[1],
  );
  for (
    let index = 0;
    index < lateCrownAxisCount && laterals.length > 0;
    index += 1
  ) {
    const parent = laterals[(sequence * 2 + index * 5) % laterals.length];
    const axisId = `${parent.id}:mature-crown:${index}`;
    const birthAgeYears = randomRange(
      seed,
      [axisId, 'birth-age'],
      profile.cane.lateCrownAxisBirthAgeYears[0],
      profile.cane.lateCrownAxisBirthAgeYears[1],
    );
    if (birthAgeYears > maxYears) continue;
    const child = childAxisPoints(
      seed,
      cane,
      parent,
      axisId,
      index,
      lateCrownAxisCount,
      2,
      { matureCrown: true },
    );
    cane.axes.push(
      makeAxis(seed, {
        id: axisId,
        parentId: `${parent.id}:node:${child.attachIndex - 1}`,
        order: 2,
        birthAgeYears,
        azimuth: child.azimuth,
        points: child.points,
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

/** Build the finite all-age organ graph once. */
export function createRotundifoliaModel({
  seed = 'rotundifolia-demo',
  maxYears = ROTUNDIFOLIA_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertModelOptions(seed, maxYears);
  const canes = [];
  const architecture = ROTUNDIFOLIA_PROFILE.architecture;
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
            5 +
          randomRange(seed, ['cane', sequence, 'birth-jitter'], -0.1, 0.14);
    if (birthAgeYears > maxYears) continue;
    canes.push(makeCane(seed, sequence, birthAgeYears, maxYears));
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: ROTUNDIFOLIA_MODEL_KIND,
    species: ROTUNDIFOLIA_PROFILE.species,
    cultivar: ROTUNDIFOLIA_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: ROTUNDIFOLIA_PROFILE.metresPerUnit,
    topologyMaturesByAgeYears:
      ROTUNDIFOLIA_PROFILE.architecture.yearsToMaturity[1],
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
  const birthProgress = axis.birthAgeYears - birthYear;
  return smoothstep01(progress(seasonalProgress, birthProgress, 1));
}

function evaluateRaceme(raceme, transform, ageYears, phenology, sizeScale) {
  const floweringMaturity = clamp01(
    (ageYears -
      ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears +
      1) /
      ROTUNDIFOLIA_RENDER_PRIORS.floweringMaturityYears,
  );
  const eligible =
    ageYears >= raceme.firstFloweringAgeYears &&
    raceme.maturityRank <= floweringMaturity;
  let stage = phenology.featureStage;
  if (stage === 'fruit' && !raceme.setsFruit) stage = 'absent';
  if (!eligible) stage = 'absent';

  const visibility =
    stage === 'bud'
      ? phenology.flowerBudVisibility
      : stage === 'flower'
        ? phenology.flowerVisibility
        : stage === 'fruit'
          ? phenology.fruitVisibility
          : 0;
  const stageScale =
    stage === 'bud'
      ? lerp(0.34, 0.72, phenology.flowerBudProgress)
      : stage === 'flower'
        ? lerp(0.74, 1, phenology.flowerProgress)
        : stage === 'fruit'
          ? lerp(0.2, 1, phenology.fruitGrowthProgress)
          : 0;
  return {
    id: raceme.id,
    visible: visibility > 0.015 && stageScale > 0.015,
    position: transform(raceme.position),
    direction: vector(
      raceme.direction.x,
      raceme.direction.y,
      raceme.direction.z,
    ),
    lengthM: raceme.lengthM,
    widthM: raceme.widthM,
    stage,
    scale: sizeScale * stageScale * Math.max(0.2, visibility),
    visibility,
    fruitColourProgress: phenology.fruitColourProgress,
    redProgress: phenology.redProgress,
    blackProgress: phenology.blackProgress,
    ripe: stage === 'fruit' && phenology.blackProgress > 0.65,
    setsFruit: raceme.setsFruit,
    firstFloweringAgeYears: raceme.firstFloweringAgeYears,
  };
}

function evaluateCane(cane, seed, now, ageYears, phenology, plantGrowthScale) {
  const axisByNode = new Map();
  const axes = [];
  const caneAgeYears = Math.max(0, now - cane.birthAgeYears);
  const organSizeScale = lerp(0.7, 1, clamp01(caneAgeYears));

  for (const axis of cane.axes) {
    if (axis.birthAgeYears > now) continue;
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
      const localGrowth = smoothstep01(
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
        tangent: vector(node.tangent.x, node.tangent.y, node.tangent.z),
        azimuth: node.azimuth,
        leaves: node.leaves.map((leaf) => {
          const freshness = leaf.flushStrength * phenology.leafFlushVisibility;
          const lowerFrameworkLeaf = axis.order === 0 && nodeProgress < 0.44;
          const openingAge =
            ROTUNDIFOLIA_PROFILE.cane.lowerFrameworkOpeningAgeYears;
          const openingProgress = smoothstep01(
            progress(ageYears, openingAge[0], openingAge[1]),
          );
          const lowerLeafRetention = lerp(
            1,
            ROTUNDIFOLIA_PROFILE.cane.oldLowerFrameworkLeafRetention,
            openingProgress,
          );
          const retainedWithAge =
            !lowerFrameworkLeaf ||
            keyedRandom(seed, leaf.id, 'old-lower-crown-retention') <
              lowerLeafRetention;
          return {
            id: leaf.id,
            visible: localGrowth > 0.015 && retainedWithAge,
            attachmentPosition: transform(leaf.attachmentPosition),
            position: transform(leaf.position),
            normal: vector(leaf.normal.x, leaf.normal.y, leaf.normal.z),
            azimuth: leaf.azimuth,
            lengthM: leaf.lengthM,
            widthM: leaf.widthM,
            petioleLengthM: leaf.petioleLengthM,
            scale:
              organSizeScale *
              lerp(0.22, 1, Math.min(1, Math.max(localGrowth, 0.01))),
            freshness,
          };
        }),
        racemes: node.racemes.map((raceme) =>
          evaluateRaceme(
            raceme,
            transform,
            ageYears,
            phenology,
            organSizeScale,
          ),
        ),
      };
      axisByNode.set(node.id, evaluatedNode);
      return evaluatedNode;
    });
    axes.push({
      id: axis.id,
      order: axis.order,
      parentId: axis.parentId,
      root,
      growthScale: axisGrowthScale,
      nodes,
    });
  }
  return {
    id: cane.id,
    cohort: cane.cohort,
    birthAgeYears: cane.birthAgeYears,
    ageYears: caneAgeYears,
    growthScale: plantGrowthScale,
    position: vector(cane.position.x, cane.position.y, cane.position.z),
    baseRadiusM: cane.baseRadiusM,
    targetHeightM: cane.targetHeightM,
    removed: false,
    axes,
  };
}

function snapshotDimensions(canes) {
  let heightM = 0;
  let radiusM = 0;
  for (const cane of canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        heightM = Math.max(heightM, node.position.y);
        radiusM = Math.max(
          radiusM,
          Math.hypot(node.position.x, node.position.z),
        );
        for (const leaf of node.leaves) {
          if (!leaf.visible) continue;
          heightM = Math.max(
            heightM,
            leaf.position.y + leaf.lengthM * leaf.scale,
          );
          radiusM = Math.max(
            radiusM,
            Math.hypot(leaf.position.x, leaf.position.z) +
              leaf.widthM * leaf.scale,
          );
        }
        for (const raceme of node.racemes) {
          if (!raceme.visible) continue;
          heightM = Math.max(
            heightM,
            raceme.position.y +
              Math.max(0, raceme.direction.y) * raceme.lengthM * raceme.scale,
          );
          radiusM = Math.max(
            radiusM,
            Math.hypot(raceme.position.x, raceme.position.z) +
              raceme.widthM * raceme.scale,
          );
        }
      }
    }
  }
  return {
    heightM,
    radiusM,
    spreadM: radiusM * 2,
  };
}

function snapshotStats(canes) {
  let visibleAxes = 0;
  let visibleLeaves = 0;
  let visibleRacemes = 0;
  let visibleFlowerRacemes = 0;
  let visibleFruitRacemes = 0;
  let visibleRipeFruitRacemes = 0;
  for (const cane of canes) {
    visibleAxes += cane.axes.length;
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        visibleLeaves += node.leaves.filter((leaf) => leaf.visible).length;
        for (const raceme of node.racemes) {
          if (!raceme.visible) continue;
          visibleRacemes += 1;
          if (raceme.stage === 'flower') visibleFlowerRacemes += 1;
          if (raceme.stage === 'fruit') visibleFruitRacemes += 1;
          if (raceme.ripe) visibleRipeFruitRacemes += 1;
        }
      }
    }
  }
  return {
    visibleCanes: canes.length,
    visibleAxes,
    visibleLeaves,
    visibleRacemes,
    visibleFlowerRacemes,
    visibleFruitRacemes,
    visibleRipeFruitRacemes,
    evergreen: true,
  };
}

function ageAwarePhenology(phenology, stats, ageYears) {
  if (
    ageYears >= ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears ||
    stats.visibleRacemes > 0
  ) {
    return phenology;
  }
  const reproductivePhases = new Set([
    'flower-bud',
    'flowering',
    'fruit-set',
    'fruit-ripening',
    'ripe-fruit',
  ]);
  if (!reproductivePhases.has(phenology.phase)) return phenology;
  const label = 'Juvenile evergreen growth; no racemes yet';
  const activelyGrowing =
    phenology.dayOfYear >= phenology.calendar.shootGrowthStart &&
    phenology.dayOfYear <= phenology.calendar.leafHardeningEnd;
  return Object.freeze({
    ...phenology,
    phase: activelyGrowing ? 'spring-flush' : 'evergreen-rest',
    stage: label,
    label,
    bbch: activelyGrowing ? '10' : '00',
    bbchCode: activelyGrowing ? '10' : '00',
    flowerBudProgress: 0,
    flowerBudVisibility: 0,
    flowerProgress: 0,
    flowerVisibility: 0,
    flowerOpenVisibility: 0,
    fruitSetProgress: 0,
    fruitGrowthProgress: 0,
    fruitVisibility: 0,
    fruitColourProgress: 0,
    redProgress: 0,
    blackProgress: 0,
    ripeFruitVisibility: 0,
    fruitDropProgress: 0,
    featureStage: 'absent',
  });
}

function validateEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (events.length > 0) {
    throw new RangeError(
      'Rotundifolia does not expose destructive care events.',
    );
  }
}

/** Evaluate the immutable graph at one integer age and calendar day. */
export function evaluateRotundifoliaModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 230,
    events = [],
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== ROTUNDIFOLIA_MODEL_KIND) {
    throw new TypeError('Expected a model returned by createRotundifoliaModel');
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
  validateEvents(events);

  const phenology = getRotundifoliaPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  const now = ageYears + phenology.shootGrowthProgress;
  const plantGrowthScale = sampleAnchors(
    ROTUNDIFOLIA_PROFILE.growth.plantAgeScaleAnchors,
    ageYears,
  );
  const canes = model.canes
    .filter((cane) => cane.birthAgeYears <= now)
    .map((cane) =>
      evaluateCane(
        cane,
        model.seed,
        now,
        ageYears,
        phenology,
        plantGrowthScale,
      ),
    );
  const stats = snapshotStats(canes);
  const snapshotPhenology = ageAwarePhenology(phenology, stats, ageYears);
  const careHints = getRotundifoliaCareHints(phenology.dayOfYear, {
    plantAgeYears: ageYears,
    seasonProfile,
    offsetDays,
  }).filter((careHint) => {
    if (
      ageYears >= ROTUNDIFOLIA_PROFILE.growth.firstReliableFloweringAgeYears
    ) {
      return true;
    }
    return !new Set(['observe-spring-racemes', 'fruit-kernel-warning']).has(
      careHint.id,
    );
  });

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    ageYears,
    dayOfYear: phenology.dayOfYear,
    dimensions: snapshotDimensions(canes),
    phenology: snapshotPhenology,
    careHints: Object.freeze(careHints),
    provenance: {
      sources: ROTUNDIFOLIA_SOURCES,
      rendererAssumptions: [
        'bounded eleven-stem persistent framework topology',
        'stable evergreen leaf and recurring raceme slots',
        'short late-life crown-axis cohorts and deterministic lower-framework opening',
        'single representative raceme geometry for buds, flowers and drupes',
      ],
    },
    canes,
    stats,
    appliedEvents: [],
  };
}
