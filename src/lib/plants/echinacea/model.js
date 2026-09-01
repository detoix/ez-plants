import { growWoodyAxis } from '../../woody-axis.js';
import { keyedRandom, keyedRange as randomRange } from '../../keyed-random.js';
import {
  add,
  axisRng,
  clamp01,
  cross,
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
  vector,
} from '../../model-math.js';
import { getMagnusCareHints, getMagnusPhenology } from './phenology.js';
import { MAGNUS_PROFILE, MAGNUS_SOURCES } from './magnus.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UP = vector(0, 1, 0);
const BRANCHED_SHOOT_SEQUENCES = new Set([2, 6, 10]);

function ageAtCount(anchors, target) {
  if (target <= anchors[0][1]) return anchors[0][0];
  for (let index = 1; index < anchors.length; index += 1) {
    const [startAge, startCount] = anchors[index - 1];
    const [endAge, endCount] = anchors[index];
    if (target <= endCount) {
      return lerp(
        startAge,
        endAge,
        (target - startCount) / Math.max(1, endCount - startCount),
      );
    }
  }
  return anchors.at(-1)[0];
}

function axisFromGrowth({
  seed,
  id,
  origin,
  direction,
  length,
  radius,
  sectionCount,
  gnarliness,
}) {
  const sections = growWoodyAxis({
    origin,
    orientation: orientationFor(direction),
    length,
    radius,
    sectionCount,
    gnarliness,
    taper: 0.45,
    force: {
      direction: UP,
      // The original EZ-Tree force step is divided by section radius. This
      // small attraction straightens only the fine upper stem, preserving a
      // little basal divergence without turning a coneflower into a fountain.
      strength: radius * 0.012,
    },
    rng: axisRng(seed, id),
  });
  return {
    points: sections.map((section) =>
      vector(section.origin.x, section.origin.y, section.origin.z),
    ),
    radii: sections.map((section) => section.radius),
  };
}

function makeLeaf(
  seed,
  {
    id,
    shootRoot,
    axisId = null,
    pointIndex = 0,
    position,
    tangent = UP,
    azimuth,
    fraction,
    basal = false,
    birthAgeYears,
  },
) {
  const profile = MAGNUS_PROFILE.leaf;
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const lift = basal ? 1 : lerp(0.5, 0.15, fraction);
  const direction = normalize(
    add(
      add(scale(outward, 1), scale(tangent, lift)),
      scale(sideways, randomRange(seed, [id, 'side-curl'], -0.13, 0.13)),
    ),
  );
  // `normal` is the blade-face normal, not its width direction. The renderer
  // derives local X as forward × normal, so using `sideways` here twisted the
  // blade width partly vertical. sideways × direction gives a mostly upward
  // normal and therefore a tangential, near-horizontal blade width.
  const normal = normalize(
    add(
      cross(sideways, direction),
      scale(sideways, randomRange(seed, [id, 'normal-roll'], -0.09, 0.09)),
    ),
  );
  const lowerWeight = basal ? 1 : Math.pow(1 - fraction, 0.72);
  const lengthRange = [
    lerp(profile.upperLengthM[0], profile.lowerLengthM[0], lowerWeight),
    lerp(profile.upperLengthM[1], profile.lowerLengthM[1], lowerWeight),
  ];
  const widthRange = [
    lerp(profile.upperWidthM[0], profile.lowerWidthM[0], lowerWeight),
    lerp(profile.upperWidthM[1], profile.lowerWidthM[1], lowerWeight),
  ];

  return {
    id,
    shootRoot,
    axisId,
    pointIndex,
    sourcePosition: position,
    direction,
    normal,
    lengthM: randomRange(seed, [id, 'length'], ...lengthRange),
    widthM: randomRange(seed, [id, 'width'], ...widthRange),
    roll: randomRange(seed, [id, 'roll'], -0.28, 0.28),
    fraction,
    basal,
    birthAgeYears,
  };
}

