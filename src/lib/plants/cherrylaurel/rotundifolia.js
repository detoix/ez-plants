/** One scene unit is one real-world metre. */
export const METRES_PER_UNIT = 1;

/**
 * Renderer-only calibration choices. Published observations live in
 * `ROTUNDIFOLIA_SOURCES` and the cultivar profile below; these counts and
 * probabilities are deliberately labelled as assumptions.
 */
export const ROTUNDIFOLIA_RENDER_PRIORS = Object.freeze({
  // Sparse cards on the shaded framework, dense sprays on the outer branch
  // orders. Seven staggered subnodes per woody sampling section reproduce the
  // screening-quality crown without wasting cards inside it.
  foliageNodeOccupancyByOrder: Object.freeze([0.8, 0.62, 0.44]),
  racemeNodeOccupancyByOrder: Object.freeze([0.03, 0.025, 0.005]),
  terminalRacemeOccupancyByOrder: Object.freeze([1, 0.8, 0.03]),
  fruitSetFraction: 0.58,
  annualFreshFlushFraction: 0.28,
  budOrganSampleCount: 8,
  racemeOrganSampleCount: 9,
  leafSubnodesPerWoodySection: 7,
  floweringMaturityYears: 4,
});

/** Evidence behind the cultivar defaults. */
export const ROTUNDIFOLIA_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Prunus laurocerasus 'Rotundifolia', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/89674/prunus-laurocerasus-rotundifolia/details',
    supports:
      'Vigorous bushy upright evergreen habit, about 5 m high, dark glossy oblong foliage, fragrant white 5-12 cm spikes in mid to late spring and red cherry-like fruits ripening black; 4-8 m ultimate height, 2.5-4 m spread and 5-10 years to maturity.',
  }),
  rhsScreening: Object.freeze({
    title: 'Plants for screening, Royal Horticultural Society',
    url: 'https://www.rhs.org.uk/plants/for-places/screening',
    supports:
      "'Rotundifolia' is vigorous, makes excellent screening, becomes tree-like with age, bears fragrant white flowers in mid to late spring and is listed at 5 m by 4 m.",
  }),
  vanDenBerk: Object.freeze({
    title: "Prunus laurocerasus 'Rotundifolia', Van den Berk Nurseries",
    url: 'https://www.vdberk.co.uk/trees/prunus-laurocerasus-rotundifolia/',
    supports:
      'Large evergreen shrub to small tree with a dense broad-ovate crown that becomes rounder as older branches sag, yellow-green annual twigs and elliptical to inversely ovate leaves about 12-17 cm long by 5-8 cm wide.',
  }),
  sofiyivkaStudy: Object.freeze({
    title:
      'Biological and morphological features of Prunus laurocerasus during introduction at Sofiyivka National Park',
    url: 'https://doi.org/10.37555/2707-3114.19.2023.293651',
    supports:
      'A study of 3-5-year-old plants in the Right-Bank Forest-Steppe of Ukraine reports first flowering at about four years, flowering from the second ten-day period of April into May, green fruit formation from late May, and black drupes by late August. These species-level observations anchor the age gate and regional calendar; cultivar appearance remains calibrated from the Rotundifolia sources.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports:
      'General woody-plant growth-stage codes used to label the modelled calendar.',
  }),
});

/**
 * Cultivar profile for a selectively shaped, free-standing cherry laurel.
 *
 * The 5 x 4 m target is the RHS screening observation, not an invented generic
 * Prunus. The finite branch and organ counts are renderer priors for a dense,
 * foliage-to-ground specimen that is lightly shaped after flowering rather
 * than repeatedly clipped into a rectangular hedge.
 */
export const ROTUNDIFOLIA_PROFILE = Object.freeze({
  species: 'Prunus laurocerasus',
  cultivar: 'Rotundifolia',
  commonName: 'Cherry laurel',
  commonNamePl: 'Laurowiśnia wschodnia',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'vigorous dense upright-bushy broad evergreen shrub',
    hasTrunk: false,
    crownOrigin: 'low, multi-stemmed framework clothed to the ground',
    matureHabit:
      'older specimens expose parts of the multi-stem framework and develop a broader, gently sagging, almost round crown',
    matureHeightM: 5,
    matureRadiusM: 2,
    matureSpreadM: 4,
    rhsUltimateHeightRangeM: Object.freeze([4, 8]),
    rhsUltimateSpreadRangeM: Object.freeze([2.5, 4]),
    yearsToMaturity: Object.freeze([5, 10]),
    initialFrameworkStemCount: 5,
    maximumFrameworkStemCount: 8,
    modelHorizonYears: 50,
  }),
  growth: Object.freeze({
    rate: 'vigorous',
    plantAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.08]),
      Object.freeze([1, 0.25]),
      Object.freeze([2, 0.43]),
      Object.freeze([4, 0.68]),
      Object.freeze([6, 0.84]),
      Object.freeze([8, 0.96]),
      Object.freeze([10, 1]),
      Object.freeze([50, 1]),
    ]),
    // The Sofiyivka field study records first flowering at about four years.
    // Keep the reproductive gate explicit so
    // the age slider never gives a juvenile shrub invented flowers or fruit.
    firstReliableFloweringAgeYears: 4,
  }),
  cane: Object.freeze({
    targetHeightM: Object.freeze([3.65, 4.72]),
    baseRadiusM: Object.freeze([0.025, 0.052]),
    crownRadiusM: 0.31,
    mainAxisNodeCount: Object.freeze([19, 24]),
    lateralAxisCount: Object.freeze([12, 14]),
    higherOrderAxisCount: Object.freeze([70, 84]),
    lateCrownAxisCount: Object.freeze([1, 2]),
    lateCrownAxisBirthAgeYears: Object.freeze([12, 34]),
    lowerFrameworkOpeningAgeYears: Object.freeze([16, 50]),
    oldLowerFrameworkLeafRetention: 0.58,
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.38,
      higherOrder: 0.22,
    }),
    childParentRadiusRatio: 0.58,
    axisTaperRatios: Object.freeze([1, 0.84, 0.48, 0.12]),
    barkDescription:
      'young shoots yellow-green, ageing through grey-brown on the persistent framework',
  }),
  leaf: Object.freeze({
    arrangement: 'alternate, shallow spiral',
    leavesPerNode: 1,
    phyllotacticTurnRadians: Math.PI * (3 - Math.sqrt(5)),
    lengthM: Object.freeze([0.12, 0.17]),
    widthM: Object.freeze([0.05, 0.08]),
    petioleLengthM: Object.freeze([0.009, 0.016]),
    shape: 'large broad elliptic to inversely ovate blade',
    texture: 'thick, leathery and glossy',
    evergreen: true,
    matureColour: 'dark glossy green',
    springFlushColour: 'vivid lime green',
  }),
  raceme: Object.freeze({
    position: 'upright from upper leaf axils and shoot tips',
    lengthM: Object.freeze([0.05, 0.12]),
    widthM: Object.freeze([0.025, 0.052]),
    flowerColour: 'fragrant cream-white',
    display: 'mid to late spring',
    renderedOrgansAreRepresentative: true,
  }),
  fruit: Object.freeze({
    type: 'small cherry-like drupe',
    colourSequence: Object.freeze(['green', 'red', 'glossy black']),
    toxicSeedKernel: true,
  }),
  management: Object.freeze({
    style: 'selectively shaped free-standing shrub, not a sheared hedge',
    pruningWindow: 'late spring to early summer after flowering',
    renewalIsImplicit: true,
  }),
});
