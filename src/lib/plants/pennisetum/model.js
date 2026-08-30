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
  dot,
  normalize,
  orientationFor,
  rotateAboutAxis,
  sampleAnchors,
  scale,
  smoothstep01,
  subtract,
  tangentAt,
  vector,
} from '../../model-math.js';
import {
  BLADE_ARCH_VARIANTS,
  BLADE_WIDTH_RATIOS,
  bladeTipOffset,
  bladeVariantFor,
} from './geometry.js';
import { getHamelnCareHints, getHamelnPhenology } from './phenology.js';
import { HAMELN_PROFILE, HAMELN_SOURCES } from './hameln.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Number of tillers the rendered clump carries at a whole-year age.
 *
 * A real mature clump has many more shoots than are useful to render. This is
 * a bounded representative sample whose shape follows the RHS two-to-five-year
 * time to ultimate size. It is a renderer prior, not a counted observation.
 */
const TILLER_COUNT_ANCHORS = Object.freeze([
  Object.freeze([0, 8]),
  Object.freeze([1, 24]),
  Object.freeze([2, 48]),
  Object.freeze([3, 76]),
  Object.freeze([5, 120]),
  Object.freeze([8, 134]),
  Object.freeze([12, 140]),
]);

/** Invert an ascending anchor table: the value at which it first reaches y. */
function ageAtAnchorValue(anchors, target) {
  if (target <= anchors[0][1]) return anchors[0][0];
  for (let index = 1; index < anchors.length; index += 1) {
    const [startAge, startValue] = anchors[index - 1];
    const [endAge, endValue] = anchors[index];
    if (target <= endValue) {
      return lerp(
        startAge,
        endAge,
        (target - startValue) / Math.max(0.0001, endValue - startValue),
      );
    }
  }
  return anchors.at(-1)[0];
}

function clumpRadiusAt(ageYears) {
  return sampleAnchors(
    HAMELN_PROFILE.architecture.crownRadiusAnchorsM,
    ageYears,
  );
}

/**
 * Relative blade length along the culm.
 *
 * Most of Hameln's visual foliage is basal. The longest blades therefore sit
 * low on a culm and the flag leaf below a head is short.
 */
function bladeLengthProfile(nodeFraction) {
  const peak = HAMELN_PROFILE.leaf.lengthProfilePeak;
  const spread = (nodeFraction - peak) / 0.42;
  const bell = 0.52 + 0.48 * Math.exp(-spread * spread);
  const upperFade = 1 - 0.58 * clamp01((nodeFraction - 0.5) / 0.5);
  return bell * upperFade;
}

/* ==================================================================== *
 * Stable graph
 * ==================================================================== */

function makeBlade(seed, tiller, node) {
  const leaf = HAMELN_PROFILE.leaf;
  const id = `${node.id}:blade`;
  const lengthScale = bladeLengthProfile(node.fraction);
  const lengthM =
    randomRange(seed, [id, 'length'], leaf.lengthM[0], leaf.lengthM[1]) *
    lengthScale;
  const archVariant = bladeVariantFor(
    clamp(
      0.5 +
        0.85 * (1 - node.fraction) +
        randomRange(seed, [id, 'arch'], -0.12, 0.14),
      0.3,
      1.34,
    ),
  );

  return {
    id,
    nodeId: node.id,
    // Two-ranked: successive blades leave the culm on opposite sides, with
    // enough jitter that a clump does not read as a row of flat sheets.
    azimuth:
      tiller.azimuth +
      node.index * Math.PI +
      randomRange(seed, [id, 'azimuth-jitter'], -0.28, 0.28),
    lengthM,
    // Width follows length: it is baked into the blade geometry as an aspect
    // ratio, so this is reported rather than applied.
    widthM: lengthM * BLADE_WIDTH_RATIOS[archVariant],
    nodeFraction: node.fraction,
    // How far the blade leaves the sheath from the culm's own direction.
    emergeTilt: clamp(
      0.34 +
        0.18 * (1 - node.fraction) +
        randomRange(seed, [id, 'emerge-tilt'], -0.08, 0.08),
      0.26,
      0.6,
    ),
    // Lower, longer blades carry more of their own weight and arch hardest.
    // The value is snapped to a baked geometry variant so this model's reach
    // prediction is the curve the renderer actually draws.
    archVariant,
    arch: BLADE_ARCH_VARIANTS[archVariant],
    roll: randomRange(seed, [id, 'roll'], -0.78, 0.78),
  };
}