function makeHead(
  seed,
  { id, axisId, shootRoot, birthAgeYears, branch = false },
) {
  const head = MAGNUS_PROFILE.flowerHead;
  const tiltAzimuth = randomRange(seed, [id, 'tilt-azimuth'], 0, Math.PI * 2);
  const tilt = randomRange(seed, [id, 'tilt'], 0.015, 0.18);
  return {
    id,
    axisId,
    shootRoot,
    birthAgeYears,
    firstFloweringAgeYears: branch ? Math.max(2, birthAgeYears) : birthAgeYears,
    diameterM: randomRange(seed, [id, 'diameter'], ...head.diameterM),
    direction: normalize(
      vector(Math.cos(tiltAzimuth) * tilt, 1, Math.sin(tiltAzimuth) * tilt),
    ),
    spin: randomRange(seed, [id, 'spin'], 0, Math.PI * 2),
    bloomOffsetDays: randomRange(
      seed,
      [id, 'bloom-offset'],
      branch ? 26 : -12,
      branch ? 38 : 14,
    ),
    weatherRetention: keyedRandom(seed, id, 'winter-retention'),
    branch,
  };
}

function makeShoot(seed, sequence, birthAgeYears) {
  const architecture = MAGNUS_PROFILE.architecture;
  const stem = MAGNUS_PROFILE.stem;
  const id = `magnus:shoot:${String(sequence).padStart(2, '0')}`;
  const radialFraction = Math.sqrt(
    (sequence + 0.45) / architecture.maximumPrimaryShoots,
  );
  const azimuth =
    sequence * GOLDEN_ANGLE +
    randomRange(seed, [id, 'azimuth-jitter'], -0.22, 0.22);
  const rootRadius = architecture.matureCrownRadiusM * radialFraction;
  const root = vector(
    Math.cos(azimuth) * rootRadius,
    0,
    Math.sin(azimuth) * rootRadius,
  );
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const lean = randomRange(seed, [id, 'basal-lean'], 0.025, 0.095);
  const direction = normalize(
    add(
      add(UP, scale(outward, lean)),
      scale(sideways, randomRange(seed, [id, 'side-lean'], -0.045, 0.045)),
    ),
  );
  const height = randomRange(seed, [id, 'height'], ...stem.targetHeightM);
  const radius = randomRange(seed, [id, 'radius'], ...stem.baseRadiusM);
  const mainId = `${id}:axis:main`;
  const mainGrowth = axisFromGrowth({
    seed,
    id: mainId,
    origin: root,
    direction,
    length: height,
    radius,
    sectionCount: stem.mainAxisSections,
    gnarliness: 0.00028,
  });
  const mainAxis = {
    id: mainId,
    shootId: id,
    shootRoot: root,
    kind: 'main',
    birthAgeYears,
    parentAxisId: null,
    parentPointIndex: null,
    ...mainGrowth,
  };

  const leaves = [];
  for (let basalIndex = 0; basalIndex < 3; basalIndex += 1) {
    leaves.push(
      makeLeaf(seed, {
        id: `${id}:leaf:basal:${basalIndex}`,
        shootRoot: root,
        position: vector(root.x, 0.008 + basalIndex * 0.006, root.z),
        tangent: UP,
        azimuth: azimuth + Math.PI * (0.46 + basalIndex * 0.82),
        fraction: 0,
        basal: true,
        birthAgeYears,
      }),
    );
  }

  // Six alternate cauline leaves: a dense lower half, then progressively
  // smaller blades below the exposed upper peduncle seen in cultivar photos.
  const leafPointIndices = [1, 2, 3, 4, 5, 6];
  leafPointIndices.forEach((pointIndex, leafIndex) => {
    const fraction = pointIndex / (mainAxis.points.length - 1);
    leaves.push(
      makeLeaf(seed, {
        id: `${id}:leaf:${leafIndex}`,
        shootRoot: root,
        axisId: mainId,
        pointIndex,
        position: mainAxis.points[pointIndex],
        tangent: tangentAt(mainAxis.points, pointIndex),
        azimuth:
          azimuth +
          leafIndex * GOLDEN_ANGLE +
          randomRange(seed, [id, 'leaf-azimuth', leafIndex], -0.16, 0.16),
        fraction,
        birthAgeYears,
      }),
    );
  });

  const axes = [mainAxis];
  const heads = [
    makeHead(seed, {
      id: `${mainId}:head`,
      axisId: mainId,
      shootRoot: root,
      birthAgeYears,
    }),
  ];

  if (BRANCHED_SHOOT_SEQUENCES.has(sequence)) {
    const parentPointIndex = 6;
    const branchRoot = mainAxis.points[parentPointIndex];
    const branchId = `${id}:axis:lateral`;
    const branchSide = sequence % 2 === 0 ? 1 : -1;
    const branchDirection = normalize(
      add(
        scale(UP, 0.88),
        add(scale(outward, 0.42), scale(sideways, branchSide * 0.2)),
      ),
    );
    const branchGrowth = axisFromGrowth({
      seed,
      id: branchId,
      origin: branchRoot,
      direction: branchDirection,
      length: randomRange(seed, [branchId, 'length'], 0.18, 0.23),
      radius: radius * 0.64,
      sectionCount: stem.lateralAxisSections,
      gnarliness: 0.00022,
    });
    const branchBirthAgeYears = Math.max(2, birthAgeYears);
    const branchAxis = {
      id: branchId,
      shootId: id,
      shootRoot: root,
      kind: 'lateral',
      birthAgeYears: branchBirthAgeYears,
      parentAxisId: mainId,
      parentPointIndex,
      ...branchGrowth,
    };
    axes.push(branchAxis);
    leaves.push(
      makeLeaf(seed, {
        id: `${branchId}:leaf`,
        shootRoot: root,
        axisId: branchId,
        pointIndex: 1,
        position: branchAxis.points[1],
        tangent: tangentAt(branchAxis.points, 1),
        azimuth: azimuth + Math.PI * 0.4 * branchSide,
        fraction: 0.78,
        birthAgeYears: branchBirthAgeYears,
      }),
    );
    heads.push(
      makeHead(seed, {
        id: `${branchId}:head`,
        axisId: branchId,
        shootRoot: root,
        birthAgeYears: branchBirthAgeYears,
        branch: true,
      }),
    );
  }

  return {
    id,
    sequence,
    birthAgeYears,
    root,
    axes,
    leaves,
    heads,
  };
}

