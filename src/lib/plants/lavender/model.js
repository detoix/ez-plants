import { getHidcoteCareHints, getHidcotePhenology } from './phenology.js';
import { HIDCOTE_PROFILE, HIDCOTE_RENDER_PRIORS } from './hidcote.js';
import {
  keyedInteger as randomInt,
  keyedRandom,
  keyedRange as randomRange,
} from '../../keyed-random.js';
import {
  add,
  clamp,
  clamp01,
  normalize,
  sampleAnchors,
  scale,
  smoothstep01,
  tangentAt,
  TAU,
  vector,
} from '../../model-math.js';

const ARCHITECTURE = HIDCOTE_PROFILE.architecture;
const FRAME = HIDCOTE_PROFILE.cane;
const SHOOT = HIDCOTE_PROFILE.shoot;
const LEAF = HIDCOTE_PROFILE.leaf;
const PEDUNCLE = HIDCOTE_PROFILE.peduncle;
const SPIKE = HIDCOTE_PROFILE.spike;
const PRIORS = HIDCOTE_RENDER_PRIORS;

/**
 * What one late-summer shear takes off a shoot, as a share of its length.
 *
 * RHS puts the cut at the spent flower stems plus about 2.5 cm of leaf growth.
 * On a shoot of 7-14 cm that is a fifth to a third, so the model expresses it
 * as a share rather than an absolute: a short shoot loses proportionally less
 * of itself, which is also what shearing a dome actually does.
 */
const TRIM_SHARE = clamp(
  HIDCOTE_PROFILE.management.trimLeafDepthM /
    ((SHOOT.lengthM[0] + SHOOT.lengthM[1]) / 2),
  0.05,
  0.4,
);

/* ------------------------------------------------------------------ *
 * Axis shapes
 * ------------------------------------------------------------------ */

/**
 * One framework branch: short, thick for its length, and splayed.
 *
 * A lavender's width comes from these leaning over, not from long laterals.
 * A young plant holds them close to upright and an old one has them nearly
 * flat on the ground with the middle opening out between them, which is the
 * whole reason the plant gets replaced rather than pruned.
 */