function makePanicle(seed, tiller, tipDirection) {
  const panicle = HAMELN_PROFILE.panicle;
  const id = `${tiller.id}:panicle`;
  const lengthM = randomRange(
    seed,
    [id, 'length'],
    panicle.lengthM[0],
    panicle.lengthM[1],
  );
  const widthM = randomRange(
    seed,
    [id, 'width'],
    panicle.widthM[0],
    panicle.widthM[1],
  );
  const nod = clamp(
    0.04 +
      0.2 * tiller.radialFraction +
      randomRange(seed, [id, 'nod'], -0.025, 0.035),
    0.03,
    0.27,
  );

  return {
    id,
    lengthM,
    widthM,
    // The dense brush continues the culm's fountain arc. It never receives an
    // artificial upward bias: that was what made the first renderer read as a
    // picket of candles instead of a fountain of nodding brushes.
    direction: normalize(
      add(
        tipDirection,
        add(
          scale(
            vector(Math.cos(tiller.azimuth), 0, Math.sin(tiller.azimuth)),
            nod,
          ),
          scale(
            vector(-Math.sin(tiller.azimuth), 0, Math.cos(tiller.azimuth)),
            randomRange(seed, [id, 'side-nod'], -0.08, 0.08),
          ),
        ),
      ),
    ),
    spin: randomRange(seed, [id, 'spin'], 0, Math.PI * 2),
    cardCount: randomInt(
      seed,
      [id, 'card-count'],
      panicle.cardCount[0],
      panicle.cardCount[1],
    ),
    // First flowering is gated by the plant's age, not the tiller's: a new
    // tiller on an established clump flowers in its own first season.
    firstFloweringAgeYears: Math.max(
      HAMELN_PROFILE.growth.firstFloweringAgeYears,
      Math.ceil(tiller.birthAgeYears),
    ),
  };
}