function assertModelOptions(seed, maxYears) {
  if (!['string', 'number'].includes(typeof seed)) {
    throw new TypeError('seed must be a string or number');
  }
  if (!Number.isInteger(maxYears) || maxYears < 1 || maxYears > 50) {
    throw new RangeError('maxYears must be an integer from 1 to 50');
  }
}

/** Build the finite all-ages crown and annual shoot sites once. */
export function createMagnusModel({
  seed = 'magnus-demo',
  maxYears = MAGNUS_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertModelOptions(seed, maxYears);
  const anchors = MAGNUS_PROFILE.architecture.shootCountAnchors;
  const shoots = [];
  for (
    let sequence = 0;
    sequence < MAGNUS_PROFILE.architecture.maximumPrimaryShoots;
    sequence += 1
  ) {
    const birthAgeYears = ageAtCount(anchors, sequence + 1);
    if (birthAgeYears > maxYears) continue;
    shoots.push(makeShoot(seed, sequence, birthAgeYears));
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: 'echinacea-magnus-growth-model',
    species: MAGNUS_PROFILE.species,
    cultivar: MAGNUS_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: MAGNUS_PROFILE.metresPerUnit,
    shoots,
  });
}

function validateEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (events.length > 0) {
    throw new RangeError(
      'Magnus exposes no destructive care events; winter retention and the annual cut are part of the cultivar calendar.',
    );
  }
}

function plantMode(phenology, ageYears) {
  const day = phenology.dayOfYear;
  if (day < phenology.calendar.cutbackEnd) {
    return ageYears > 0 && phenology.standingDryVisibility > 0.01
      ? 'previous-dry'
      : 'dormant';
  }
  if (day >= phenology.calendar.dryFull) return 'current-dry';
  if (day >= phenology.calendar.emergenceStart) return 'current';
  return 'dormant';
}

function overwinterWeathering(phenology) {
  const elapsedDryDays =
    phenology.dayOfYear >= phenology.calendar.dryFull
      ? phenology.dayOfYear - phenology.calendar.dryFull
      : phenology.dayOfYear + 365 - phenology.calendar.dryFull;
  return clamp01(elapsedDryDays / 145);
}

function transformPrimaryAxis(axis, crownScale, stemScale) {
  const root = scale(axis.shootRoot, crownScale);
  const points = axis.points.map((point) =>
    add(root, scale(subtract(point, axis.shootRoot), stemScale)),
  );
  return { ...axis, root, points };
}

function transformLateralAxis(axis, parent, branchScale) {
  const root = parent.points[axis.parentPointIndex];
  const sourceRoot = axis.points[0];
  const points = axis.points.map((point) =>
    add(root, scale(subtract(point, sourceRoot), branchScale)),
  );
  return { ...axis, root, points };
}

