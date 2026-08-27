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
import { getMalepartusCareHints, getMalepartusPhenology } from './phenology.js';
import { MALEPARTUS_PROFILE, MALEPARTUS_SOURCES } from './malepartus.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Number of tillers the rendered clump carries at a whole-year age.
 *
 * A real mature Miscanthus clump has several hundred tillers. This is a
 * bounded representative sample whose *shape* — a few shoots from a division,
 * then rapid infill, then a plateau — follows the RHS two-to-five-year time
 * to ultimate size. It is a renderer prior, not a counted observation.
 */
const TILLER_COUNT_ANCHORS = Object.freeze([
  Object.freeze([0, 9]),
  Object.freeze([1, 21]),
  Object.freeze([2, 38]),
  Object.freeze([3, 55]),
  Object.freeze([5, 81]),
  Object.freeze([8, 103]),
  Object.freeze([12, 114]),
  Object.freeze([20, 118]),
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
    MALEPARTUS_PROFILE.architecture.crownRadiusAnchorsM,
    ageYears,
  );
}

/**
 * Relative blade length along the culm.
 *
 * NC State describes Miscanthus stems as "bearing leaves reducing in size
 * upwards"; the longest blades sit low on the culm and the flag leaf under
 * the panicle is short.
 */
function bladeLengthProfile(nodeFraction) {
  const peak = MALEPARTUS_PROFILE.leaf.lengthProfilePeak;
  const spread = (nodeFraction - peak) / 0.42;
  const bell = 0.52 + 0.48 * Math.exp(-spread * spread);
  const upperFade = 1 - 0.58 * clamp01((nodeFraction - 0.5) / 0.5);
  return bell * upperFade;
}

/* ==================================================================== *
 * Stable graph
 * ==================================================================== */

function makeBlade(seed, tiller, node) {
  const leaf = MALEPARTUS_PROFILE.leaf;
  const id = `${node.id}:blade`;
  const lengthScale = bladeLengthProfile(node.fraction);
  const lengthM =
    randomRange(seed, [id, 'length'], leaf.lengthM[0], leaf.lengthM[1]) *
    lengthScale;
  const archVariant = bladeVariantFor(
    clamp(
      0.3 +
        0.62 * (1 - node.fraction) +
        randomRange(seed, [id, 'arch'], -0.14, 0.14),
      0.18,
      0.95,
    ),
  );

  return {
    id,
    nodeId: node.id,
    // Two-ranked: successive blades leave the culm on opposite sides, with
    // enough jitter that a clump does not read as a row of flat fans.
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
    emergeTilt: randomRange(seed, [id, 'emerge-tilt'], 0.3, 0.55),
    // Lower, longer blades carry more of their own weight and arch hardest.
    // The value is snapped to a baked geometry variant so this model's reach
    // prediction is the curve the renderer actually draws.
    archVariant,
    arch: BLADE_ARCH_VARIANTS[archVariant],
    roll: randomRange(seed, [id, 'roll'], -0.55, 0.55),
  };
}

function makePanicle(seed, tiller, tipDirection) {
  const panicle = MALEPARTUS_PROFILE.panicle;
  const id = `${tiller.id}:panicle`;
  const lengthM = randomRange(
    seed,
    [id, 'length'],
    panicle.lengthM[0],
    panicle.lengthM[1],
  );
  const widthM = clamp(
    lengthM * randomRange(seed, [id, 'aspect'], 0.95, 1.15),
    panicle.widthM[0],
    panicle.widthM[1],
  );

  return {
    id,
    lengthM,
    widthM,
    // The head is heavy enough to nod away from the culm's own line.
    direction: normalize(
      add(
        scale(tipDirection, 0.86),
        vector(
          Math.cos(tiller.azimuth) * randomRange(seed, [id, 'nod'], 0.04, 0.22),
          0.12,
          Math.sin(tiller.azimuth) *
            randomRange(seed, [id, 'nod-z'], 0.04, 0.22),
        ),
      ),
    ),
    spin: randomRange(seed, [id, 'spin'], 0, Math.PI * 2),
    racemeCount: randomInt(
      seed,
      [id, 'raceme-count'],
      panicle.racemeCount[0],
      panicle.racemeCount[1],
    ),
    // First flowering is gated by the plant's age, not the tiller's: a new
    // tiller on an established clump flowers in its own first season.
    firstFloweringAgeYears: Math.max(
      MALEPARTUS_PROFILE.growth.firstFloweringAgeYears,
      Math.ceil(tiller.birthAgeYears),
    ),
  };
}