function culmPoints(seed, tiller, axisLength) {
  const id = `${tiller.id}:culm`;
  const outward = vector(Math.cos(tiller.azimuth), 0, Math.sin(tiller.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  // A fountain-grass culm is upright where it leaves the crown and bows most
  // strongly in its light upper half. Starting nearly vertical, then using the
  // shared radius-aware force step, preserves that curve; simply leaning a
  // straight axis from its root produces the rigid picket silhouette this
  // cultivar must avoid.
  const baseLean =
    (0.02 + 0.06 * tiller.radialFraction) *
    randomRange(seed, [id, 'base-lean'], 0.72, 1.24);
  const targetAngle =
    (0.18 + 0.78 * Math.pow(tiller.radialFraction, 0.78)) *
    randomRange(seed, [id, 'tip-lean'], 0.82, 1.18);
  const curveSide = randomRange(seed, [id, 'curve-side'], -0.18, 0.18);
  const curveDirection = normalize(add(outward, scale(sideways, curveSide)));
  const direction = normalize(
    add(
      vector(0, 1, 0),
      add(
        scale(outward, baseLean),
        scale(sideways, randomRange(seed, [id, 'side-lean'], -0.025, 0.025)),
      ),
    ),
  );

  const sections = growWoodyAxis({
    origin: vector(tiller.position.x, tiller.position.y, tiller.position.z),
    orientation: orientationFor(direction),
    length: axisLength,
    radius: tiller.baseRadiusM,
    sectionCount: tiller.nodeCount,
    // Keep the surface calm; the deliberate force curve supplies the posture.
    gnarliness: 0.00018,
    taper: 1 - HAMELN_PROFILE.cane.axisTaperRatios[1],
    force: {
      // Normalised with sqrt rather than model-math's hypot-based `normalize`:
      // the two disagree in the last bits, and this force direction shapes
      // every culm, so the arithmetic is kept exactly as it was.
      direction: unitVector(
        curveDirection.x * Math.sin(targetAngle),
        Math.cos(targetAngle),
        curveDirection.z * Math.sin(targetAngle),
      ),
      strength:
        ((0.000028 + 0.000062 * tiller.radialFraction) * 28) / tiller.nodeCount,
    },
    rng: axisRng(seed, id),
  });

  return sections.map((section) => ({
    position: vector(section.origin.x, section.origin.y, section.origin.z),
    radius: section.radius,
  }));
}

function makeTiller(seed, sequence, birthAgeYears) {
  const architecture = HAMELN_PROFILE.architecture;
  const culm = HAMELN_PROFILE.cane;
  const id = `hameln:tiller:${String(sequence).padStart(2, '0')}`;
  // A tiller born in year k appears anywhere from the middle of the clump out
  // to that year's edge, so the clump infills as well as widens.
  const radialFraction = clamp(
    (clumpRadiusAt(birthAgeYears) / architecture.matureCrownRadiusM) *
      randomRange(seed, [id, 'radial-jitter'], 0.58, 1),
    0.05,
    1,
  );
  const azimuth =
    sequence * GOLDEN_ANGLE +
    randomRange(seed, [id, 'azimuth-jitter'], -0.3, 0.3);
  const radiusM = radialFraction * architecture.matureCrownRadiusM;
  const flowering =
    keyedRandom(seed, id, 'flowering') <
    randomRange(
      seed,
      ['hameln', 'flowering-fraction'],
      HAMELN_PROFILE.growth.floweringTillerFraction[0],
      HAMELN_PROFILE.growth.floweringTillerFraction[1],
    );

  // The centre supplies the height while increasingly short outer tillers
  // supply the skirt. Without this radial height gradient, strongly arched
  // stems make an oversized hollow umbrella instead of a nested fountain.
  const radialHeightScale = lerp(1.06, 0.34, Math.pow(radialFraction, 0.9));
  const foliageHeightM =
    randomRange(
      seed,
      [id, 'height'],
      culm.targetHeightM[0],
      culm.targetHeightM[1],
    ) *
    (flowering
      ? 1
      : randomRange(
          seed,
          [id, 'vegetative-height'],
          culm.vegetativeHeightFactor[0],
          culm.vegetativeHeightFactor[1],
        )) *
    radialHeightScale;
  const extensionM = flowering
    ? randomRange(
        seed,
        [id, 'flowering-extension'],
        culm.floweringExtensionM[0],
        culm.floweringExtensionM[1],
      ) * lerp(1.03, 0.74, Math.pow(radialFraction, 0.9))
    : 0;

  const tiller = {
    id,
    sequence,
    birthAgeYears,
    azimuth,
    radialFraction,
    radiusM,
    position: vector(
      Math.cos(azimuth) * radiusM,
      0,
      Math.sin(azimuth) * radiusM,
    ),
    flowering,
    foliageHeightM,
    extensionM,
    totalHeightM: foliageHeightM + extensionM,
    // The panicle rides up on the top internode after the leaf canopy has
    // finished, so growth is split between a vegetative and a heading share.
    peduncleShare: extensionM / (foliageHeightM + extensionM),
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      culm.baseRadiusM[0],
      culm.baseRadiusM[1],
    ),
    nodeCount: randomInt(
      seed,
      [id, 'node-count'],
      culm.mainAxisNodeCount[0],
      culm.mainAxisNodeCount[1],
    ),
    // Which way this culm falls open once it is dead and weathering.
    collapseAzimuth: randomRange(
      seed,
      [id, 'collapse-azimuth'],
      0,
      Math.PI * 2,
    ),
    collapseAngle: randomRange(seed, [id, 'collapse-angle'], 0.04, 0.3),
    // Staggering the cut across the pruning window stops a whole clump from
    // vanishing on one slider step; a gardener works around a clump too.
    cutOrder: keyedRandom(seed, id, 'cut-order'),
    // Which sites hold last season's culm through the summer when nothing is
    // ever cut. Uncut clumps are a mixture, not a uniform thatch.
  };

  const sections = culmPoints(seed, tiller, tiller.totalHeightM);
  tiller.points = sections.map((section) => section.position);
  tiller.radii = sections.map((section) => section.radius);

  // Blades stop below the bare peduncle on a flowering culm.
  const bladeTopFraction = flowering ? 1 - tiller.peduncleShare * 0.92 : 0.95;
  tiller.nodes = tiller.points.slice(1).map((position, index) => {
    const fraction = (index + 1) / Math.max(1, tiller.points.length - 1);
    const node = {
      id: `${id}:node:${index}`,
      index,
      fraction,
      position,
      tangent: tangentAt(tiller.points, index + 1),
      blade: null,
    };
    if (fraction <= bladeTopFraction)
      node.blade = makeBlade(seed, tiller, node);
    return node;
  });

  tiller.panicle = flowering
    ? makePanicle(
        seed,
        tiller,
        tangentAt(tiller.points, tiller.points.length - 1),
      )
    : null;

  return tiller;
}

function assertModelOptions(seed, maxYears) {
  if (!['string', 'number'].includes(typeof seed)) {
    throw new TypeError('seed must be a string or number');
  }
  if (!Number.isInteger(maxYears) || maxYears < 1 || maxYears > 50) {
    throw new RangeError('maxYears must be an integer from 1 to 50');
  }
}

/**
 * Build the finite, stable all-ages Hameln organ graph once.
 *
 * The graph is a crown of tiller *sites*. Each site owns one baked culm at
 * its mature size; every season the site rebuilds that culm from nothing,
 * which is why there is no persistent framework here and no equivalent of a
 * shrub's cane-replacement cycle.
 */
export function createHamelnModel({
  seed = 'hameln-demo',
  maxYears = HAMELN_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertModelOptions(seed, maxYears);
  const architecture = HAMELN_PROFILE.architecture;
  const tillers = [];

  for (
    let sequence = 0;
    sequence < architecture.maximumTillerCount;
    sequence += 1
  ) {
    const birthAgeYears =
      sequence < architecture.initialTillerCount
        ? 0
        : ageAtAnchorValue(TILLER_COUNT_ANCHORS, sequence + 1);
    if (birthAgeYears > maxYears) continue;
    tillers.push(makeTiller(seed, sequence, birthAgeYears));
  }

  return deepFreeze({
    schemaVersion: 1,
    kind: 'pennisetum-hameln-growth-model',
    species: HAMELN_PROFILE.species,
    cultivar: HAMELN_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: HAMELN_PROFILE.metresPerUnit,
    topologyMaturesByAgeYears: architecture.rhsYearsToUltimateHeight[1],
    tillerCountAnchors: TILLER_COUNT_ANCHORS,
    tillers,
  });
}

/* ==================================================================== *
 * Evaluation
 * ==================================================================== */

/**
 * Growth scale of one culm on the selected day.
 *
 * A grass culm is built in two stages: the leaf canopy rises first, and only
 * then does the top internode telescope the panicle clear of it. Splitting
 * the scale this way is what stops a July plant from already standing at its
 * September flowering height.
 */
function culmGrowthScale(tiller, phenology) {
  const vegetative = smoothstep01(phenology.emergenceProgress);
  if (!tiller.flowering) return vegetative;
  return (
    (1 - tiller.peduncleShare) * vegetative +
    tiller.peduncleShare * phenology.paniclePush
  );
}

/**
 * Place one baked culm in the world for the requested cohort.
 *
 * Both cohorts use the same baked axis at the same site, because they are the
 * same physical position in the clump one year apart. The previous cohort is
 * distinguished by leaning further open as it weathers, never by moving.
 */
function transformCulm(tiller, root, growth, lean) {
  const sourceRoot = tiller.points[0];
  const axis = vector(
    Math.cos(tiller.collapseAzimuth),
    0,
    Math.sin(tiller.collapseAzimuth),
  );
  return (position) => {
    const local = scale(subtract(position, sourceRoot), growth);
    return add(root, lean > 1e-6 ? rotateAboutAxis(local, axis, lean) : local);
  };
}

/**
 * Place one blade at an already-evaluated node.
 *
 * The node's position and tangent have had the culm transform applied
 * already, so this must not apply it a second time: doing so would square the
 * seasonal growth scale and double a dead culm's lean, sliding every blade
 * off the culm that carries it.
 */
function evaluateBlade(seed, blade, node, sizeScale, state) {
  const position = node.position;
  const tangent = node.tangent;
  const outward = vector(Math.cos(blade.azimuth), 0, Math.sin(blade.azimuth));
  // The blade leaves the sheath between the culm's own line and horizontal.
  const emerge = normalize(
    add(scale(tangent, 1 - blade.emergeTilt), scale(outward, blade.emergeTilt)),
  );
  // A strap leaf bends about its width axis, so it arches in the plane of
  // `emerge` and `outward`. This is the component of `outward` square to the
  // emergence direction, and it is the axis the renderer's basis uses too.
  const perpendicular = subtract(outward, scale(emerge, dot(emerge, outward)));
  const archDirection = normalize(
    Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z) > 1e-6
      ? perpendicular
      : vector(-emerge.z, 0, emerge.x),
  );
  // Blades expand from the sheath, so a young one is a short spike rather
  // than a short version of a full arching leaf.
  const expansion = clamp01(state.bladeProgress);
  if (!Number.isFinite(expansion)) {
    throw new TypeError('A culm state must carry a finite bladeProgress.');
  }

  // A young blade stands erect and only arches as it lengthens and softens,
  // so an early-summer clump is a narrow tuft rather than a small copy of the
  // September fountain. Stepping down through the baked variants expresses
  // that with the geometry already in the pools, and keeping the choice here
  // rather than in the renderer means this model's own reach prediction stays
  // the curve that actually gets drawn.
  const archVariant = Math.min(
    blade.archVariant,
    Math.floor(expansion * BLADE_ARCH_VARIANTS.length),
    BLADE_ARCH_VARIANTS.length - 1,
  );

  return {
    id: blade.id,
    visible: state.visible && expansion > 0.02,
    position,
    emerge,
    outward,
    archDirection,
    azimuth: blade.azimuth,
    expansion,
    arch: BLADE_ARCH_VARIANTS[archVariant],
    archVariant,
    matureArchVariant: blade.archVariant,
    roll: blade.roll,
    lengthM: blade.lengthM * sizeScale * lerp(0.14, 1, expansion),
    widthM: blade.widthM * sizeScale * lerp(0.42, 1, expansion),
    // Dead blades tatter and shed; the sources are clear that the foliage
    // itself persists, so this thins the fountain rather than emptying it.
    retained:
      state.weathering <= 0 ||
      keyedRandom(seed, blade.id, 'winter-shed') > state.weathering * 0.62,
    weathering: state.weathering,
    cohort: state.cohort,
  };
}

function evaluatePanicle(panicle, tipPosition, currentYear, state, phenology) {
  const eligible = currentYear >= panicle.firstFloweringAgeYears;
  if (!eligible) return null;

  const previous = state.cohort !== 'current';
  // Last year's head is mature and has lost bristles to winter; this year's
  // is wherever the calendar places it.
  const push = previous ? 1 : phenology.paniclePush;
  const headExpansion = previous ? 1 : phenology.headExpansionProgress;
  const fluff = previous
    ? Math.max(0, 1 - state.weathering * 0.72)
    : phenology.plumeVisibility;
  const maturity = previous ? 1 : phenology.headMaturityProgress;

  return {
    id: `${panicle.id}:${state.cohort}`,
    sourceId: panicle.id,
    visible: state.visible && push > 0.02,
    position: tipPosition,
    direction: panicle.direction,
    spin: panicle.spin,
    cardCount: panicle.cardCount,
    lengthM: panicle.lengthM * state.sizeScale * lerp(0.35, 1, push),
    widthM: panicle.widthM * state.sizeScale,
    // The emerging spike is narrow before its bristles finish extending.
    headWidthScale: lerp(0.58, 1, headExpansion),
    plumeVisibility: clamp01(fluff),
    headMaturityProgress: clamp01(maturity),
    weathering: state.weathering,
    cohort: state.cohort,
    push,
  };
}

/**
 * Evaluate one tiller site into the culms it is actually showing today.
 *
 * A site shows at most one culm from each of two mutually exclusive roles:
 * this season's growing culm, and last season's standing dead one. The two
 * only ever coexist as a live culm beside a freshly cut stub.
 */
/**
 * A unit vector built the way Three.js builds one, so a culm grown from it is
 * bit-for-bit what it was before the model stopped importing Three.js.
 */
function unitVector(x, y, z) {
  // Three.js divides by multiplying with the reciprocal, and `x * (1 / m)` is
  // not always `x / m` in floating point.
  const magnitude = Math.sqrt(x * x + y * y + z * z) || 1;
  const inverse = 1 / magnitude;
  return vector(x * inverse, y * inverse, z * inverse);
}

function evaluateTiller(
  tiller,
  seed,
  phenology,
  currentYear,
  ageScale,
  cutbackGrowth,
) {
  const culms = [];
  const record = (state) => {
    // The plant's age scales the whole culm; the season scales how much of
    // it has been built so far. Both apply to the same baked axis.
    const transform = transformCulm(
      tiller,
      tiller.position,
      state.growth * state.sizeScale,
      state.lean,
    );
    const points = tiller.points.map(transform);
    const nodes = [];
    let blades = 0;

    for (const node of tiller.nodes) {
      const evaluated = {
        id: node.id,
        index: node.index,
        fraction: node.fraction,
        position: points[node.index + 1],
        tangent: tangentAt(points, node.index + 1),
        blade: null,
      };
      if (node.blade && state.showBlades) {
        evaluated.blade = evaluateBlade(
          seed,
          node.blade,
          evaluated,
          state.sizeScale,
          state,
        );
        if (evaluated.blade.visible && evaluated.blade.retained) blades += 1;
      }
      nodes.push(evaluated);
    }

    culms.push({
      id: `${tiller.id}:culm:${state.cohort}`,
      tillerId: tiller.id,
      cohort: state.cohort,
      visible: state.visible,
      growth: state.growth,
      radiusScale: lerp(0.5, 1, state.growth) * state.sizeScale,
      // Height fraction of the topmost blade: below this the culm is wrapped
      // in leaf sheaths, above it the peduncle is bare.
      sheathTopFraction: tiller.nodes.reduce(
        (highest, node) =>
          node.blade ? Math.max(highest, node.fraction) : highest,
        0.35,
      ),
      lean: state.lean,
      weathering: state.weathering,
      flowering: tiller.flowering,
      points,
      radii: tiller.radii,
      nodes,
      visibleBlades: blades,
      panicle:
        tiller.panicle && state.showPanicle
          ? evaluatePanicle(
              tiller.panicle,
              points.at(-1),
              state.cohort === 'current' ? currentYear : currentYear - 1,
              state,
              phenology,
            )
          : null,
    });
  };

  const growth = culmGrowthScale(tiller, phenology);
  // The clump is cut back every spring, so last season's culms are held
  // only until the cut reaches this tiller.
  const cut = phenology.cutProgress > tiller.cutOrder;
  const holdsLastSeason = !cut;

  if (holdsLastSeason) {
    record({
      cohort: 'previous',
      visible: true,
      growth: 1,
      sizeScale: ageScale,
      // Its blades finished expanding last summer.
      bladeProgress: 1,
      // A dead culm keeps falling further open the longer it stands.
      lean: tiller.collapseAngle * phenology.previousWeatheringProgress,
      weathering: phenology.previousWeatheringProgress,
      showBlades: true,
      showPanicle: true,
    });
  } else {
    if (phenology.stubbleVisibility > 0.02) {
      record({
        cohort: 'stub',
        visible: true,
        growth: clamp01(cutbackGrowth / Math.max(0.05, tiller.totalHeightM)),
        sizeScale: ageScale,
        bladeProgress: 0,
        lean: 0,
        weathering: 1,
        showBlades: false,
        showPanicle: false,
      });
    }
    if (growth > 0.004) {
      record({
        cohort: 'current',
        visible: true,
        growth,
        sizeScale: ageScale,
        bladeProgress: phenology.bladeProgress,
        // A culm that has died back starts leaning while it is still this
        // season's. Driving both cohorts off their own weathering is what
        // keeps the clump continuous when the slider wraps past New Year and
        // this season's culms become last season's.
        lean: tiller.collapseAngle * phenology.weatheringProgress,
        // Physical weathering, not the straw colour change: a blade turns
        // buff weeks before wind starts tearing it off.
        weathering: phenology.weatheringProgress,
        showBlades: true,
        showPanicle: true,
      });
    }
  }

  return {
    id: tiller.id,
    sequence: tiller.sequence,
    birthAgeYears: tiller.birthAgeYears,
    position: tiller.position,
    radialFraction: tiller.radialFraction,
    flowering: tiller.flowering,
    removed: false,
    culms,
  };
}

function snapshotDimensions(tillers) {
  let height = 0;
  let radius = 0;
  for (const tiller of tillers) {
    for (const culm of tiller.culms) {
      if (!culm.visible) continue;
      for (const point of culm.points) {
        height = Math.max(height, point.y);
        radius = Math.max(radius, Math.hypot(point.x, point.z));
      }
      for (const node of culm.nodes) {
        const blade = node.blade;
        if (!blade?.visible || !blade.retained) continue;
        // The blade's reach comes from the same integration the geometry
        // uses, so the reported spread matches what is drawn.
        const offset = bladeTipOffset(blade.arch);
        const tip = add(
          blade.position,
          add(
            scale(blade.emerge, blade.lengthM * offset.along),
            scale(blade.archDirection, blade.lengthM * offset.across),
          ),
        );
        height = Math.max(height, tip.y);
        radius = Math.max(radius, Math.hypot(tip.x, tip.z));
      }
      const panicle = culm.panicle;
      if (panicle?.visible) {
        const tip = add(
          panicle.position,
          scale(panicle.direction, panicle.lengthM),
        );
        height = Math.max(height, tip.y);
        radius = Math.max(
          radius,
          Math.hypot(tip.x, tip.z) +
            (panicle.widthM * panicle.headWidthScale) / 2,
        );
      }
    }
  }
  return { heightM: height, radiusM: radius, spreadM: radius * 2 };
}

function snapshotStats(tillers, phenology) {
  let visibleCulms = 0;
  let livingCulms = 0;
  let standingDeadCulms = 0;
  let stubs = 0;
  let visibleBlades = 0;
  let visiblePanicles = 0;
  let floweringCulms = 0;
  let maturePanicles = 0;

  for (const tiller of tillers) {
    for (const culm of tiller.culms) {
      if (!culm.visible) continue;
      visibleCulms += 1;
      if (culm.cohort === 'current') livingCulms += 1;
      else if (culm.cohort === 'stub') stubs += 1;
      else standingDeadCulms += 1;
      visibleBlades += culm.visibleBlades;
      if (culm.panicle?.visible) {
        visiblePanicles += 1;
        if (culm.cohort === 'current') floweringCulms += 1;
        if (culm.panicle.headMaturityProgress > 0.5) maturePanicles += 1;
      }
    }
  }

  return {
    visibleTillers: tillers.length,
    visibleCulms,
    livingCulms,
    standingDeadCulms,
    stubs,
    visibleBlades,
    visiblePanicles,
    floweringCulms,
    maturePanicles,
    flowersOnCurrentSeasonCulms: phenology.flowersOnCurrentSeasonCulms,
  };
}

function ageAwarePhenology(phenology, stats) {
  if (stats.visiblePanicles > 0) return phenology;
  const floweringPhase = new Set([
    'booting',
    'heading',
    'flowering',
    'maturing',
  ]);
  if (!floweringPhase.has(phenology.phase)) return phenology;
  const label = 'Vegetative clump; no panicles at this age yet';
  return Object.freeze({ ...phenology, stage: label, label });
}

function careHintsForSnapshot(phenology, stats, options) {
  const hints = getHamelnCareHints(phenology.dayOfYear, options);
  if (stats.visibleCulms > 0) return hints;
  // Nothing above ground: cutting and winter-interest advice is meaningless.
  const standingOnlyHints = new Set([
    'spring-cutback',
    'leave-standing-for-winter',
  ]);
  return Object.freeze(hints.filter((hint) => !standingOnlyHints.has(hint.id)));
}

function validateEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (events.length > 0) {
    throw new RangeError(
      'Hameln does not expose destructive care events; the single annual cut is modelled by the calendar.',
    );
  }
}

