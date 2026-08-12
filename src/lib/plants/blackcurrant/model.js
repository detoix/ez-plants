import {
  TISEL_CALENDAR,
  getTiselCareHints,
  getTiselPhenology,
} from './phenology.js';
import { TISEL_PROFILE } from './tisel.js';
import {
  keyedInteger as randomInt,
  keyedRandom,
  keyedRange as randomRange,
} from '../../keyed-random.js';

export { keyedRandom };

const TAU = Math.PI * 2;
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

function mainAxisPoints(seed, cane) {
  const count = randomInt(
    seed,
    [cane.id, 'main-node-count'],
    TISEL_PROFILE.cane.mainAxisNodeCount[0],
    TISEL_PROFILE.cane.mainAxisNodeCount[1],
  );
  const points = [];
  const outward = vector(Math.cos(cane.azimuth), 0, Math.sin(cane.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const tipDroop = randomRange(
    seed,
    [cane.id, 'tip-droop'],
    0.015,
    0.065 + cane.lean * 0.08,
  );
  const swayPhase = keyedRandom(seed, cane.id, 'sway-phase') * TAU;

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const radial =
      cane.lean * cane.targetHeightM * (0.22 * t + 0.78 * Math.pow(t, 1.55));
    const sway =
      (Math.sin(t * Math.PI * 1.65 + swayPhase) +
        Math.sin(t * Math.PI * 3.4 + swayPhase * 0.37) * 0.36) *
      0.038 *
      t;
    const height = cane.targetHeightM * (t - tipDroop * Math.pow(t, 4));
    points.push(
      add(
        cane.position,
        add(
          scale(outward, radial),
          add(scale(sideways, sway), vector(0, height, 0)),
        ),
      ),
    );
  }
  return points;
}

function lateralAxisPoints(seed, cane, mainPoints, lateralIndex, lateralCount) {
  const attachFraction = clamp(
    0.2 +
      ((lateralIndex +
        randomRange(
          seed,
          [cane.id, 'attach-jitter', lateralIndex],
          0.22,
          0.78,
        )) /
        Math.max(1, lateralCount)) *
        0.7,
    0.18,
    0.9,
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
      randomRange(seed, [cane.id, 'lateral-angle', lateralIndex], 0.62, 1.42) +
    lateralIndex * 0.13;
  const horizontal = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const axisLength = randomRange(
    seed,
    [cane.id, 'lateral-length', lateralIndex],
    0.22,
    0.44 - attachFraction * 0.05,
  );
  const count = randomInt(
    seed,
    [cane.id, 'lateral-node-count', lateralIndex],
    5,
    8,
  );
  const rise = randomRange(
    seed,
    [cane.id, 'lateral-rise', lateralIndex],
    0.65,
    0.95,
  );
  const distalDroop = randomRange(
    seed,
    [cane.id, 'lateral-droop', lateralIndex],
    0.04,
    0.18,
  );
  const curveSide = vector(-horizontal.z, 0, horizontal.x);
  const sideCurve = randomRange(
    seed,
    [cane.id, 'lateral-side-curve', lateralIndex],
    -0.11,
    0.11,
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

function makeLeaf(seed, node, year, leafIndex = 0) {
  const id = `${node.id}:leaf:y${year}:${leafIndex}`;
  const side = node.index % 2 === 0 ? 1 : -1;
  const azimuth =
    node.azimuth +
    side * randomRange(seed, [id, 'azimuth'], 0.82, 1.24) +
    leafIndex * Math.PI;
  const petioleLengthM = randomRange(
    seed,
    [id, 'petiole'],
    TISEL_PROFILE.leaf.petioleLengthM[0],
    TISEL_PROFILE.leaf.petioleLengthM[1],
  );
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const bladeTilt = randomRange(seed, [id, 'blade-tilt'], 0.38, 0.78);
  const bladeRoll = randomRange(seed, [id, 'blade-roll'], -0.2, 0.2);
  const position = add(
    node.position,
    add(scale(outward, petioleLengthM), vector(0, 0.008, 0)),
  );
  const widthM = randomRange(
    seed,
    [id, 'width'],
    TISEL_PROFILE.leaf.widthM[0],
    TISEL_PROFILE.leaf.widthM[1],
  );

  return {
    id,
    year,
    position,
    // Currant blades are neither horizontal cards nor randomly vertical.
    // Photo-guided outward tilt and modest roll keep the upper surface exposed
    // while giving a mature bush its characteristic overlapping leafy volume.
    normal: normalize(
      add(
        vector(0, 1, 0),
        add(scale(outward, bladeTilt), scale(sideways, bladeRoll)),
      ),
    ),
    azimuth,
    rotation: randomRange(seed, [id, 'rotation'], -0.22, 0.22),
    widthM,
    lengthM: widthM * randomRange(seed, [id, 'aspect'], 0.82, 1.04),
    scale: widthM,
  };
}

function makeRaceme(seed, node, fruitingYear) {
  const id = `${node.id}:raceme:y${fruitingYear}`;
  const racemeLengthM = randomRange(
    seed,
    [id, 'length'],
    TISEL_PROFILE.raceme.lengthM[0],
    TISEL_PROFILE.raceme.lengthM[1],
  );
  const outward = vector(Math.cos(node.azimuth), 0, Math.sin(node.azimuth));
  const position = add(node.position, scale(outward, 0.014));
  const direction = normalize(add(vector(0, -1, 0), scale(outward, 0.28)));
  const side = normalize(vector(-direction.z, 0, direction.x));
  const berryCount = randomInt(
    seed,
    [id, 'berry-count'],
    TISEL_PROFILE.raceme.berries[0],
    TISEL_PROFILE.raceme.berries[1],
  );
  const berries = [];

  for (let index = 0; index < berryCount; index += 1) {
    const berryId = `${id}:berry:${index}`;
    const t = (index + 1) / (berryCount + 1);
    const diameterM = randomRange(
      seed,
      [berryId, 'diameter'],
      TISEL_PROFILE.berry.diameterM[0],
      TISEL_PROFILE.berry.diameterM[1],
    );
    const alternating = index % 2 === 0 ? -1 : 1;
    const berryPosition = add(
      add(position, scale(direction, racemeLengthM * t)),
      scale(side, alternating * diameterM * 0.42),
    );
    berries.push({
      id: berryId,
      index,
      position: berryPosition,
      diameterM,
      radiusM: diameterM / 2,
      scale: diameterM,
      massG: randomRange(
        seed,
        [berryId, 'mass'],
        TISEL_PROFILE.berry.massG[0],
        TISEL_PROFILE.berry.massG[1],
      ),
    });
  }

  return {
    id,
    nodeId: node.id,
    fruitingYear,
    position,
    direction,
    lengthM: racemeLengthM,
    flowerCount: berryCount,
    berries,
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
    racemes: [],
  };
  const firstLeafYear = Math.floor(axis.birthAgeYears);
  const finalYear = Math.min(Math.ceil(deathAgeYears), maxYears + 1);

  for (let year = firstLeafYear; year < finalYear; year += 1) {
    node.leaves.push(makeLeaf(seed, node, year));
  }

  const firstFruitYear = Math.floor(axis.birthAgeYears) + 1;
  const lastFruitYear = Math.min(finalYear - 1, firstFruitYear + 3);
  const bearsFruit =
    index >= 2 && keyedRandom(seed, node.id, 'fruiting-node') > 0.46;
  if (bearsFruit) {
    for (let year = firstFruitYear; year <= lastFruitYear; year += 1) {
      node.racemes.push(makeRaceme(seed, node, year));
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
  const id = `tisel:c${cycleIndex}:cane:${cohort}:${String(sequence).padStart(2, '0')}`;
  const baseAngle =
    (sequence / TISEL_PROFILE.architecture.initialCaneCount) * TAU +
    cycleIndex * 0.47;
  const azimuth =
    baseAngle + randomRange(seed, [id, 'azimuth-jitter'], -0.21, 0.21);
  const crownRadius = randomRange(
    seed,
    [id, 'crown-radius'],
    0.018,
    TISEL_PROFILE.cane.crownRadiusM,
  );
  const position = vector(
    Math.cos(azimuth) * crownRadius,
    0,
    Math.sin(azimuth) * crownRadius,
  );
  const targetHeightM = randomRange(
    seed,
    [id, 'height'],
    TISEL_PROFILE.cane.targetHeightM[0],
    TISEL_PROFILE.cane.targetHeightM[1],
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
    lean: randomRange(seed, [id, 'lean'], 0.12, 0.32),
    targetHeightM,
    height: targetHeightM,
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      TISEL_PROFILE.cane.baseRadiusM[0],
      TISEL_PROFILE.cane.baseRadiusM[1],
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
    TISEL_PROFILE.cane.lateralAxisCount[0],
    TISEL_PROFILE.cane.lateralAxisCount[1],
  );
  for (let index = 0; index < lateralCount; index += 1) {
    const lateral = lateralAxisPoints(
      seed,
      cane,
      mainPoints,
      index,
      lateralCount,
    );
    const lateralCohortYear =
      1 +
      Math.floor(
        (index * Math.max(1, TISEL_PROFILE.cane.productiveLifeYears - 1)) /
          Math.max(1, lateralCount),
      );
    const lateralBirthAgeYears =
      birthAgeYears +
      lateralCohortYear +
      randomRange(seed, [id, 'lateral-birth', index], 0.22, 0.3);
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
export function createTiselModel({ seed = 'tisel-demo', maxYears = 50 } = {}) {
  assertModelOptions(seed, maxYears);
  const canes = [];
  const cycleYears = TISEL_PROFILE.architecture.replacementCycleYears;

  for (let cycleStart = 0; cycleStart <= maxYears; cycleStart += cycleYears) {
    const cycleIndex = cycleStart / cycleYears;
    const cycleEnd = cycleStart + cycleYears;
    for (
      let index = 0;
      index < TISEL_PROFILE.architecture.initialCaneCount;
      index += 1
    ) {
      canes.push(
        makeCane(seed, {
          cycleIndex,
          sequence: index,
          cohort: 'initial',
          birthAgeYears: cycleStart,
          scheduledRemovalAgeYears: Math.min(cycleEnd, cycleStart + 4 + index),
          naturalDeathAgeYears: cycleEnd,
          maxYears,
        }),
      );
    }

    for (
      let localYear = TISEL_PROFILE.architecture.renewalStartsAfterYear + 1;
      localYear < cycleYears && cycleStart + localYear <= maxYears;
      localYear += 1
    ) {
      const renewalEmergenceDay = randomRange(
        seed,
        [`tisel:c${cycleIndex}:renewal:${localYear}`, 'emergence-day'],
        TISEL_PROFILE.growth.renewalEmergenceDayRange[0],
        TISEL_PROFILE.growth.renewalEmergenceDayRange[1],
      );
      canes.push(
        makeCane(seed, {
          cycleIndex,
          sequence: localYear,
          cohort: 'renewal',
          birthAgeYears:
            cycleStart + localYear + (renewalEmergenceDay - 1) / 365,
          scheduledRemovalAgeYears: Math.min(
            cycleEnd,
            cycleStart + localYear + TISEL_PROFILE.cane.productiveLifeYears + 1,
          ),
          naturalDeathAgeYears: cycleEnd,
          maxYears,
        }),
      );
    }
  }

  return {
    schemaVersion: 1,
    kind: 'blackcurrant-growth-model',
    species: TISEL_PROFILE.species,
    cultivar: TISEL_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: TISEL_PROFILE.metresPerUnit,
    profile: TISEL_PROFILE,
    canes,
  };
}

export function createPruneEvent({ id, caneId, ageYears, dayOfYear = 1 }) {
  if (!caneId) throw new TypeError('caneId is required for a prune event');
  if (!Number.isInteger(ageYears) || ageYears < 0) {
    throw new TypeError('ageYears must be a non-negative integer');
  }
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
    throw new TypeError('dayOfYear must be an integer from 1 to 365');
  }
  return Object.freeze({
    id: id ?? `prune:${caneId}:${ageYears}:${dayOfYear}`,
    type: 'prune',
    method: 'whole-cane-at-crown',
    caneId,
    ageYears,
    dayOfYear,
  });
}

export function createHarvestEvent({
  id,
  ageYears,
  dayOfYear = 172,
  racemeId = null,
  amountKg,
  note,
}) {
  if (!Number.isInteger(ageYears) || ageYears < 0) {
    throw new TypeError('ageYears must be a non-negative integer');
  }
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
    throw new TypeError('dayOfYear must be an integer from 1 to 365');
  }
  if (amountKg != null && (!Number.isFinite(amountKg) || amountKg < 0)) {
    throw new TypeError('amountKg must be a non-negative finite number');
  }
  return Object.freeze({
    id: id ?? `harvest:${racemeId ?? 'all'}:${ageYears}:${dayOfYear}`,
    type: 'harvest',
    ageYears,
    dayOfYear,
    racemeId,
    ...(amountKg == null ? {} : { amountKg }),
    ...(note == null ? {} : { note: String(note) }),
  });
}

const eventTime = (event) => {
  if (!Number.isInteger(event?.ageYears) || event.ageYears < 0) {
    throw new TypeError('event ageYears must be a non-negative integer');
  }
  const day = event.dayOfYear ?? 1;
  if (!Number.isInteger(day) || day < 1 || day > 365) {
    throw new TypeError('event dayOfYear must be an integer from 1 to 365');
  }
  return event.ageYears + (day - 1) / 365;
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

function vegetativeGrowthProgress(day, calendar = TISEL_CALENDAR) {
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
  calendar = TISEL_CALENDAR,
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

function evaluateCane(
  seed,
  cane,
  now,
  currentYear,
  phenology,
  harvestedRacemeDays,
  harvestAllDay,
) {
  const caneBirthAgeYears = effectiveCaneBirthAge(cane, phenology);
  const caneAgeYears =
    currentYear -
    Math.floor(caneBirthAgeYears) +
    vegetativeGrowthProgress(phenology.dayOfYear, phenology.calendar);
  const growthScale = sampleAnchors(
    TISEL_PROFILE.growth.caneAgeScaleAnchors,
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
      const nodeBirthAgeYears =
        node.birthAgeYears + (axisBirthAgeYears - axis.birthAgeYears);
      if (nodeBirthAgeYears > now) continue;
      const nodePosition = transformAxisPoint(node.position);
      const leaves = node.leaves
        .filter((leaf) => leaf.year === currentYear)
        .map((leaf) => {
          const unfoldDurationYears =
            randomRange(seed, [leaf.id, 'unfold-days'], 10, 20) / 365;
          const unfoldProgress = smoothstep01(
            (now - nodeBirthAgeYears) / unfoldDurationYears,
          );
          const seasonalThreshold = keyedRandom(
            seed,
            leaf.id,
            'seasonal-presence',
          );
          return {
            ...leaf,
            position: transformAxisPoint(leaf.position),
            normal: vector(leaf.normal.x, leaf.normal.y, leaf.normal.z),
            visible:
              phenology.leafOpacity > seasonalThreshold &&
              unfoldProgress > 0.01,
            opacity: phenology.leafOpacity,
            unfoldProgress,
            scale:
              leaf.scale *
              clamp(phenology.leafProgress, 0.12, 1) *
              unfoldProgress,
          };
        });
      const racemes = node.racemes
        .filter((raceme) => raceme.fruitingYear === currentYear)
        .map((raceme) => {
          const specificHarvestDay = harvestedRacemeDays.get(raceme.id);
          const harvestDay =
            harvestAllDay == null
              ? (specificHarvestDay ?? null)
              : specificHarvestDay == null
                ? harvestAllDay
                : Math.min(harvestAllDay, specificHarvestDay);
          const harvestRequested = harvestDay != null;
          const harvestDropProgress = harvestRequested
            ? getTiselPhenology(harvestDay, {
                trialYear: phenology.trialYear,
                offsetDays: phenology.offsetDays,
              }).fruitDropProgress
            : null;
          const berries = raceme.berries.map((berry) => {
            const retentionThreshold = keyedRandom(
              seed,
              berry.id,
              'overripe-retention',
            );
            const droppedBeforeHarvest =
              harvestRequested && harvestDropProgress > retentionThreshold;
            const retainedNow =
              phenology.fruitDropProgress <= retentionThreshold;
            const harvested = harvestRequested && !droppedBeforeHarvest;
            const dropped = harvestRequested
              ? droppedBeforeHarvest
              : phenology.fruitDropProgress > 0 && !retainedNow;
            return {
              ...berry,
              position: transformAxisPoint(berry.position),
              harvested,
              retained: harvestRequested ? !droppedBeforeHarvest : retainedNow,
              dropped,
              ripe: phenology.dayOfYear >= phenology.calendar.harvestStart,
              visible:
                phenology.berryVisibility > 0.015 &&
                !harvestRequested &&
                retainedNow,
              growth: phenology.fruitProgress,
              colourProgress: phenology.fruitColorProgress,
            };
          });
          return {
            ...raceme,
            position: transformAxisPoint(raceme.position),
            direction: vector(
              raceme.direction.x,
              raceme.direction.y,
              raceme.direction.z,
            ),
            harvested: harvestRequested,
            visible:
              phenology.flowerVisibility > 0.015 ||
              berries.some((berry) => berry.visible),
            flowerProgress: phenology.flowerProgress,
            flowerVisibility: phenology.flowerVisibility,
            flowerOpenVisibility: phenology.flowerOpenVisibility,
            fruitProgress: phenology.fruitProgress,
            fruitColorProgress: phenology.fruitColorProgress,
            berryVisibility: phenology.berryVisibility,
            berries,
          };
        });
      nodes.push({
        ...node,
        birthAgeYears: nodeBirthAgeYears,
        position: nodePosition,
        tangent: vector(node.tangent.x, node.tangent.y, node.tangent.z),
        leaves,
        racemes,
      });
    }
    axes.push({
      ...axis,
      birthAgeYears: axisBirthAgeYears,
      growthScale: axisGrowthScale,
      root: grownRoot,
      points: axis.points.map(transformAxisPoint),
      nodes,
    });
  }

  return {
    ...cane,
    birthAgeYears: caneBirthAgeYears,
    position: vector(cane.position.x, cane.position.y, cane.position.z),
    ageYears: caneAgeYears,
    height: cane.targetHeightM * visibleGrowthScale,
    growthScale: visibleGrowthScale,
    baseRadiusM: cane.baseRadiusM * visibleGrowthScale,
    axes,
  };
}

function yieldEstimateAtAge(cycleAgeYears) {
  return sampleAnchors(
    [
      [0, 0],
      [1, TISEL_PROFILE.yield.youngSecondYearKg],
      [5, TISEL_PROFILE.yield.matureTrialKg],
    ],
    cycleAgeYears,
  );
}

function fruitSampleCapacityKg(
  canes,
  { includeHarvested = true, includeUnavailable = true } = {},
) {
  let massG = 0;
  for (const cane of canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        for (const raceme of node.racemes) {
          for (const berry of raceme.berries) {
            if (
              (includeHarvested || !berry.harvested) &&
              (includeUnavailable || berry.visible)
            ) {
              massG += berry.massG;
            }
          }
        }
      }
    }
  }
  return massG / 1000;
}

function snapshotStats(
  canes,
  phenology,
  cycleAgeYears,
  referenceFruitSampleKg,
) {
  const nominalReferenceYieldKg = yieldEstimateAtAge(cycleAgeYears);
  const stats = {
    activeCanes: canes.length,
    leaves: 0,
    flowerBuds: 0,
    flowers: 0,
    greenBerries: 0,
    ripeBerries: 0,
    harvestedBerries: 0,
    droppedBerries: 0,
    estimatedYieldKg: 0,
    nominalReferenceYieldKg,
    yieldCapacityRatio: 0,
    renderedFruitSampleKg: 0,
  };
  let fruitMassG = 0;
  for (const cane of canes) {
    for (const axis of cane.axes) {
      for (const node of axis.nodes) {
        stats.leaves += node.leaves.filter((leaf) => leaf.visible).length;
        for (const raceme of node.racemes) {
          if (phenology.flowerOpenVisibility > 0.015) {
            stats.flowers += raceme.flowerCount;
          } else if (phenology.flowerVisibility > 0.015) {
            stats.flowerBuds += raceme.flowerCount;
          }
          for (const berry of raceme.berries) {
            if (berry.harvested) stats.harvestedBerries += 1;
            else if (berry.dropped) stats.droppedBerries += 1;
            else if (berry.visible && berry.ripe) stats.ripeBerries += 1;
            else if (berry.visible) stats.greenBerries += 1;
            if (berry.visible && !berry.harvested) fruitMassG += berry.massG;
          }
        }
      }
    }
  }
  stats.renderedFruitSampleKg = fruitMassG / 1000;
  const remainingCapacityKg = fruitSampleCapacityKg(canes, {
    includeHarvested: false,
    includeUnavailable: false,
  });
  stats.yieldCapacityRatio =
    referenceFruitSampleKg > 0
      ? clamp(remainingCapacityKg / referenceFruitSampleKg, 0, 1)
      : 0;
  if (stats.greenBerries + stats.ripeBerries > 0) {
    stats.estimatedYieldKg = nominalReferenceYieldKg * stats.yieldCapacityRatio;
  }
  return stats;
}

function snapshotDimensions(canes) {
  let height = 0;
  let radius = 0;
  for (const cane of canes) {
    for (const axis of cane.axes) {
      for (const point of axis.points) {
        height = Math.max(height, point.y);
        radius = Math.max(radius, Math.hypot(point.x, point.z));
      }
      for (const node of axis.nodes) {
        for (const leaf of node.leaves) {
          if (leaf.visible) {
            height = Math.max(height, leaf.position.y + leaf.lengthM / 2);
            radius = Math.max(
              radius,
              Math.hypot(leaf.position.x, leaf.position.z) + leaf.widthM / 2,
            );
          }
        }
      }
    }
  }
  return { height, radius, width: radius * 2 };
}

/**
 * Evaluates the immutable graph at a year/day without mutating history. Moving
 * A -> B -> A therefore recreates byte-equivalent organ IDs and coordinates.
 */
export function evaluateTiselModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 172,
    events = [],
    scenario = 'maintained',
    trialYear = 'mean',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'blackcurrant-growth-model') {
    throw new TypeError('Expected a model returned by createTiselModel');
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
  const phenology = getTiselPhenology(dayOfYear, { trialYear, offsetDays });
  const now = ageYears + (phenology.dayOfYear - 1) / 365;
  const currentYear = Math.floor(ageYears);
  const appliedEvents = events
    .filter((event) => event && eventTime(event) <= now)
    .slice()
    .sort(
      (a, b) =>
        eventTime(a) - eventTime(b) || String(a.id).localeCompare(String(b.id)),
    );
  const prunedCanes = new Set(
    appliedEvents
      .filter((event) => event.type === 'prune')
      .map((event) => event.caneId),
  );
  const currentHarvests = appliedEvents.filter(
    (event) =>
      event.type === 'harvest' && Math.floor(event.ageYears) === currentYear,
  );
  const harvestAllDay =
    currentHarvests.find((event) => event.racemeId == null)?.dayOfYear ?? null;
  const harvestedRacemeDays = new Map();
  for (const event of currentHarvests) {
    if (event.racemeId != null && !harvestedRacemeDays.has(event.racemeId)) {
      harvestedRacemeDays.set(event.racemeId, event.dayOfYear);
    }
  }
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
    .map((cane) =>
      evaluateCane(
        model.seed,
        cane,
        now,
        currentYear,
        phenology,
        harvestedRacemeDays,
        harvestAllDay,
      ),
    );
  const canes = evaluatedCanes.filter((cane) => !prunedCanes.has(cane.id));
  const referenceFruitSampleKg = fruitSampleCapacityKg(evaluatedCanes);
  const cycleYears = TISEL_PROFILE.architecture.replacementCycleYears;
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
    careHints: getTiselCareHints(phenology.dayOfYear, {
      plantAgeYears: cycleAgeYears,
      trialYear,
      offsetDays,
    }),
    canes,
    stats: snapshotStats(
      canes,
      phenology,
      cycleAgeYears,
      referenceFruitSampleKg,
    ),
    appliedEvents: appliedEvents.map((event) => event.id),
  };
}