function frameworkAxisPoints(seed, branch) {
  const count = 6;
  const outward = vector(Math.cos(branch.azimuth), 0, Math.sin(branch.azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const splay = branch.splayRadians;
  const wander = randomRange(seed, [branch.id, 'wander'], -0.09, 0.09);
  const points = [];
  let cursor = branch.position;
  points.push(cursor);

  for (let index = 1; index <= count; index += 1) {
    const t = index / count;
    // Integrated rather than projected, because a frame branch does not leave
    // the crown at its final angle. Lavender makes a short upright trunk of a
    // few centimetres and divides above it, so the branches start near
    // vertical and bend over into their splay. Radiating them straight out of
    // one point at ground level instead gives the plant a starburst of spokes
    // under its mound, which is the most artificial thing a rendered subshrub
    // can do.
    const angle = splay * smoothstep01((t - 0.08) / 0.42);
    const step = branch.lengthM / count;
    const kink = Math.sin(t * Math.PI * 1.6) * wander;
    cursor = add(
      cursor,
      add(
        scale(outward, step * Math.sin(angle)),
        add(scale(sideways, step * kink), vector(0, step * Math.cos(angle), 0)),
      ),
    );
    points.push(cursor);
  }
  return points;
}

/**
 * One leafy shoot, and on this plant these are the plant.
 *
 * They are longer than the framework branch they stand on, and they follow
 * most of its splay rather than turning up out of it, so between them they
 * make the whole of the mound: its height from the upright inner ones, its
 * width from the outer ones going out past the end of their own branch, and
 * its skirt from those reaching the soil. That is what a photographed lavender
 * has where a first attempt at this model had bare wood.
 */
function shootAxisPoints(seed, branch, framePoints, slot) {
  const key = [branch.id, 'shoot', slot];
  // Where a shoot sits on the frame is independent of when it is born, and
  // getting that wrong is very visible. Tying position to slot index -- which
  // is birth order -- clothes a branch from the crown outward, so a
  // four-year-old plant has the inner half of every branch in leaf and the
  // outer half standing bare. That is a lavender in its last year, not in its
  // prime: a plant fills out by adding shoots everywhere at once.
  //
  // Slot 0 is the exception, and it is botanical rather than cosmetic. A
  // branch continues at its own tip, so the first shoot a branch makes is its
  // terminal one — which is also what keeps every branch tip covered at every
  // age, the other half of the same problem.
  const along =
    slot === 0
      ? 1
      : clamp(
          0.06 + 0.92 * Math.pow(keyedRandom(seed, ...key, 'along'), 0.55),
          0.05,
          1,
        );
  const attachIndex = clamp(
    Math.round(along * (framePoints.length - 1)),
    1,
    framePoints.length - 1,
  );
  const origin = framePoints[attachIndex];
  const azimuth =
    branch.azimuth +
    randomRange(seed, [...key, 'azimuth'], -1.15, 1.15) +
    slot * 0.61;
  const rise = randomRange(
    seed,
    [...key, 'rise'],
    SHOOT.riseRadians[0],
    SHOOT.riseRadians[1],
  );
  // Angle from vertical, as a share of the parent's splay — and a large one. On an upright inner
  // branch this puts the shoot near-vertical and closes the top of the dome;
  // on a near-horizontal outer one it keeps the shoot going *out*, past the
  // end of its own branch and down onto the soil. That skirt is what a
  // photographed lavender has instead of visible wood — the plant reaches the
  // ground as foliage, not as a stem.
  const tilt = clamp(branch.splayRadians * (0.78 + rise), 0.02, 1.78);
  const lengthM = randomRange(
    seed,
    [...key, 'length'],
    SHOOT.lengthM[0],
    SHOOT.lengthM[1],
  );
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const bow = randomRange(seed, [...key, 'bow'], -0.1, 0.1);
  const count = 4;
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    // Shoots straighten as they rise, so the tilt eases off toward the tip.
    const eased = tilt * (1 - 0.35 * t * t);
    const reach = lengthM * t;
    points.push(
      add(
        origin,
        add(
          scale(outward, reach * Math.sin(eased)),
          add(
            scale(sideways, Math.sin(t * Math.PI) * lengthM * bow),
            vector(0, reach * Math.cos(eased), 0),
          ),
        ),
      ),
    );
  }
  return { points, azimuth, attachIndex, lengthM, tilt, outward, sideways };
}

/**
 * The naked flower stem, from the tip of a shoot.
 *
 * Two things about it matter and neither is its length. It is **leafless**,
 * which is what lifts the spike clear of the mound and gives the plant its
 * layered read; and it **leans**, in every direction at once, which is what
 * turns a hundred of them into the fan the photographs show rather than a bed
 * of nails. A dead-vertical peduncle is the single quickest way to make a
 * rendered lavender look wrong.
 */
function peduncleTemplate(seed, shoot) {
  const key = [shoot.id, 'peduncle'];
  // A stem continues the shoot it stands on, straightening only part of the
  // way toward vertical — and that is the whole geometry of the display.
  //
  // The tempting alternative is to give every stem a common height to reach
  // for, which produces one level violet layer over the dome. That is what a
  // *sheared hedge* looks like; a free-standing plant does not do it.
  // Photographs of the cultivar in flower show the stems thrown out in every
  // direction at once — up through the middle, sideways at the shoulders, and
  // nearly flat over the soil at the edge, with spikes pointing outward and
  // down. Levelling them is the quickest way to make a rendered lavender look
  // like a haircut.
  const straighten = randomRange(
    seed,
    [...key, 'straighten'],
    PEDUNCLE.straightenRange[0],
    PEDUNCLE.straightenRange[1],
  );
  const tilt = clamp(shoot.tilt * straighten, 0, 1.5);
  // The longest stems stand on the vigorous upright shoots through the middle
  // of the plant; a stem leaning out over the skirt is a good deal shorter.
  // Without this the outermost stems reach their full length sideways and the
  // plant grows a halo of spikes on bare wires a hand's width clear of it.
  const lengthM =
    randomRange(
      seed,
      [...key, 'length'],
      PEDUNCLE.lengthM[0],
      PEDUNCLE.lengthM[1],
    ) *
    (1 - 0.28 * clamp01(tilt / 1.5));
  const azimuth =
    shoot.azimuth + randomRange(seed, [...key, 'azimuth'], -0.55, 0.55);
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  const sideways = vector(-outward.z, 0, outward.x);
  const sway = randomRange(seed, [...key, 'sway'], -0.16, 0.16);
  const lift = randomRange(seed, [...key, 'lift'], -0.22, 0.46);
  const count = 3;
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    // Stiff, very slightly S-curved, and it does not necessarily lift.
    //
    // Easing every stem toward vertical was what put all the spikes in one
    // band on top of the plant: each one started at the mound's surface and
    // then climbed, so the display was a shell floating over the foliage with
    // nothing below it. On a real plant a stem near the crown does lift, and
    // one out on the skirt carries its spike further out and *down*, level
    // with the foliage or below it. `lift` is per stem and signed.
    const angle = tilt * (1 - lift * t * t);
    const reach = lengthM * t;
    points.push(
      add(
        shoot.tipPosition,
        add(
          scale(outward, reach * Math.sin(angle)),
          add(
            scale(sideways, Math.sin(t * Math.PI) * lengthM * sway),
            vector(0, reach * Math.cos(angle), 0),
          ),
        ),
      ),
    );
  }

  const tip = points.at(-1);
  const previous = points.at(-2);
  return {
    points,
    lengthM,
    direction: normalize({
      x: tip.x - previous.x,
      y: tip.y - previous.y,
      z: tip.z - previous.z,
    }),
    baseRadiusM: randomRange(
      seed,
      [...key, 'radius'],
      PEDUNCLE.baseRadiusM[0],
      PEDUNCLE.baseRadiusM[1],
    ),
    spikeLengthM: randomRange(
      seed,
      [...key, 'spike-length'],
      SPIKE.lengthM[0],
      SPIKE.lengthM[1],
    ),
    spikeWidthM: randomRange(
      seed,
      [...key, 'spike-width'],
      SPIKE.widthM[0],
      SPIKE.widthM[1],
    ),
    verticillasters: randomInt(
      seed,
      [...key, 'whorls'],
      SPIKE.verticillasters[0],
      SPIKE.verticillasters[1],
    ),
    roll: keyedRandom(seed, shoot.id, 'spike-roll') * TAU,
  };
}

