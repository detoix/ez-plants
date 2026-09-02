import { keyedRange } from '../../keyed-random.js';
import {
  getSmaragdCareHints,
  getSmaragdPhenology,
  SMARAGD_CALENDAR,
} from './phenology.js';
import { SMARAGD_PROFILE, SMARAGD_RENDER_PRIORS } from './smaragd.js';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const vec = (x, y, z) => ({ x, y, z });

function add(a, b) {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function subtract(a, b) {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function multiply(vector, scalar) {
  return vec(vector.x * scalar, vector.y * scalar, vector.z * scalar);
}

function mix(a, b, amount) {
  return vec(
    a.x + (b.x - a.x) * amount,
    a.y + (b.y - a.y) * amount,
    a.z + (b.z - a.z) * amount,
  );
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return vec(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function normalise(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return vec(vector.x / length, vector.y / length, vector.z / length);
}

function reject(vector, normal) {
  return subtract(vector, multiply(normal, dot(vector, normal)));
}

function sampleAnchors(anchors, value) {
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [x1, y1] = anchors[index];
    const [x0, y0] = anchors[index - 1];
    if (value <= x1) {
      const amount = (value - x0) / Math.max(1e-9, x1 - x0);
      return y0 + (y1 - y0) * amount;
    }
  }
  return anchors.at(-1)[1];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertOptions(seed, maxYears) {
  if (!['string', 'number'].includes(typeof seed)) {
    throw new TypeError('seed must be a string or number');
  }
  if (!Number.isInteger(maxYears) || maxYears < 1 || maxYears > 30) {
    throw new RangeError('maxYears must be an integer from 1 to 30');
  }
}

function heightAt(ageYears) {
  return sampleAnchors(SMARAGD_PROFILE.growth.heightAnchorsM, ageYears);
}

function radiusAt(ageYears) {
  return sampleAnchors(SMARAGD_PROFILE.growth.radiusAnchorsM, ageYears);
}

/** Compensate the fixed proxy roster as crown surface area grows with age. */
function coverageScaleAt(ageYears) {
  return sampleAnchors(
    [
      [0, 0.94],
      [5, 1.38],
      [10, 1.24],
      [20, 3.1],
      [30, 3.5],
    ],
    ageYears,
  );
}

/** Smaragd keeps a full lower shoulder and narrows smoothly at the leader. */
function crownEnvelope(fraction) {
  const clamped = clamp01(fraction);
  const lowerShoulder = 0.88 + 0.12 * clamp01(clamped / 0.2);
  const taper = Math.pow(Math.max(0, 1 - Math.pow(clamped, 1.72)), 0.54);
  return Math.max(0.06, lowerShoulder * taper);
}

function scaffoldBirthYears(maxYears) {
  // The age-zero state is a small established nursery plant, not a bare pole.
  // Keep the first five annual rings busy, then carry new families all the way
  // to the ten-year leader. Stopping at year eight left a conspicuous bare
  // spear above an otherwise tiered crown.
  const years = [];
  // Four staggered families per annual leader section give the dense,
  // all-azimuth shell seen in Smaragd. One or two left a spruce-like sequence
  // of disconnected whorls even when the foliage cards themselves were huge.
  for (let year = 0; year <= Math.min(10, maxYears); year += 1) {
    years.push(year, year, year, year);
  }
  // Older plants extend more slowly but still need new families beside the
  // advancing leader. Three smaller families every year wrap that leader
  // from several azimuths; one large family produced a visibly bare spear.
  for (let year = 12; year <= maxYears; year += 1) {
    years.push(year, year, year);
  }
  return years.slice(0, SMARAGD_RENDER_PRIORS.maximumScaffolds);
}

function leaderEndpoint(seed, year) {
  const height = heightAt(year);
  const id = `thuja:leader:y${year}`;
  const sway = year === 0 ? 0.0035 : Math.min(0.012, 0.003 + year * 0.0003);
  return vec(
    keyedRange(seed, [id, 'x'], -sway, sway),
    height,
    keyedRange(seed, [id, 'z'], -sway, sway),
  );
}

function bentPoint(start, end, amount, tangent, bend) {
  return add(
    mix(start, end, amount),
    multiply(tangent, Math.sin(amount * Math.PI) * bend),
  );
}

function makeScaffoldSpecs(seed, maxYears) {
  const yearSlots = new Map();
  return scaffoldBirthYears(maxYears).map((birthAgeYears, zeroIndex) => {
    const slot = yearSlots.get(birthAgeYears) ?? 0;
    yearSlots.set(birthAgeYears, slot + 1);
    const scaffoldIndex = zeroIndex + 1;
    const id = `thuja:scaffold:${String(scaffoldIndex).padStart(2, '0')}`;
    const azimuth =
      (zeroIndex * GOLDEN_ANGLE +
        keyedRange(seed, [id, 'azimuth-jitter'], -0.17, 0.17)) %
      TAU;
    return {
      id,
      scaffoldIndex,
      birthAgeYears,
      slot,
      azimuth,
      attachmentId: null,
      root: null,
      segmentIds: [],
      branchletIds: [],
    };
  });
}

function makeLeaderAxes(seed, maxYears, scaffoldSpecs) {
  const byYear = new Map();
  for (const scaffold of scaffoldSpecs) {
    const list = byYear.get(scaffold.birthAgeYears) ?? [];
    list.push(scaffold);
    byYear.set(scaffold.birthAgeYears, list);
  }

  const axes = [];
  const baseStart = vec(0, 0, 0);
  const baseEnd = leaderEndpoint(seed, 0);
  const baseScaffolds = byYear.get(0) ?? [];
  const basePoints = [baseStart];
  const baseNodes = [];
  for (const scaffold of baseScaffolds) {
    const nominal =
      baseScaffolds.length === 1
        ? 0.5
        : 0.06 + (scaffold.slot / (baseScaffolds.length - 1)) * 0.82;
    const amount = clamp01(
      nominal + keyedRange(seed, [scaffold.id, 'leader-height'], -0.025, 0.025),
    );
    const position = mix(baseStart, baseEnd, amount);
    const attachmentId = `thuja:leader:y0:scaffold:${scaffold.scaffoldIndex}:attachment`;
    scaffold.attachmentId = attachmentId;
    scaffold.root = position;
    basePoints.push(position);
    baseNodes.push({
      id: attachmentId,
      index: baseNodes.length,
      position,
      tangent: vec(0, 1, 0),
      sprays: [],
    });
  }
  basePoints.push(baseEnd);
  baseNodes.push({
    id: 'thuja:leader:y0:tip',
    index: baseNodes.length,
    position: baseEnd,
    tangent: vec(0, 1, 0),
    sprays: [],
  });
  axes.push({
    id: 'thuja:leader:y0',
    axisClass: 'leader-base',
    parentId: null,
    order: 0,
    birthAgeYears: 0,
    deathAgeYears: maxYears + 1,
    points: basePoints,
    nodes: baseNodes,
  });

  for (let year = 1; year <= maxYears; year += 1) {
    const id = `thuja:leader:y${year}`;
    const start = leaderEndpoint(seed, year - 1);
    const end = leaderEndpoint(seed, year);
    const scaffolds = byYear.get(year) ?? [];
    const tangent = normalise(vec(-(end.z - start.z), 0, end.x - start.x));
    const fractions = scaffolds
      .map((scaffold) => ({
        scaffold,
        amount: clamp01(
          (scaffold.slot + 1) / (scaffolds.length + 1) +
            keyedRange(seed, [scaffold.id, 'leader-height'], -0.045, 0.045),
        ),
      }))
      .sort((a, b) => a.amount - b.amount);
    const points = [start];
    const nodes = [];
    for (const { scaffold, amount } of fractions) {
      const position = bentPoint(start, end, amount, tangent, 0.0015);
      const attachmentId = `${id}:scaffold:${scaffold.scaffoldIndex}:attachment`;
      scaffold.attachmentId = attachmentId;
      scaffold.root = position;
      points.push(position);
      nodes.push({
        id: attachmentId,
        index: nodes.length,
        position,
        tangent: normalise(subtract(end, start)),
        sprays: [],
      });
    }
    points.push(end);
    nodes.push({
      id: `${id}:tip`,
      index: nodes.length,
      position: end,
      tangent: normalise(subtract(end, start)),
      sprays: [],
    });
    axes.push({
      id,
      axisClass: 'leader-segment',
      parentId: `thuja:leader:y${year - 1}:tip`,
      order: 0,
      birthAgeYears: year,
      deathAgeYears: maxYears + 1,
      points,
      nodes,
    });
  }
  return axes;
}

function scaffoldEndpoint(seed, scaffold, cohortYear, previousEnd) {
  const radial = vec(Math.cos(scaffold.azimuth), 0, Math.sin(scaffold.azimuth));
  const around = vec(-radial.z, 0, radial.x);
  const root = scaffold.root;
  const crownFraction = clamp01(root.y / Math.max(0.01, heightAt(cohortYear)));
  const reach =
    radiusAt(cohortYear) *
    crownEnvelope(crownFraction) *
    keyedRange(seed, [scaffold.id, 'reach'], 0.84, 0.93);
  const riseFraction = keyedRange(
    seed,
    [scaffold.id, 'rise'],
    SMARAGD_RENDER_PRIORS.branchRiseFraction[0],
    SMARAGD_RENDER_PRIORS.branchRiseFraction[1],
  );
  const curl =
    reach *
    keyedRange(
      seed,
      [scaffold.id, `cohort:${cohortYear}`, 'curl'],
      -0.045,
      0.045,
    );
  const endpoint = add(
    root,
    add(
      multiply(radial, reach),
      add(multiply(around, curl), vec(0, reach * riseFraction, 0)),
    ),
  );
  // Numerical or profile plateaus must never point a terminal cohort inward.
  const previousReach = Math.hypot(
    previousEnd.x - root.x,
    previousEnd.z - root.z,
  );
  if (reach + 1e-8 >= previousReach) return endpoint;
  return add(previousEnd, multiply(radial, 0.002));
}

function orthogonalNormal(direction, candidate) {
  const projected = reject(candidate, direction);
  if (dot(projected, projected) < 1e-8) {
    return normalise(cross(direction, vec(0, 1, 0)));
  }
  return normalise(projected);
}

function makeBranchletAxis(seed, scaffold, specification, maxYears) {
  const priors = SMARAGD_RENDER_PRIORS;
  const id = specification.id;
  const deathAgeYears = Math.min(maxYears + 1, specification.deathAgeYears);
  const scaffoldRadial = vec(
    Math.cos(scaffold.azimuth),
    0,
    Math.sin(scaffold.azimuth),
  );
  const rootRadius = Math.hypot(specification.root.x, specification.root.z);
  const radial =
    rootRadius > 0.008
      ? vec(
          specification.root.x / rootRadius,
          0,
          specification.root.z / rootRadius,
        )
      : scaffoldRadial;
  const around = vec(-radial.z, 0, radial.x);
  const crownFraction = clamp01(
    specification.root.y /
      Math.max(0.01, heightAt(specification.birthAgeYears)),
  );
  const targetRadius = Math.max(0.01, radiusAt(specification.birthAgeYears));
  const shellFraction = clamp01(
    Math.hypot(specification.root.x, specification.root.z) / targetRadius,
  );

  // A branchlet is rendered as four staggered pairs of flattened fans. Their
  // planes face mostly outward and lie vertically/tangentially along the shell,
  // matching the layered pads in reference photographs without crossed cards.
  const envelope = crownEnvelope(crownFraction);
  const patchScale = 0.52 + envelope * 0.48;
  const halfPatchWidth =
    keyedRange(seed, [id, 'patch-width'], 0.066, 0.094) * patchScale;
  const patchRise =
    keyedRange(seed, [id, 'patch-rise'], 0.13, 0.18) * patchScale;
  const verticalPhase = keyedRange(seed, [id, 'patch-y-phase'], -0.5, 0.5);
  const columnOffsets = [-1, 1, -0.72, 0.76, -0.44, 0.48, -0.18, 0.22];
  // Centre each four-pair pad on its woody station. Only growing upward from
  // every station exposes the annual scaffold tiers; balanced overlap above
  // and below produces the continuous shell seen on an evergreen Thuja.
  const rowOffsets = [-0.9, -0.82, -0.38, -0.3, 0.14, 0.22, 0.66, 0.76];
  const depthOffsets = [
    -0.012, 0.004, -0.008, 0.006, -0.005, 0.004, -0.003, 0.003,
  ];
  // Four staggered pairs overlap like the real plant's layered flat sprays.
  // Their divergent axes break up repeated tiers while their much smaller
  // footprint keeps the rendered crown inside the cultivar measurements.
  const verticalWeight = [0.72, 0.76, 0.84, 0.82, 0.86, 0.84, 0.79, 0.76];
  const directionYaw = [-0.36, 0.34, -0.25, 0.27, -0.14, 0.16, -0.24, 0.26];
  const radialWeight = [0.06, 0.08, 0.05, 0.06, 0.035, 0.045, 0.03, 0.04];
  // Outer Thuja spray pads mostly face away from the leader. A restrained
  // tangential roll gives them depth without turning half of every patch into
  // dark edge-on slivers at the normal whole-plant camera distance.
  const normalYaw = [-0.9, 0.86, -0.68, 0.7, -0.45, 0.48, -0.22, 0.25];
  const points = [specification.root];
  const nodes = [];

  for (let index = 0; index < priors.spraysPerBranchlet; index += 1) {
    // Wrap each pad along the curved crown rather than translating six planes
    // across one tangent. Each fan then faces outward at its own azimuth, so
    // the same proxy budget closes every camera view instead of forming tufts.
    const arcSpan =
      Math.max(
        0.28,
        Math.min(0.78, (halfPatchWidth / Math.max(rootRadius, 0.045)) * 1.35),
      ) *
      (0.55 + envelope * 0.45);
    const arcOffset = columnOffsets[index] * arcSpan;
    const cosine = Math.cos(arcOffset);
    const sine = Math.sin(arcOffset);
    const fanRadial = normalise(
      add(multiply(radial, cosine), multiply(around, sine)),
    );
    const fanAround = vec(-fanRadial.z, 0, fanRadial.x);
    const fanRadius = Math.max(
      rootRadius,
      halfPatchWidth * (0.45 + envelope * 1.35),
    );
    const arcPositionOffset = subtract(
      multiply(fanRadial, fanRadius),
      multiply(radial, rootRadius),
    );
    const position = add(
      specification.root,
      add(
        arcPositionOffset,
        add(
          vec(
            0,
            (rowOffsets[index] + verticalPhase) * patchRise +
              keyedRange(seed, [id, index, 'station-rise'], -0.012, 0.012),
            0,
          ),
          multiply(fanRadial, depthOffsets[index] * patchScale),
        ),
      ),
    );
    position.y = Math.max(0.006, position.y);
    points.push(position);
    const sprayDirection = normalise(
      add(
        vec(0, verticalWeight[index], 0),
        add(
          multiply(
            fanAround,
            directionYaw[index] * (0.4 + envelope * 0.6) +
              keyedRange(seed, [id, index, 'fan-yaw'], -0.025, 0.025),
          ),
          multiply(
            fanRadial,
            radialWeight[index] +
              rowOffsets[index] * 0.018 +
              keyedRange(seed, [id, index, 'fan-outward'], -0.012, 0.012),
          ),
        ),
      ),
    );
    const planeNormal = orthogonalNormal(
      sprayDirection,
      add(
        fanRadial,
        add(
          multiply(
            fanAround,
            normalYaw[index] +
              keyedRange(seed, [id, index, 'normal-yaw'], -0.035, 0.035),
          ),
          vec(
            0,
            keyedRange(seed, [id, index, 'normal-tilt'], -0.055, 0.035),
            0,
          ),
        ),
      ),
    );
    const sprayLength =
      keyedRange(
        seed,
        [id, index, 'spray-length'],
        priors.sprayLengthM[0],
        priors.sprayLengthM[1],
      ) *
      (0.42 + crownEnvelope(crownFraction) * 0.58);
    const widthRatio = keyedRange(
      seed,
      [id, index, 'spray-width'],
      priors.sprayWidthRatio[0],
      priors.sprayWidthRatio[1],
    );
    const terminal = index >= priors.spraysPerBranchlet - 2;
    const exposure = clamp01(
      0.18 +
        shellFraction * 0.47 +
        crownFraction * 0.22 +
        (terminal ? 0.13 : 0),
    );
    const sprayId = `${id}:spray:${index}`;
    nodes.push({
      id: `${id}:node:${index}`,
      index,
      position,
      tangent: sprayDirection,
      sprays: [
        {
          id: sprayId,
          scaffoldId: scaffold.id,
          scaffoldIndex: scaffold.scaffoldIndex,
          branchletId: id,
          branchletIndex: specification.sequence,
          fanIndex: index,
          birthAgeYears: specification.birthAgeYears,
          deathAgeYears,
          position,
          direction: sprayDirection,
          normal: planeNormal,
          lengthM: sprayLength,
          widthM: sprayLength * widthRatio,
          terminal,
          crownFraction,
          shellFraction,
          exposure,
        },
      ],
    });
  }

  return {
    id,
    axisClass: 'branchlet',
    scaffoldId: scaffold.id,
    scaffoldIndex: scaffold.scaffoldIndex,
    branchletIndex: specification.sequence,
    parentId: specification.parentId,
    order: 2,
    birthAgeYears: specification.birthAgeYears,
    deathAgeYears,
    points,
    nodes,
  };
}

function makeScaffoldAxes(seed, scaffold, maxYears) {
  const priors = SMARAGD_RENDER_PRIORS;
  const lateScaffold = scaffold.birthAgeYears > 10;
  const extensionIntervalYears = lateScaffold
    ? priors.scaffoldExtensionIntervalYears * 2
    : priors.scaffoldExtensionIntervalYears;
  const initialBranchletCount = lateScaffold
    ? 1
    : priors.initialBranchletsPerScaffold;
  const axes = [];
  const branchletSpecifications = [];
  let previousEnd = scaffold.root;
  let parentId = scaffold.attachmentId;
  let branchletSequence = 0;
  let segmentIndex = 0;

  for (
    let cohortYear = scaffold.birthAgeYears;
    cohortYear <= maxYears;
    cohortYear += extensionIntervalYears
  ) {
    const id = `${scaffold.id}:segment:${segmentIndex}`;
    const endpoint = scaffoldEndpoint(seed, scaffold, cohortYear, previousEnd);
    const radial = vec(
      Math.cos(scaffold.azimuth),
      0,
      Math.sin(scaffold.azimuth),
    );
    const around = vec(-radial.z, 0, radial.x);
    // Young Smaragd needs a closed shell before the long-lived renewal roster
    // has accumulated. Three out of four early extension segments therefore
    // carry a second, tangentially staggered branchlet. Those filler cohorts
    // expire normally, so the mature model stays within its fixed proxy ceiling.
    const youthfulShellFiller =
      segmentIndex > 0 &&
      cohortYear <= 10 &&
      (scaffold.scaffoldIndex + segmentIndex) % 4 !== 0;
    const skipMatureOuterLane =
      segmentIndex > 0 &&
      scaffold.birthAgeYears <= 10 &&
      cohortYear >= 18 &&
      (scaffold.scaffoldIndex + segmentIndex) % 3 === 0;
    const hostedBranchlets = skipMatureOuterLane
      ? 0
      : segmentIndex === 0
        ? initialBranchletCount
        : youthfulShellFiller
          ? 2
          : 1;
    // The innermost station closes the visual core around the leader; the
    // remaining stations overlap outward instead of forming one naked radial
    // spoke. Renewal cohorts live on the newer outer section.
    const fractions =
      segmentIndex === 0
        ? lateScaffold
          ? [0.86]
          : scaffold.birthAgeYears <= 3
            ? [0.38, 0.72, 0.97]
            : [0.12, 0.62, 0.91]
        : skipMatureOuterLane
          ? []
          : youthfulShellFiller
            ? [0.68, 0.91]
            : [0.76];
    const points = [previousEnd];
    const nodes = [];
    for (
      let hostedIndex = 0;
      hostedIndex < hostedBranchlets;
      hostedIndex += 1
    ) {
      const amount = clamp01(
        fractions[hostedIndex] +
          keyedRange(seed, [id, hostedIndex, 'station'], -0.025, 0.025),
      );
      const centre = bentPoint(
        previousEnd,
        endpoint,
        amount,
        around,
        keyedRange(seed, [id, hostedIndex, 'bend'], -0.018, 0.018),
      );
      const verticalSpan = Math.min(0.16, heightAt(cohortYear) * 0.15);
      const upperFraction = clamp01(
        centre.y / Math.max(0.01, heightAt(cohortYear)),
      );
      // Near the apex only a few scaffold families share each height band.
      // Broaden their tangential patch so those families wrap the leader
      // instead of collapsing into two camera-dependent tufts.
      const tangentialSpan = Math.min(
        0.12,
        radiusAt(cohortYear) * (0.34 + upperFraction * 0.5),
      );
      const initialVertical = [-0.74, -0.2, 0.3, 0.72];
      const initialTangential = [-0.15, 0.35, -0.32, 0.78];
      const renewalVertical = [-0.7, 0.22, 0.68, -0.28];
      const renewalTangential = [0.72, -0.62, 0.34, -0.78];
      const patternIndex =
        (segmentIndex * 2 + hostedIndex) % renewalVertical.length;
      const verticalOffset =
        (segmentIndex === 0
          ? initialVertical[hostedIndex]
          : renewalVertical[patternIndex]) * verticalSpan;
      const tangentialOffset =
        (segmentIndex === 0
          ? initialTangential[hostedIndex]
          : renewalTangential[patternIndex]) * tangentialSpan;
      const position = add(
        centre,
        add(multiply(around, tangentialOffset), vec(0, verticalOffset, 0)),
      );
      // Foliage may touch the soil, but never put a parent attachment below it.
      position.y = Math.max(0.012, position.y);
      // The leader defines the cultivar height. Keep branchlet roots below its
      // current tip so their own small terminal sprays close, but do not inflate,
      // the measured crown envelope.
      position.y = Math.min(
        position.y,
        Math.max(0.02, heightAt(cohortYear) - 0.065),
      );
      const attachmentId = `${id}:branchlet:${hostedIndex}:attachment`;
      points.push(position);
      nodes.push({
        id: attachmentId,
        index: nodes.length,
        position,
        tangent: normalise(subtract(endpoint, previousEnd)),
        sprays: [],
      });
      const branchletId = `${scaffold.id}:branchlet:${branchletSequence}`;
      // Turnover belongs to a physical station, not to the number of sibling
      // proxies authored before it. That keeps later cohort lifetimes stable
      // when a short-lived young-shell filler is added or removed.
      const earlyRenewalLane =
        (scaffold.scaffoldIndex + segmentIndex * 2 + hostedIndex * 2) % 3 === 0;
      // The three initial shell stations age at different times instead of
      // disappearing as one synchronized tier. Later renewal stations stand
      // for several overlapping generations and persist longer, which keeps a
      // mature evergreen full without creating a large middle-age roster peak.
      const retentionYears =
        segmentIndex === 0
          ? 10 + hostedIndex
          : youthfulShellFiller && hostedIndex > 0
            ? 8 + ((scaffold.scaffoldIndex + segmentIndex) % 2)
            : priors.branchletRetentionYears;
      const persistentBasalLane =
        segmentIndex === 0 && hostedIndex === 0 && scaffold.birthAgeYears <= 3;
      const deathAgeYears = persistentBasalLane
        ? maxYears + 1
        : cohortYear + retentionYears - (earlyRenewalLane ? 1 : 0);
      branchletSpecifications.push({
        id: branchletId,
        parentId: attachmentId,
        root: position,
        sequence: branchletSequence,
        birthAgeYears: cohortYear,
        deathAgeYears,
      });
      scaffold.branchletIds.push(branchletId);
      branchletSequence += 1;
    }
    points.push(endpoint);
    const tipId = `${id}:tip`;
    nodes.push({
      id: tipId,
      index: nodes.length,
      position: endpoint,
      tangent: normalise(subtract(endpoint, previousEnd)),
      sprays: [],
    });
    axes.push({
      id,
      axisClass: 'scaffold-segment',
      scaffoldId: scaffold.id,
      scaffoldIndex: scaffold.scaffoldIndex,
      segmentIndex,
      parentId,
      order: 1,
      birthAgeYears: cohortYear,
      deathAgeYears: maxYears + 1,
      points,
      nodes,
    });
    scaffold.segmentIds.push(id);
    previousEnd = endpoint;
    parentId = tipId;
    segmentIndex += 1;
  }

  for (const specification of branchletSpecifications) {
    axes.push(makeBranchletAxis(seed, scaffold, specification, maxYears));
  }
  return axes;
}

function maximumVisibleSprays(axes, maxYears) {
  let maximum = 0;
  for (let ageYears = 0; ageYears <= maxYears; ageYears += 1) {
    let count = 0;
    for (const axis of axes) {
      if (
        axis.axisClass === 'branchlet' &&
        axis.birthAgeYears <= ageYears &&
        axis.deathAgeYears > ageYears
      ) {
        count += axis.nodes.reduce(
          (sum, node) => sum + (node.sprays?.length ?? 0),
          0,
        );
      }
    }
    maximum = Math.max(maximum, count);
  }
  return maximum;
}

/** Build the stable all-years hierarchy once; snapshots only select cohorts. */
export function createSmaragdModel({
  seed = 'smaragd-demo',
  maxYears = SMARAGD_PROFILE.architecture.modelHorizonYears,
} = {}) {
  assertOptions(seed, maxYears);
  const serialSeed = String(seed);
  const scaffolds = makeScaffoldSpecs(serialSeed, maxYears);
  const axes = makeLeaderAxes(serialSeed, maxYears, scaffolds);
  for (const scaffold of scaffolds) {
    axes.push(...makeScaffoldAxes(serialSeed, scaffold, maxYears));
  }
  const maximumSprays = maximumVisibleSprays(axes, maxYears);
  if (maximumSprays > SMARAGD_RENDER_PRIORS.instanceCapacity) {
    throw new RangeError(
      `Smaragd cohort roster needs ${maximumSprays} spray instances; capacity is ${SMARAGD_RENDER_PRIORS.instanceCapacity}.`,
    );
  }
  return deepFreeze({
    schemaVersion: 2,
    kind: 'thuja-smaragd-growth-model',
    species: SMARAGD_PROFILE.species,
    cultivar: SMARAGD_PROFILE.cultivar,
    seed: serialSeed,
    maxYears,
    metresPerUnit: SMARAGD_PROFILE.metresPerUnit,
    maximumVisibleSprays: maximumSprays,
    scaffolds,
    axes,
  });
}

function cohortGrowth(axis, ageYears, phenology) {
  if (axis.axisClass === 'leader-base' || axis.birthAgeYears === 0) return 1;
  if (axis.birthAgeYears < ageYears) return 1;
  return phenology.shootGrowthProgress;
}

function transformFromRoot(position, sourceRoot, evaluatedRoot, growth) {
  return add(evaluatedRoot, multiply(subtract(position, sourceRoot), growth));
}

function activeDevelopmentAge(ageYears, phenology) {
  if (ageYears <= 0) return 0;
  return ageYears - 1 + phenology.shootGrowthProgress;
}

/** Evaluate age + day into a serialisable, Three.js-free snapshot. */
export function evaluateSmaragdModel(
  model,
  {
    ageYears = 5,
    dayOfYear = 180,
    events = [],
    seasonProfile = 'typical',
    offsetDays = 0,
  } = {},
) {
  if (!model || model.kind !== 'thuja-smaragd-growth-model') {
    throw new TypeError('Expected a model returned by createSmaragdModel');
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
  if (!Array.isArray(events) || events.length > 0) {
    throw new RangeError('Smaragd exposes no destructive care events.');
  }

  const phenology = getSmaragdPhenology(dayOfYear, {
    seasonProfile,
    offsetDays,
  });
  const coverageScale = coverageScaleAt(ageYears);
  const evaluatedByNode = new Map();
  const axes = [];
  const activeScaffolds = new Set();
  let visibleSprays = 0;
  let visibleBranchlets = 0;
  let freshSprays = 0;
  let visibleLeaderSegments = 0;
  let visibleScaffoldSegments = 0;

  for (const sourceAxis of model.axes) {
    if (
      sourceAxis.birthAgeYears > ageYears ||
      sourceAxis.deathAgeYears <= ageYears
    ) {
      continue;
    }
    const parentNode = sourceAxis.parentId
      ? evaluatedByNode.get(sourceAxis.parentId)
      : null;
    if (sourceAxis.parentId && !parentNode) {
      throw new Error(
        `Missing evaluated parent node ${sourceAxis.parentId} for ${sourceAxis.id}.`,
      );
    }
    const root = parentNode?.position ?? sourceAxis.points[0];
    const growthScale = cohortGrowth(sourceAxis, ageYears, phenology);
    const sourceRoot = sourceAxis.points[0];
    const transform = (position) =>
      transformFromRoot(position, sourceRoot, root, growthScale);
    const currentSeasonGrowth =
      sourceAxis.axisClass !== 'leader-base' &&
      sourceAxis.birthAgeYears > 0 &&
      sourceAxis.birthAgeYears === ageYears;
    const nodes = sourceAxis.nodes.map((sourceNode) => {
      const position = transform(sourceNode.position);
      const sprays = (sourceNode.sprays ?? []).map((sourceSpray) => {
        const visible = growthScale > 0.025;
        const freshWeight = sourceSpray.terminal ? 1 : 0.14;
        const freshGrowthProgress = currentSeasonGrowth
          ? phenology.freshTipProgress * freshWeight
          : 0;
        if (visible) visibleSprays += 1;
        if (freshGrowthProgress > 0.001) freshSprays += 1;
        return {
          ...sourceSpray,
          position,
          visible,
          scale: currentSeasonGrowth ? 0.16 + growthScale * 0.84 : 1,
          extensionProgress: currentSeasonGrowth ? growthScale : 1,
          freshGrowthProgress,
          currentSeasonGrowth,
          coverageScale,
        };
      });
      const node = {
        ...sourceNode,
        position,
        sprays,
      };
      evaluatedByNode.set(node.id, node);
      return node;
    });
    const points = sourceAxis.points.map(transform);
    axes.push({
      id: sourceAxis.id,
      axisClass: sourceAxis.axisClass,
      ...(sourceAxis.scaffoldId == null
        ? {}
        : { scaffoldId: sourceAxis.scaffoldId }),
      ...(sourceAxis.scaffoldIndex == null
        ? {}
        : { scaffoldIndex: sourceAxis.scaffoldIndex }),
      ...(sourceAxis.segmentIndex == null
        ? {}
        : { segmentIndex: sourceAxis.segmentIndex }),
      ...(sourceAxis.branchletIndex == null
        ? {}
        : { branchletIndex: sourceAxis.branchletIndex }),
      parentId: sourceAxis.parentId,
      order: sourceAxis.order,
      birthAgeYears: sourceAxis.birthAgeYears,
      deathAgeYears: sourceAxis.deathAgeYears,
      sourcePoints: sourceAxis.points,
      sourceNodes: sourceAxis.nodes,
      root,
      points,
      nodes,
      growthScale,
      currentSeasonGrowth,
    });
    if (sourceAxis.axisClass.startsWith('leader')) {
      visibleLeaderSegments += growthScale > 0.025 ? 1 : 0;
    } else if (sourceAxis.axisClass === 'scaffold-segment') {
      if (growthScale > 0.025) {
        visibleScaffoldSegments += 1;
        activeScaffolds.add(sourceAxis.scaffoldIndex);
      }
    } else if (sourceAxis.axisClass === 'branchlet' && growthScale > 0.025) {
      visibleBranchlets += 1;
    }
  }

  const developmentAge = activeDevelopmentAge(ageYears, phenology);
  const heightM = heightAt(developmentAge);
  const radiusM = radiusAt(developmentAge);
  return {
    schemaVersion: 2,
    kind: 'thuja-smaragd-snapshot',
    species: model.species,
    cultivar: model.cultivar,
    ageYears,
    coverageScale,
    dayOfYear: phenology.dayOfYear,
    phenology,
    careHints: getSmaragdCareHints(dayOfYear, {
      plantAgeYears: ageYears,
      seasonProfile,
      offsetDays,
    }),
    canes: [
      {
        id: 'thuja:central-leader',
        birthAgeYears: 0,
        baseRadiusM: SMARAGD_PROFILE.cane.baseRadiusM,
        removed: false,
        axes,
      },
    ],
    dimensions: { heightM, radiusM, spreadM: radiusM * 2 },
    stats: {
      visibleCanes: 1,
      visibleAxes: axes.length,
      visibleLeaderSegments,
      visibleScaffoldSegments,
      visibleBoughs: activeScaffolds.size,
      visibleBranchlets,
      visibleSprays,
      visibleLeaves: visibleSprays,
      freshSprays,
      maximumVisibleSprays: model.maximumVisibleSprays,
      evergreen: true,
      winterBronzing: false,
    },
  };
}

export { SMARAGD_CALENDAR };