function culmPoints(seed, tiller, axisLength) {
  const id = `${tiller.id}:culm`;
  const outward = vector(Math.cos(tiller.azimuth), 0, Math.sin(tiller.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  // 'Malepartus' is an upright cultivar: the fountain shape is made by the
  // arching blades, not by splayed culms. Marginal culms lean out only
  // slightly more than central ones.
  const lean =
    (0.02 + 0.12 * tiller.radialFraction) *
    randomRange(seed, [id, 'lean-scale'], 0.7, 1.3);
  const direction = normalize(
    add(
      vector(0, 1, 0),
      add(
        scale(outward, lean),
        scale(sideways, randomRange(seed, [id, 'side-lean'], -0.09, 0.09)),
      ),
    ),
  );

  const sections = growWoodyAxis({
    origin: new THREE.Vector3(
      tiller.position.x,
      tiller.position.y,
      tiller.position.z,
    ),
    orientation: orientationFor(direction),
    length: axisLength,
    radius: tiller.baseRadiusM,
    sectionCount: tiller.nodeCount,
    // A culm is a stiff, near-straight cane. Almost all of its character is
    // the initial lean and a slight outward drift, not woody gnarl.
    gnarliness: 0.00035,
    taper: 1 - MALEPARTUS_PROFILE.cane.axisTaperRatios[1],
    force: {
      direction: new THREE.Vector3(
        outward.x * 0.16,
        1,
        outward.z * 0.16,
      ).normalize(),
      strength: (0.0000075 * 28) / tiller.nodeCount,
    },
    rng: axisRng(seed, id),
  });

  return sections.map((section) => ({
    position: vector(section.origin.x, section.origin.y, section.origin.z),
    radius: section.radius,
  }));
}

function makeTiller(seed, sequence, birthAgeYears) {
  const architecture = MALEPARTUS_PROFILE.architecture;
  const culm = MALEPARTUS_PROFILE.cane;
  const id = `malepartus:tiller:${String(sequence).padStart(2, '0')}`;
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
      ['malepartus', 'flowering-fraction'],
      MALEPARTUS_PROFILE.growth.floweringTillerFraction[0],
      MALEPARTUS_PROFILE.growth.floweringTillerFraction[1],
    );

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
        ));
  const extensionM = flowering
    ? randomRange(
        seed,
        [id, 'flowering-extension'],
        culm.floweringExtensionM[0],
        culm.floweringExtensionM[1],
      )
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
    collapseAngle: randomRange(seed, [id, 'collapse-angle'], 0.03, 0.26),
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
 * Build the finite, stable all-ages Malepartus organ graph once.
 *
 * The graph is a crown of tiller *sites*. Each site owns one baked culm at
 * its mature size; every season the site rebuilds that culm from nothing,
 * which is why there is no persistent framework here and no equivalent of a
 * shrub's cane-replacement cycle.
 */
export function createMalepartusModel({
  seed = 'malepartus-demo',
  maxYears = MALEPARTUS_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertModelOptions(seed, maxYears);
  const architecture = MALEPARTUS_PROFILE.architecture;
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
    kind: 'miscanthus-malepartus-growth-model',
    species: MALEPARTUS_PROFILE.species,
    cultivar: MALEPARTUS_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: MALEPARTUS_PROFILE.metresPerUnit,
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
    // itself persists, so this thins the fan rather than emptying it.
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
  // Last year's head is fully silvered and has lost hairs to the winter; this
  // year's is wherever the calendar has it.
  const push = previous ? 1 : phenology.paniclePush;
  const fanOpen = previous ? 1 : phenology.fanOpenProgress;
  const fluff = previous
    ? Math.max(0, 1 - state.weathering * 0.72)
    : phenology.plumeVisibility;
  const silver = previous ? 1 : phenology.silverProgress;

  return {
    id: `${panicle.id}:${state.cohort}`,
    sourceId: panicle.id,
    visible: state.visible && push > 0.02,
    position: tipPosition,
    direction: panicle.direction,
    spin: panicle.spin,
    racemeCount: panicle.racemeCount,
    lengthM: panicle.lengthM * state.sizeScale * lerp(0.35, 1, push),
    widthM: panicle.widthM * state.sizeScale,
    // The fan is squeezed shut inside the flag-leaf sheath and spreads as it
    // clears it. An instance matrix can express that directly by scaling the
    // head across its axis, so no second geometry is needed.
    fanOpen: lerp(0.26, 1, fanOpen),
    plumeVisibility: clamp01(fluff),
    silverProgress: clamp01(silver),
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
          Math.hypot(tip.x, tip.z) + (panicle.widthM * panicle.fanOpen) / 2,
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
  let silveredPanicles = 0;

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
        if (culm.panicle.silverProgress > 0.5) silveredPanicles += 1;
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
    silveredPanicles,
    flowersOnCurrentSeasonCulms: phenology.flowersOnCurrentSeasonCulms,
  };
}

function ageAwarePhenology(phenology, stats) {
  if (stats.visiblePanicles > 0) return phenology;
  const floweringPhase = new Set([
    'booting',
    'heading',
    'flowering',
    'silvering',
  ]);
  if (!floweringPhase.has(phenology.phase)) return phenology;
  const label = 'Vegetative clump; no panicles at this age yet';
  return Object.freeze({ ...phenology, stage: label, label });
}

function careHintsForSnapshot(phenology, stats, options) {
  const hints = getMalepartusCareHints(phenology.dayOfYear, options);
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
      'Malepartus does not expose destructive care events; the single annual cut is modelled by the calendar.',
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
export function evaluateMalepartusModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 250,
    events = [],
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'miscanthus-malepartus-growth-model') {
    throw new TypeError('Expected a model returned by createMalepartusModel');
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

  const architecture = MALEPARTUS_PROFILE.architecture;
  const phenology = getMalepartusPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  // A clump only widens while it is in growth, so a winter day cannot make it
  // broader than the September before it.
  const now = ageYears + phenology.emergenceProgress;
  const ageScale = sampleAnchors(
    MALEPARTUS_PROFILE.growth.plantAgeScaleAnchors,
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
        MALEPARTUS_PROFILE.management.cutbackHeightM,
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
      observedDisplay: MALEPARTUS_PROFILE.flowering.observedDisplay,
      sources: MALEPARTUS_SOURCES,
      rendererAssumptions: [
        'bounded 118-tiller representative sample of a clump that really carries hundreds',
        'tiller birth schedule and clump-widening curve fitted to the RHS 2-5 year time to ultimate size',
        'centre die-out curve for an undivided clump, and a staggered spring cut across the pruning window',
        "one retained cohort per tiller site: an uncut clump shows last season's culms, not an unbounded archive of every past year",
      ],
    },
    tillers,
    stats,
    appliedEvents: [],
  };
}