/* ------------------------------------------------------------------ *
 * Leaves
 * ------------------------------------------------------------------ */

/**
 * One leaf at a node.
 *
 * Lavender's phyllotaxis is decussate — successive pairs at right angles — and
 * each axil also carries a fascicle of smaller leaves. That fascicle is why
 * the shoots read as whorled tufts rather than as ladders of paired leaves,
 * so it is modelled: leaves 0 and 1 are the pair, 2 and 3 the fascicle beside
 * them, shorter and pressed closer to the stem.
 */
function makeLeaf(seed, node, index) {
  const id = `${node.id}:leaf:${index}`;
  const inPair = index < 2;
  // The decussate pair, turned a quarter turn at every node.
  const pairAzimuth = node.azimuth + (node.index % 2) * (Math.PI / 2);
  // The fascicle has to be fanned, not stacked. Seating its leaves on the
  // same two azimuths as the pair puts three blades on top of each other and
  // the shoot comes out clothed in what look like broad olive leaves, which
  // is the opposite of the thing this plant is named for. Fanning them out
  // and shortening them is what makes a node read as the tuft it is.
  const fascicle = index - 2;
  const azimuth =
    pairAzimuth +
    (index % 2 === 0 ? 0 : Math.PI) +
    (inPair
      ? randomRange(seed, [id, 'pair-jitter'], -0.12, 0.12)
      : (fascicle - 1) * 0.82 +
        randomRange(seed, [id, 'fascicle-jitter'], -0.24, 0.24));
  const lengthM =
    randomRange(seed, [id, 'length'], LEAF.lengthM[0], LEAF.lengthM[1]) *
    // Fascicle leaves are this year's young ones in the axil of last year's,
    // so they are a good deal shorter.
    (inPair ? 1 : randomRange(seed, [id, 'fascicle-scale'], 0.32, 0.55));
  const widthM = randomRange(
    seed,
    [id, 'width'],
    LEAF.widthM[0],
    LEAF.widthM[1],
  );
  const outward = vector(Math.cos(azimuth), 0, Math.sin(azimuth));
  // A lavender leaf lies close along its shoot and turns out only at the tip;
  // it is nothing like a shrub's outstretched blade. `spread` is how far off
  // the stem it stands, and it is deliberately small.
  const spread = randomRange(
    seed,
    [id, 'spread'],
    inPair ? 0.2 : 0.32,
    inPair ? 0.46 : 0.62,
  );
  const stemward = normalize(node.tangent);

  return {
    id,
    index,
    inPair,
    azimuth,
    lengthM,
    widthM,
    // Seated at the node itself: the leaves are sessile, which is exactly why
    // no petiole appears anywhere in this plant's geometry or in its plate.
    position: add(node.position, scale(outward, widthM * 0.4)),
    direction: normalize(
      add(scale(stemward, 1 - spread * 0.8), scale(outward, spread)),
    ),
    // Revolute margins keep the blade edge-on to the sky, so the plate's face
    // is turned outward from the shoot rather than upward.
    normal: normalize(add(outward, scale(vector(0, 1, 0), 0.35))),
  };
}