/**
 * Evaluate the immutable graph at an absolute age and day.
 *
 * There is no replacement-cycle modulo and no ageing framework: the clump
 * widens toward its RHS envelope, fills with tillers, and — if it is never
 * divided — opens out in the middle. Everything above the crown is one
 * season old at most.
 */
export function evaluateHamelnModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 250,
    events = [],
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'pennisetum-hameln-growth-model') {
    throw new TypeError('Expected a model returned by createHamelnModel');
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

  const architecture = HAMELN_PROFILE.architecture;
  const phenology = getHamelnPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  // A clump only widens while it is in growth, so a winter day cannot make it
  // broader than the September before it.
  const now = ageYears + phenology.emergenceProgress;
  const ageScale = sampleAnchors(
    HAMELN_PROFILE.growth.plantAgeScaleAnchors,
    now,
  );

  const tillers = [];
  for (const tiller of model.tillers) {
    if (tiller.birthAgeYears > now) continue;
    tillers.push(
      evaluateTiller(
        tiller,
        model.seed,
        phenology,
        ageYears,
        ageScale,
        HAMELN_PROFILE.management.cutbackHeightM,
      ),
    );
  }

  const stats = snapshotStats(tillers, phenology);
  const careHints = careHintsForSnapshot(phenology, stats, {
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
    clump: {
      radiusM: clumpRadiusAt(now),
      tillerSites: tillers.length,
    },
    dimensions: snapshotDimensions(tillers),
    phenology: ageAwarePhenology(phenology, stats),
    careHints,
    provenance: {
      observedDisplay: HAMELN_PROFILE.flowering.observedDisplay,
      sources: HAMELN_SOURCES,
      rendererAssumptions: [
        'bounded 140-tiller representative sample of a much denser biological clump',
        'tiller birth schedule and clump-widening curve fitted to the RHS 2-5 year time to ultimate size',
        'staggered spring cut across the pruning window',
        "one retained cohort per tiller site: an uncut clump shows last season's culms, not an unbounded archive of every past year",
      ],
    },
    tillers,
    stats,
    appliedEvents: [],
  };
}
