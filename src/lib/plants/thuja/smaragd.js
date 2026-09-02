/** Real-world units used by the thuja model. One scene unit is one metre. */
export const METRES_PER_UNIT = 1;

/**
 * Renderer choices calibrated from photographs rather than published counts.
 * They stay separate from the sourced cultivar profile so an instance count
 * cannot be mistaken for a botanical measurement.
 */
export const SMARAGD_RENDER_PRIORS = Object.freeze({
  maximumScaffolds: 101,
  tenYearScaffolds: 44,
  // Eight small fans tile each branchlet patch. More, smaller instances give a
  // continuous fine-grained shell without inflating any fan past the declared
  // cultivar envelope; the six-triangle near card lowers total cost.
  spraysPerBranchlet: 8,
  initialBranchletsPerScaffold: 3,
  scaffoldExtensionIntervalYears: 3,
  // Maximum retention. One in three deterministic renewal lanes turns over a
  // year earlier, avoiding a synchronized foliage drop and a budget spike.
  branchletRetentionYears: 14,
  // The all-ages maximum is calculated from the cohort schedule, not guessed:
  // 256 simultaneously live branchlets x eight sprays. Short-lived young-shell
  // fillers expire before the long-retention renewal lanes reach their peak.
  instanceCapacity: 2048,
  // Main scaffolds spread only gently upward; the scale-foliage fans provide
  // the strong vertical gesture. This keeps old lower foliage at ground level.
  branchRiseFraction: Object.freeze([0.1, 0.22]),
  branchletLengthM: Object.freeze([0.09, 0.15]),
  sprayLengthM: Object.freeze([0.075, 0.115]),
  sprayWidthRatio: Object.freeze([0.74, 0.98]),
});

/** Primary evidence behind the maintained, garden-grown defaults. */
export const SMARAGD_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Thuja occidentalis 'Smaragd', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/75683/thuja-occidentalis-smaragd/details',
    supports:
      'Slow-growing evergreen, bushy habit, 10-20 years to maturity, and a maintained garden size in the 1.5-2.5 m class.',
  }),
  missouriBotanicalGarden: Object.freeze({
    title:
      "Thuja occidentalis 'Smaragd', Missouri Botanical Garden Plant Finder",
    url: 'https://www.missouribotanicalgarden.org/PlantFinder/PlantFinderDetails.aspx?basic=%27Smaragd%27&isprofile=1&taxonid=254004',
    supports:
      'Compact narrowly pyramidal habit, glossy bright-green scale foliage in flat sprays, and small urn-shaped cones.',
  }),
  americanConiferSociety: Object.freeze({
    title: "Thuja occidentalis 'Smaragd', American Conifer Society",
    url: 'https://conifersociety.org/conifers/thuja-occidentalis-smaragd',
    supports:
      'Fine branchlets, glossy emerald foliage that does not bronze in winter, narrow upright habit, and an approximately 2 m by 0.5 m ten-year specimen.',
  }),
  ncStateToolbox: Object.freeze({
    title: 'Thuja occidentalis, NC State Extension Gardener Plant Toolbox',
    url: 'https://plants.ces.ncsu.edu/plants/thuja-occidentalis/',
    supports:
      'Adult leaves are overlapping opposite scales arranged in dense flat layered sprays; reddish-brown fibrous bark and a narrow conical crown are characteristic.',
  }),
  wildflowerCenter: Object.freeze({
    title:
      'Thuja occidentalis, Lady Bird Johnson Wildflower Center Native Plant Database',
    url: 'https://www.wildflower.org/plants/result.php?id_plant=thoc2',
    supports:
      'A narrow conical crown of short spreading branches, often with an angled or divided trunk.',
  }),
});

/**
 * Cultivar profile for a maintained Thuja occidentalis 'Smaragd'.
 *
 * The renderer follows the common European garden plant rather than the much
 * larger wild species. The 4.2 m long-horizon envelope reconciles the
 * approximately 2 m ten-year conifer described by the ACS with older nursery
 * specimens; the age curve, organ counts and exact radii are declared render
 * priors, not source measurements.
 */
export const SMARAGD_PROFILE = Object.freeze({
  species: 'Thuja occidentalis',
  cultivar: 'Smaragd',
  synonyms: Object.freeze(['Emerald Green', 'Emerald']),
  commonName: 'Emerald arborvitae',
  commonNamePl: 'Żywotnik zachodni',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'dense narrow pyramidal evergreen conifer',
    hasTrunk: true,
    crownOrigin: 'foliage retained close to ground level',
    matureHeightM: 4.2,
    matureRadiusM: 0.7,
    tenYearHeightM: 2,
    tenYearRadiusM: 0.25,
    modelHorizonYears: 30,
  }),
  growth: Object.freeze({
    rate: 'slow to moderate',
    // Absolute cumulative dimensions make every annual segment permanent.
    // Evaluating an older year never rescales an established point.
    heightAnchorsM: Object.freeze([
      Object.freeze([0, 0.36]),
      Object.freeze([1, 0.52]),
      Object.freeze([3, 0.78]),
      Object.freeze([5, 1.12]),
      Object.freeze([10, 2]),
      Object.freeze([20, 3.25]),
      Object.freeze([30, 4.2]),
    ]),
    radiusAnchorsM: Object.freeze([
      Object.freeze([0, 0.09]),
      Object.freeze([1, 0.12]),
      Object.freeze([3, 0.17]),
      Object.freeze([5, 0.21]),
      Object.freeze([10, 0.25]),
      Object.freeze([20, 0.48]),
      Object.freeze([30, 0.7]),
    ]),
  }),
  cane: Object.freeze({
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.34,
      higherOrder: 0.18,
    }),
    childParentRadiusRatio: 0.64,
    axisTaperRatios: Object.freeze([1, 0.78, 0.48, 0.16]),
    // The low crown conceals most wood. A restrained trunk avoids the exposed
    // nursery-conifer cone that an oversized base produced between sprays.
    baseRadiusM: 0.038,
  }),
  foliage: Object.freeze({
    type: 'overlapping scale leaves on flattened fan-shaped sprays',
    arrangement: 'opposite decussate scales; sprays layered around the crown',
    evergreen: true,
    winterBronzing: false,
  }),
  management: Object.freeze({
    maintained: true,
    toleratesClipping: true,
    cutIntoOldWood: false,
  }),
});