function makeNode(seed, shoot, index, position, tangent, nodeCount) {
  const id = `${shoot.id}:node:${index}`;
  const positionAlongAxis = (index + 1) / nodeCount;
  const node = {
    id,
    axisId: shoot.id,
    index,
    positionAlongAxis,
    position,
    tangent,
    azimuth: shoot.azimuth,
    leaves: [],
  };
  // The bottom of a shoot is bare: it is last year's wood by the time this
  // year's leaves are out, and on an old shoot it is the frame.
  if (positionAlongAxis < PRIORS.bareShootFraction) return node;
  for (let leaf = 0; leaf < PRIORS.leavesPerNode; leaf += 1) {
    node.leaves.push(makeLeaf(seed, node, leaf));
  }
  return node;
}

/* ------------------------------------------------------------------ *
 * Shoots and framework branches
 * ------------------------------------------------------------------ */

function makeShoot(seed, branch, framePoints, slot, birthAgeYears) {
  const id = `${branch.id}:shoot:${String(slot).padStart(2, '0')}`;
  const shape = shootAxisPoints(seed, branch, framePoints, slot);
  const nodeCount = randomInt(
    seed,
    [id, 'nodes'],
    PRIORS.shootNodeCount[0],
    PRIORS.shootNodeCount[1],
  );
  const shoot = {
    id,
    parentId: `${branch.id}:axis:0`,
    order: 1,
    birthAgeYears,
    azimuth: shape.azimuth,
    // The flower stem it will carry continues this, so it has to travel.
    tilt: shape.tilt,
    attachIndex: shape.attachIndex,
    lengthM: shape.lengthM,
    points: shape.points,
    pointCount: shape.points.length,
    tipPosition: shape.points.at(-1),
    nodes: [],
  };

  // Nodes are spread evenly along the shoot rather than sampled from its
  // control points: a shoot is 7-10 nodes on a 10 cm stem, and the curve only
  // has five points to say where it goes.
  for (let index = 0; index < nodeCount; index += 1) {
    const t = (index + 1) / nodeCount;
    const at = t * (shape.points.length - 1);
    const low = Math.min(Math.floor(at), shape.points.length - 2);
    const mix = at - low;
    const position = add(
      shape.points[low],
      scale(
        {
          x: shape.points[low + 1].x - shape.points[low].x,
          y: shape.points[low + 1].y - shape.points[low].y,
          z: shape.points[low + 1].z - shape.points[low].z,
        },
        mix,
      ),
    );
    shoot.nodes.push(
      makeNode(
        seed,
        shoot,
        index,
        position,
        tangentAt(shape.points, low + 1),
        nodeCount,
      ),
    );
  }

  shoot.peduncle = peduncleTemplate(seed, shoot);
  // Whether this shoot is one of the ones that flowers at all. Fixed for the
  // life of the shoot, so a plant does not flicker between two silhouettes as
  // the day is scrubbed.
  shoot.flowers =
    keyedRandom(seed, id, 'flowering-shoot') < PRIORS.floweringShootShare;
  return shoot;
}