function localHeadState(head, phenology, dryMode) {
  if (dryMode) {
    // A retained cone keeps weathering across the year boundary. Basing the
    // autumn half on `dryProgress` made heads jump from old to newly fresh at
    // dryFull, then jump fresh again on 1 January when the wrapped branch took
    // over. Elapsed days since the same dryFull anchor is continuous.
    const retentionWeathering = overwinterWeathering(phenology);
    return {
      visible: head.weatherRetention > retentionWeathering * 0.36,
      stage: 'seed-head',
      budProgress: 1,
      openProgress: 1,
      fadeProgress: 1,
      seedProgress: 1,
      rayVisibility: 0,
      visualScale: 0.72,
      // Colour had already reached its weathered endpoint at dryFull. Keep it
      // there across New Year while the separate retention clock gradually
      // removes the weakest cones.
      weathering: 1,
    };
  }

  const day = phenology.dayOfYear;
  const calendar = phenology.calendar;
  const offset = Math.round(head.bloomOffsetDays);
  const budStart = calendar.budStart + offset;
  const floweringStart = calendar.floweringStart + offset;
  // Individual heads do not remain pristine for the entire clump-scale
  // July-September season. A 24/34/48-day ray-fade, seed-set and completion
  // sequence, combined with later lateral heads, produces the mixed plateau
  // of buds, fresh rays and fading heads visible in exact-cultivar photos.
  const rayFadeStart = floweringStart + 24;
  const seedHeadStart = floweringStart + 34;
  const floweringEnd = floweringStart + 48;
  if (day < budStart) return { visible: false };

  const budProgress = progress(day, budStart, floweringStart);
  const openProgress = progress(day, floweringStart, floweringStart + 10);
  const fadeProgress = progress(day, rayFadeStart, floweringEnd);
  const seedProgress = progress(day, seedHeadStart, floweringEnd);
  // Rays unfold only as the head opens, then disappear during senescence.
  // The renderer consumes this independently of the persistent disc cone.
  const rayVisibility = openProgress * (1 - fadeProgress);
  const visualScale =
    lerp(0.24, 1, smoothstep01(Math.max(budProgress, openProgress))) *
    lerp(1, 0.72, fadeProgress);
  const stage =
    day < floweringStart
      ? 'bud'
      : openProgress < 0.95
        ? 'opening'
        : fadeProgress < 0.18
          ? 'open'
          : seedProgress < 0.68
            ? 'fading'
            : 'seed-head';
  return {
    visible: true,
    stage,
    budProgress,
    openProgress,
    fadeProgress,
    seedProgress,
    rayVisibility,
    visualScale,
    weathering: phenology.dryProgress,
  };
}

function evaluateLeaf(
  leaf,
  axes,
  {
    mode,
    ageScale,
    crownScale,
    leafExpansion,
    leafDropProgress,
    stemGrowth,
    seed,
  },
) {
  if (mode !== 'current') return null;
  if (leafExpansion <= 0.01) return null;
  const localLeafProgress = leaf.basal
    ? leafExpansion
    : progress(
        stemGrowth,
        leaf.fraction * 0.82,
        Math.min(1, leaf.fraction * 0.82 + 0.16),
      );
  if (localLeafProgress <= 0.01) return null;
  if (
    leafDropProgress > 0 &&
    keyedRandom(seed, leaf.id, 'autumn-retention') < leafDropProgress
  ) {
    return null;
  }

  const position = leaf.axisId
    ? axes.get(leaf.axisId)?.points[leaf.pointIndex]
    : scale(leaf.sourcePosition, crownScale);
  if (!position) return null;
  const expansion = smoothstep01(Math.min(leafExpansion, localLeafProgress));
  return {
    id: leaf.id,
    visible: true,
    position,
    direction: leaf.direction,
    normal: leaf.normal,
    roll: leaf.roll,
    basal: leaf.basal,
    lengthM: leaf.lengthM * ageScale * lerp(0.12, 1, expansion),
    widthM: leaf.widthM * ageScale * lerp(0.35, 1, expansion),
    autumnProgress: leafDropProgress,
  };
}