function makeBranch(
  seed,
  {
    cycleIndex,
    sequence,
    branchCount,
    birthAgeYears,
    cycleEndAgeYears,
    maxYears,
  },
) {
  const id = `hidcote:c${cycleIndex}:branch:${String(sequence).padStart(2, '0')}`;
  const azimuth =
    (sequence / branchCount) * TAU +
    cycleIndex * 0.39 +
    randomRange(seed, [id, 'azimuth-jitter'], -0.16, 0.16);
  const crownRadius = randomRange(
    seed,
    [id, 'crown-radius'],
    0.006,
    FRAME.crownRadiusM,
  );
  const branch = {
    id,
    cycleIndex,
    sequence,
    birthAgeYears,
    cycleEndAgeYears,
    position: vector(
      Math.cos(azimuth) * crownRadius,
      0,
      Math.sin(azimuth) * crownRadius,
    ),
    azimuth,
    splayRadians:
      FRAME.splayRadians[0] +
      (FRAME.splayRadians[1] - FRAME.splayRadians[0]) *
        Math.pow(keyedRandom(seed, id, 'splay'), FRAME.splayBias),
    lengthM: randomRange(
      seed,
      [id, 'length'],
      FRAME.lengthM[0],
      FRAME.lengthM[1],
    ),
    baseRadiusM: randomRange(
      seed,
      [id, 'base-radius'],
      FRAME.baseRadiusM[0],
      FRAME.baseRadiusM[1],
    ),
    shoots: [],
  };

  branch.points = frameworkAxisPoints(seed, branch);
  const slots = PRIORS.shootSlotsPerBranch;
  for (let slot = 0; slot < slots; slot += 1) {
    // Slot order is birth order. Spreading them across the fill window is
    // what makes a one-year-old plant a handful of shoots and a four-year-old
    // one a closed dome, from one stable graph.
    const shootBirthAgeYears =
      birthAgeYears + (slot / slots) * PRIORS.shootFillYears;
    if (
      shootBirthAgeYears >= cycleEndAgeYears ||
      shootBirthAgeYears > maxYears + 1
    ) {
      continue;
    }
    branch.shoots.push(
      makeShoot(seed, branch, branch.points, slot, shootBirthAgeYears),
    );
  }
  return branch;
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
 * Builds the stable all-years organ graph once.
 *
 * There is no renewal cohort here, and that absence is the plant: a
 * blackcurrant replaces its own canes on a schedule, a lavender cannot,
 * because it will not break from old wood. What the graph holds instead is
 * one framework per replacement cycle, and every cycle is a new plant in the
 * same ground.
 */
export function createHidcoteModel({
  seed = 'hidcote-demo',
  maxYears = 30,
} = {}) {
  assertModelOptions(seed, maxYears);
  const branches = [];
  const cycleYears = ARCHITECTURE.replacementCycleYears;
  const branchCount = ARCHITECTURE.frameworkBranchCount;

  for (let cycleStart = 0; cycleStart <= maxYears; cycleStart += cycleYears) {
    const cycleIndex = cycleStart / cycleYears;
    for (let sequence = 0; sequence < branchCount; sequence += 1) {
      branches.push(
        makeBranch(seed, {
          cycleIndex,
          sequence,
          branchCount,
          birthAgeYears: cycleStart,
          cycleEndAgeYears: cycleStart + cycleYears,
          maxYears,
        }),
      );
    }
  }

  return {
    schemaVersion: 1,
    kind: 'lavender-growth-model',
    species: HIDCOTE_PROFILE.species,
    cultivar: HIDCOTE_PROFILE.cultivar,
    seed: String(seed),
    maxYears,
    metresPerUnit: HIDCOTE_PROFILE.metresPerUnit,
    trimShare: TRIM_SHARE,
    branches,
  };
}

/**
 * A shear, as a care event.
 *
 * The only cut a lavender ever gets. It carries no target: unlike a
 * blackcurrant's whole-cane renewal there is nothing to select, because the
 * whole plant is sheared into a dome at once.
 */
export function createTrimEvent({ id, ageYears, dayOfYear }) {
  if (!Number.isInteger(ageYears) || ageYears < 0) {
    throw new TypeError('ageYears must be a non-negative integer');
  }
  if (!Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 365) {
    throw new TypeError('dayOfYear must be an integer from 1 to 365');
  }
  return Object.freeze({
    id: id ?? `trim:${ageYears}:${dayOfYear}`,
    type: 'trim',
    method: 'shear-after-flowering',
    ageYears,
    dayOfYear,
  });
}

export const hidcoteEventTime = (event) => {
  if (!Number.isInteger(event?.ageYears) || event.ageYears < 0) {
    throw new TypeError('event ageYears must be a non-negative integer');
  }
  const day = event.dayOfYear ?? 1;
  if (!Number.isInteger(day) || day < 1 || day > 365) {
    throw new TypeError('event dayOfYear must be an integer from 1 to 365');
  }
  return event.ageYears + (day - 1) / 365;
};

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

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

/** How far this season's green extension has run on the given day. */
function shootExtensionProgress(day, calendar) {
  return smoothstep01(
    (day - calendar.springGrowthStart) /
      Math.max(1, calendar.springGrowthEnd - calendar.springGrowthStart),
  );
}

/**
 * How long a shoot is, as a fraction of the extension it reaches in its own
 * first summer.
 *
 * Three states, and the middle one is the whole pruning regime in a line: it
 * grows to full length in its birth season, the shears take `TRIM_SHARE` off
 * it in August, and it stays at that length for the rest of its life while
 * the next season's shoots grow off its tip. That accumulation is exactly how
 * a lavender goes woody, and why an old one is replaced instead of cut.
 */
function shootLengthScale(shoot, currentYear, phenology, trimmedThisYear) {
  const birthYear = Math.floor(shoot.birthAgeYears);
  if (currentYear > birthYear) return 1 - TRIM_SHARE;
  if (currentYear < birthYear) return 0;
  const extension = shootExtensionProgress(
    phenology.dayOfYear,
    phenology.calendar,
  );
  return trimmedThisYear ? 1 - TRIM_SHARE : extension;
}

/**
 * One spike's own progress through the display.
 *
 * Staggered per spike, because a lavender is not a switch: the photographs
 * show green spikes, half-open spikes and spikes already going brown standing
 * side by side on the same plant in the same week.
 */
function spikeState(seed, spikeId, phenology) {
  const calendar = phenology.calendar;
  if (phenology.spikeVisibility === 0) return null;
  const offset = randomRange(
    seed,
    [spikeId, 'anthesis-offset'],
    PRIORS.anthesisOffsetDays[0],
    PRIORS.anthesisOffsetDays[1],
  );
  const day = phenology.dayOfYear;
  const onset = calendar.floweringStart + offset;
  const opening = clamp01((day - onset) / PRIORS.spikeOpeningDays);
  const spent = clamp01(
    (day - (onset + PRIORS.spikeDisplayDays)) /
      Math.max(1, calendar.dryHeadEnd - (onset + PRIORS.spikeDisplayDays)),
  );
  // The stem lengthens and the spike fattens before a single corolla shows.
  const extension = clamp01(
    (day - calendar.spikeEmergenceStart) /
      Math.max(1, onset - calendar.spikeEmergenceStart),
  );
  return {
    extension: smoothstep01(extension),
    opening: smoothstep01(opening) * (1 - spent),
    dryness: spent,
    // 0 green, 0.5 in full colour, 1 dry. What the renderer tints by.
    maturity: clamp01(0.5 * smoothstep01(opening) + 0.5 * spent),
  };
}

function evaluateBranch(seed, branch, now, currentYear, phenology, sheared) {
  const branchAgeYears =
    currentYear -
    Math.floor(branch.birthAgeYears) +
    shootExtensionProgress(phenology.dayOfYear, phenology.calendar);
  const frameScale = sampleAnchors(
    HIDCOTE_PROFILE.growth.frameAgeScaleAnchors,
    branchAgeYears,
  );
  const axes = [];
  const transformFramePoint = (position) =>
    scaledPosition(position, branch.position, frameScale);

  axes.push({
    id: `${branch.id}:axis:0`,
    order: 0,
    parentId: null,
    sourcePoints: branch.points,
    sourceNodes: [],
    root: branch.position,
    growthScale: frameScale,
    nodes: [],
    spike: null,
  });

  for (const shoot of branch.shoots) {
    if (shoot.birthAgeYears > now) continue;
    const shootAgeYears = currentYear - Math.floor(shoot.birthAgeYears);
    // A young plant makes short shoots as well as few of them. Scaling only
    // the frame leaves a one-year-old carrying a mature plant's foliage on a
    // stub, which comes out very nearly full size — and since the shoots are
    // what make this plant's radius, that is the whole silhouette wrong.
    const lengthScale =
      shootLengthScale(shoot, currentYear, phenology, sheared) *
      (0.5 + 0.5 * frameScale);
    if (lengthScale <= 0) continue;

    // The shoot hangs off the frame, so its root travels as the frame grows
    // and its own extension runs from there.
    const grownRoot = transformFramePoint(shoot.points[0]);
    const shootOrigin = shoot.points[0];
    const transformShootPoint = (position) =>
      add(
        grownRoot,
        scale(
          vector(
            position.x - shootOrigin.x,
            position.y - shootOrigin.y,
            position.z - shootOrigin.z,
          ),
          lengthScale,
        ),
      );

    // A shoot goes bare from the bottom up, not all over.
    //
    // Modelling this as a fading density across the whole shoot is the
    // obvious thing and it is wrong: it leaves an old plant as a uniform
    // haze of half-leaves, when what a real one has is a leafy shell over a
    // bare woody interior. Retreating the leaf zone toward the tip instead
    // gives exactly that, and it is why an old lavender opens out in the
    // middle and gets replaced rather than cut back.
    const bare = clamp(
      PRIORS.bareShootFraction + shootAgeYears * 0.055,
      PRIORS.bareShootFraction,
      0.74,
    );
    const nodes = [];
    for (const node of shoot.nodes) {
      if (node.positionAlongAxis < bare) continue;
      // Everything past the shear line went with the cut.
      if (sheared && node.positionAlongAxis > 1 - TRIM_SHARE) continue;
      const nodePosition = transformShootPoint(node.position);
      const leaves = node.leaves.map((leaf) => {
        const threshold = keyedRandom(seed, leaf.id, 'seasonal-presence');
        return {
          id: leaf.id,
          index: leaf.index,
          inPair: leaf.inPair,
          position: transformShootPoint(leaf.position),
          direction: leaf.direction,
          normal: leaf.normal,
          lengthM: leaf.lengthM,
          widthM: leaf.widthM,
          sourceLength: leaf.lengthM,
          // Evergreen: `leafiness` is a density, so a leaf that is not drawn
          // is one this sample does not carry, not one that has fallen.
          visible: phenology.leafiness > threshold,
          // A young shoot's leaves are still expanding in spring.
          scale:
            leaf.lengthM *
            (shootAgeYears <= 0
              ? 0.45 +
                0.55 *
                  shootExtensionProgress(
                    phenology.dayOfYear,
                    phenology.calendar,
                  )
              : 1),
        };
      });
      nodes.push({
        id: node.id,
        index: node.index,
        position: nodePosition,
        tangent: node.tangent,
        azimuth: node.azimuth,
        positionAlongAxis: node.positionAlongAxis,
        leaves,
      });
    }

    axes.push({
      id: shoot.id,
      order: 1,
      parentId: `${branch.id}:axis:0:node:${shoot.attachIndex - 1}`,
      sourcePoints: shoot.points,
      sourceNodes: shoot.nodes,
      root: grownRoot,
      growthScale: lengthScale,
      nodes,
      spike: null,
    });

    // The flower stem: this season only, and only from a shoot with a full
    // season behind it.
    // A shoot flowers every year once it has a season behind it. There is no
    // upper age: a lavender's flowers come off the current growth at the tip
    // of a branchlet, and the branchlet keeps extending for as long as the
    // plant lives.
    const flowering =
      shoot.flowers &&
      shootAgeYears >= PRIORS.floweringMinimumShootAgeYears &&
      phenology.spikeVisibility > 0;
    if (!flowering) continue;

    const peduncle = shoot.peduncle;
    const spikeId = `${shoot.id}:spike:y${currentYear}`;
    const state = spikeState(seed, spikeId, phenology);
    if (!state || state.extension <= 0.001) continue;

    // A young plant's stems are shorter along with the rest of it.
    const stemScale = state.extension * (0.62 + 0.38 * frameScale);
    const peduncleRoot = transformShootPoint(peduncle.points[0]);
    const peduncleOrigin = peduncle.points[0];
    const transformPeduncle = (position) =>
      add(
        peduncleRoot,
        scale(
          vector(
            position.x - peduncleOrigin.x,
            position.y - peduncleOrigin.y,
            position.z - peduncleOrigin.z,
          ),
          state.extension,
        ),
      );

    axes.push({
      id: `${shoot.id}:peduncle:y${currentYear}`,
      order: 2,
      parentId: `${shoot.id}:node:${shoot.nodes.length - 1}`,
      sourcePoints: peduncle.points,
      sourceNodes: [],
      root: peduncleRoot,
      growthScale: stemScale,
      nodes: [],
      spike: {
        id: spikeId,
        position: transformPeduncle(peduncle.points.at(-1)),
        direction: peduncle.direction,
        roll: peduncle.roll,
        // A spike is close to full length before it colours, then fattens as
        // the corollas come out and slims again as they drop.
        lengthM:
          peduncle.spikeLengthM *
          (0.42 + 0.58 * state.extension) *
          (1 + 0.06 * state.opening),
        widthM:
          peduncle.spikeWidthM *
          (0.66 + 0.34 * state.extension) *
          (1 + 0.34 * state.opening - 0.12 * state.dryness),
        verticillasters: peduncle.verticillasters,
        ...state,
        visible: true,
      },
    });
  }

  return {
    id: branch.id,
    cohort: 'framework',
    birthAgeYears: branch.birthAgeYears,
    ageYears: branchAgeYears,
    growthScale: frameScale,
    position: branch.position,
    baseRadiusM: branch.baseRadiusM * frameScale,
    targetHeightM: branch.lengthM,
    removed: false,
    axes,
  };
}

function snapshotDimensions(branches) {
  let heightM = 0;
  let foliageHeightM = 0;
  let radiusM = 0;
  for (const branch of branches) {
    if (branch.removed) continue;
    for (const axis of branch.axes) {
      for (const node of axis.nodes) {
        for (const leaf of node.leaves) {
          if (!leaf.visible) continue;
          foliageHeightM = Math.max(
            foliageHeightM,
            leaf.position.y + leaf.lengthM * 0.5,
          );
          radiusM = Math.max(
            radiusM,
            Math.hypot(leaf.position.x, leaf.position.z) + leaf.lengthM * 0.5,
          );
        }
      }
      if (axis.spike) {
        heightM = Math.max(heightM, axis.spike.position.y + axis.spike.lengthM);
        radiusM = Math.max(
          radiusM,
          Math.hypot(axis.spike.position.x, axis.spike.position.z),
        );
      }
    }
  }
  heightM = Math.max(heightM, foliageHeightM);
  // The same three keys every other plant's snapshot reports, plus the one
  // this species needs: RHS measures a lavender's height as its foliage
  // mound, and the flower stems standing over it are another 20 cm.
  return {
    heightM,
    radiusM,
    spreadM: radiusM * 2,
    foliageHeightM,
  };
}

function snapshotStats(branches, phenology) {
  const stats = {
    frameworkBranches: 0,
    shoots: 0,
    leaves: 0,
    spikes: 0,
    greenSpikes: 0,
    openSpikes: 0,
    drySpikes: 0,
    trimmed: phenology.trimmed,
  };
  for (const branch of branches) {
    if (branch.removed) continue;
    stats.frameworkBranches += 1;
    for (const axis of branch.axes) {
      if (axis.order === 1) stats.shoots += 1;
      for (const node of axis.nodes) {
        for (const leaf of node.leaves) if (leaf.visible) stats.leaves += 1;
      }
      const spike = axis.spike;
      if (!spike?.visible) continue;
      stats.spikes += 1;
      if (spike.dryness > 0.5) stats.drySpikes += 1;
      else if (spike.opening > 0.12) stats.openSpikes += 1;
      else stats.greenSpikes += 1;
    }
  }
  return stats;
}

/**
 * Evaluates the immutable graph at a year/day without mutating history.
 * Moving A -> B -> A therefore recreates byte-equivalent organ IDs and
 * coordinates.
 */
export function evaluateHidcoteModel(
  model,
  {
    ageYears = 0,
    dayOfYear = 190,
    events = [],
    region = 'central',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'lavender-growth-model') {
    throw new TypeError('Expected a model returned by createHidcoteModel');
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

  const phenology = getHidcotePhenology(dayOfYear, { region, offsetDays });
  const now = ageYears + (phenology.dayOfYear - 1) / 365;
  const currentYear = Math.floor(ageYears);
  const appliedEvents = events
    .filter((event) => hidcoteEventTime(event) <= now)
    .slice()
    .sort(
      (a, b) =>
        hidcoteEventTime(a) - hidcoteEventTime(b) ||
        String(a.id).localeCompare(String(b.id)),
    );
  // A caller can shear earlier than the calendar does; it cannot un-shear,
  // and after the scheduled day the plant is cut whether asked or not. Every
  // plant in this library is one somebody looks after.
  const manualTrimDay = appliedEvents
    .filter(
      (event) =>
        event.type === 'trim' && Math.floor(event.ageYears) === currentYear,
    )
    .reduce(
      (earliest, event) => Math.min(earliest, event.dayOfYear),
      Number.POSITIVE_INFINITY,
    );
  const sheared = phenology.trimmed || phenology.dayOfYear >= manualTrimDay;
  // A manual shear before the calendar one takes the spikes with it.
  const applied = sheared
    ? Object.freeze({
        ...phenology,
        trimmed: true,
        spikeVisibility: 0,
        displayIntensity: 0,
      })
    : phenology;

  const cycleYears = ARCHITECTURE.replacementCycleYears;
  const cycleAgeYears = ageYears % cycleYears;
  const branches = model.branches
    .filter(
      (branch) => branch.birthAgeYears <= now && now < branch.cycleEndAgeYears,
    )
    .map((branch) =>
      evaluateBranch(model.seed, branch, now, currentYear, applied, sheared),
    );

  return {
    species: model.species,
    cultivar: model.cultivar,
    seed: model.seed,
    ageYears,
    dayOfYear: applied.dayOfYear,
    cycleIndex: Math.floor(ageYears / cycleYears),
    cycleAgeYears,
    dimensions: snapshotDimensions(branches),
    phenology: applied,
    careHints: getHidcoteCareHints(applied.dayOfYear, {
      plantAgeYears: cycleAgeYears,
      region,
      offsetDays,
    }),
    // The shared renderer calls a plant's top-level modules canes, whatever
    // the species calls them. A lavender's are framework branches.
    canes: branches,
    stats: snapshotStats(branches, applied),
    appliedEvents: appliedEvents.map((event) => event.id),
  };
}