function dimensionsFor(axes, leaves, heads) {
  let heightM = 0;
  let radiusM = 0;
  for (const axis of axes) {
    if (!axis.visible) continue;
    for (const point of axis.points) {
      heightM = Math.max(heightM, point.y);
      radiusM = Math.max(radiusM, Math.hypot(point.x, point.z));
    }
  }
  for (const leaf of leaves) {
    const tip = add(leaf.position, scale(leaf.direction, leaf.lengthM));
    heightM = Math.max(heightM, tip.y);
    radiusM = Math.max(radiusM, Math.hypot(tip.x, tip.z) + leaf.widthM * 0.5);
  }
  for (const head of heads) {
    heightM = Math.max(heightM, head.position.y + head.diameterM * 0.27);
    radiusM = Math.max(
      radiusM,
      Math.hypot(head.position.x, head.position.z) + head.diameterM * 0.5,
    );
  }
  return { heightM, radiusM, spreadM: radiusM * 2 };
}

/** Evaluate the immutable crown at one age and calendar day. */
export function evaluateMagnusModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 205,
    events = [],
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'echinacea-magnus-growth-model') {
    throw new TypeError('Expected a model returned by createMagnusModel');
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

  const phenology = getMagnusPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  const mode = plantMode(phenology, ageYears);
  // Before spring cutback, the visible top growth belongs to the preceding
  // growing season. Using the newly incremented age invented extra dry stems
  // on 1 January; evaluate that cohort at the age it actually grew.
  const cohortAgeYears =
    mode === 'previous-dry' ? Math.max(0, ageYears - 1) : ageYears;
  const ageScale = sampleAnchors(
    MAGNUS_PROFILE.growth.plantAgeScaleAnchors,
    cohortAgeYears,
  );
  const crownRadius = sampleAnchors(
    MAGNUS_PROFILE.architecture.crownRadiusAnchorsM,
    cohortAgeYears,
  );
  const crownScale =
    crownRadius / MAGNUS_PROFILE.architecture.matureCrownRadiusM;
  const dryMode = mode === 'previous-dry' || mode === 'current-dry';
  const stemGrowth = dryMode
    ? 1
    : mode === 'current'
      ? smoothstep01(phenology.stemGrowthProgress)
      : 0;
  const primaryScale = ageScale * stemGrowth;
  const branchGrowth = dryMode
    ? 1
    : smoothstep01(progress(stemGrowth, 0.58, 1));
  const branchScale = ageScale * branchGrowth;

  const activeShoots = model.shoots.filter(
    (shoot) => shoot.birthAgeYears <= cohortAgeYears,
  );
  const axes = [];
  const axisMap = new Map();
  for (const shoot of activeShoots) {
    if (
      mode === 'previous-dry' &&
      keyedRandom(model.seed, shoot.id, 'spring-cutback-order') >=
        phenology.standingDryVisibility
    ) {
      continue;
    }
    const primary = shoot.axes[0];
    if (primaryScale > 0.002) {
      const evaluated = transformPrimaryAxis(primary, crownScale, primaryScale);
      evaluated.visible = true;
      evaluated.cohort = dryMode ? 'dry' : 'current';
      evaluated.weathering = dryMode
        ? overwinterWeathering(phenology)
        : phenology.dryProgress;
      evaluated.radiusScale = ageScale * lerp(0.5, 1, stemGrowth);
      axes.push(evaluated);
      axisMap.set(evaluated.id, evaluated);
    }
    for (const branch of shoot.axes.slice(1)) {
      if (branch.birthAgeYears > cohortAgeYears || branchScale <= 0.002) {
        continue;
      }
      const parent = axisMap.get(branch.parentAxisId);
      if (!parent) continue;
      const evaluated = transformLateralAxis(branch, parent, branchScale);
      evaluated.visible = true;
      evaluated.cohort = dryMode ? 'dry' : 'current';
      evaluated.weathering = dryMode
        ? overwinterWeathering(phenology)
        : phenology.dryProgress;
      evaluated.radiusScale = ageScale * lerp(0.42, 1, branchGrowth);
      axes.push(evaluated);
      axisMap.set(evaluated.id, evaluated);
    }
  }

  const leaves = [];
  const leafExpansion = Math.max(
    phenology.leafProgress,
    phenology.emergenceProgress * 0.8,
  );
  for (const shoot of activeShoots) {
    for (const leaf of shoot.leaves) {
      if (leaf.birthAgeYears > cohortAgeYears) continue;
      const evaluated = evaluateLeaf(leaf, axisMap, {
        mode,
        ageScale,
        crownScale,
        leafExpansion,
        leafDropProgress: phenology.leafDropProgress,
        stemGrowth,
        seed: model.seed,
      });
      if (evaluated) leaves.push(evaluated);
    }
  }

  const heads = [];
  const headSupports = [];
  for (const shoot of activeShoots) {
    for (const head of shoot.heads) {
      if (head.firstFloweringAgeYears > cohortAgeYears) continue;
      const axis = axisMap.get(head.axisId);
      if (!axis) continue;
      const state = localHeadState(head, phenology, dryMode);
      const sourceDirection = head.direction;
      const stemDirection = tangentAt(axis.points, axis.points.length - 1);
      const direction = normalize(
        add(scale(sourceDirection, 0.78), scale(stemDirection, 0.22)),
      );
      const common = {
        id: head.id,
        axisId: head.axisId,
        position: axis.points.at(-1),
        // A coarse head owns its supporting stalk in the same draw. Ground a
        // lateral head at its shoot crown too, so independent winter retention
        // cannot leave a surviving fork floating after the main cone drops.
        stemBasePosition:
          axis.kind === 'lateral'
            ? (axisMap.get(axis.parentAxisId)?.points[0] ?? axis.points[0])
            : axis.points[0],
        direction,
        spin: head.spin,
      };
      if (!state.visible) {
        // At coarse LOD every flowering axis still needs its ground-connected
        // stalk, even before its bud appears or after its cone drops. The head
        // mesh can collapse just the capitulum and retain its integrated
        // peduncle, so all shoots remain supported within the two-draw budget.
        headSupports.push({
          ...common,
          cohort: axis.cohort,
          weathering: axis.weathering,
          diameterM: head.diameterM * ageScale,
          verticalScale: 1,
          rayVisibility: 0,
        });
        continue;
      }
      heads.push({
        ...common,
        visible: true,
        diameterM: head.diameterM * ageScale * state.visualScale,
        verticalScale:
          state.stage === 'bud'
            ? lerp(1.45, 1, state.budProgress)
            : lerp(1, 0.84, state.fadeProgress),
        ...state,
      });
    }
  }

  const visiblePrimaryStems = axes.filter(
    (axis) => axis.kind === 'main',
  ).length;
  const openFlowers = heads.filter(
    (head) => head.stage === 'open' || head.stage === 'opening',
  ).length;
  const flowerBuds = heads.filter((head) => head.stage === 'bud').length;
  const seedHeads = heads.filter((head) => head.stage === 'seed-head').length;
  const stats = {
    visibleShoots: visiblePrimaryStems,
    visibleStems: visiblePrimaryStems,
    visibleAxes: axes.length,
    visibleLeaves: leaves.length,
    visibleHeads: heads.length,
    visibleFlowers: openFlowers,
    visibleFlowerBuds: flowerBuds,
    visibleSeedHeads: seedHeads,
    flowersOnCurrentSeasonStems: true,
  };
  const careHints = getMagnusCareHints(phenology.dayOfYear, {
    plantAgeYears: ageYears,
    seasonProfile,
    offsetDays,
  });

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    ageYears,
    dayOfYear: phenology.dayOfYear,
    mode,
    crown: { radiusM: crownRadius, shootSites: activeShoots.length },
    dimensions: dimensionsFor(axes, leaves, heads),
    phenology,
    careHints,
    provenance: {
      observedDisplay: MAGNUS_PROFILE.flowering.observedDisplay,
      sources: MAGNUS_SOURCES,
      rendererAssumptions: [
        'twelve primary shoot sites and three single upper forks represent the cited third-year ceiling of roughly fifteen flower heads',
        'seeded EZ-Tree axes provide subtle stem irregularity while preserving the cultivar upright habit',
        'the photo-matched mature render targets roughly 0.56 m spread; seeded blade and lateral-head variation may sit just outside the broad RHS spread category',
        'individual head dates and a modelled 24/34/48-day fade, seed-set and completion sequence are staggered across the observed July-September display',
        'dry stems and seed heads stand through winter and are removed across the modelled late-winter cutback window',
      ],
    },
    shoots: activeShoots.map((shoot) => ({
      id: shoot.id,
      sequence: shoot.sequence,
      birthAgeYears: shoot.birthAgeYears,
    })),
    axes,
    leaves,
    heads,
    headSupports,
    stats,
    appliedEvents: [],
  };
}
