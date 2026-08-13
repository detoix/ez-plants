/**
 * Real-world units used by the Limelight model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/**
 * Evidence behind the cultivar defaults. Published measurements are kept
 * separate from renderer priors so visual tuning cannot silently turn into a
 * botanical claim.
 */
export const LIMELIGHT_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Hydrangea paniculata 'Limelight', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/154246/hydrangea-paniculata-limelight/details',
    supports:
      'Robust upright open deciduous habit, 1.5-2.5 m ultimate height and spread reached in 5-10 years, dark-green foliage and dense conical heads changing from pale lime through creamy white to pink and green.',
  }),
  rhsTrial2008: Object.freeze({
    title: 'Hydrangea paniculata trial bulletin, RHS (2008)',
    url: 'https://www.rhs.org.uk/plants/pdfs/plant-trials-and-awards/plant-bulletins/hydrangea-paniculata.pdf',
    supports:
      "Trial plant measured 165 cm high by 225 cm wide; 'Limelight' had a robust upright-spreading habit, very dense broad-conical tapered panicles, pale-lime sterile florets changing through white to lime and pink, and flowered from mid-July to early October. Medium pruning reduced flopping.",
  }),
  rhsTrialResults: Object.freeze({
    title: 'Hydrangea paniculata trial results, Royal Horticultural Society',
    url: 'https://www.rhs.org.uk/plants/trials-awards/plant-trial-results/hydrangea-paniculata',
    supports:
      "The 2025 trial reconfirmed 'Limelight' for strong stems, good foliage and flowers carried down the plant; a hard-pruned specimen produced a 29 x 26 cm panicle.",
  }),
  cultivarPatent: Object.freeze({
    title: "Hydrangea plant named 'Limelight', US20020120968P1",
    url: 'https://patents.google.com/patent/US20020120968P1/en',
    supports:
      'Original cultivar description: freely branching upright-rounded shrub; opposite ovate serrulate 8.5-10 x 4-5.5 cm leaves; terminal pyramidal 15-25 x 12-18 cm panicles with 850-1200 flowers, persistent showy sepals and a mid-July to mid-October flowering season.',
  }),
  treesAndShrubsOnline: Object.freeze({
    title: 'Hydrangea paniculata cultivars J-L, Trees and Shrubs Online',
    url: 'https://www.treesandshrubsonline.org/articles/hydrangea/hydrangea-paniculata-cultivars-j-l/',
    supports:
      'Very dense broad panicles with about 80-100% sterile flowers, opening lime green, ageing cream and then pink; greenish to reddish stems; mid-July to early-October display and medium pruning to about four buds to limit flopping.',
  }),
  chicagoTrial: Object.freeze({
    title:
      'Panicle Hydrangeas, Plant Evaluation Notes No. 47, Chicago Botanic Garden',
    url: 'https://www.chicagobotanic.org/sites/default/files/pdf/plantevaluation/no47_hydrangea.pdf',
    supports:
      "A nine-year 'Limelight' reached about 1.78 m high by 2.54 m wide and carried approximately 23 x 18 cm overstuffed sterile-flowered heads, chartreuse through creamy white with a pink tinge in late September, ornamental through October.",
  }),
  polishRetailer: Object.freeze({
    title: "Hortensja bukietowa 'Limelight', Zielony Expert",
    url: 'https://zielonyexpert.pl/produkt/hortensja-bukietowa-limelight-hydrangea-paniculata/',
    supports:
      'Polish garden description: flowers form on current-season shoots; strong upright shoots carry lime flowers opening in July and changing through white to pink or burgundy through October; large oval dark-green leaves develop red-orange autumn colour.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports:
      'General woody-plant growth-stage codes used to label the modeled calendar.',
  }),
});

/**
 * Cultivar profile for a medium-pruned, garden-grown Hydrangea paniculata
 * 'Limelight'. The plant is a broad multi-stemmed shrub with a persistent
 * woody framework; its terminal panicles are made by shoots grown in the same
 * season. It is therefore not modeled as a tree and not renewed by removing
 * whole canes in the blackcurrant manner.
 */
export const LIMELIGHT_PROFILE = Object.freeze({
  species: 'Hydrangea paniculata',
  cultivar: 'Limelight',
  commonName: 'Panicle hydrangea',
  commonNamePl: 'Hortensja bukietowa',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'robust upright-spreading, rounded multi-stem shrub',
    hasTrunk: false,
    crownOrigin: 'low persistent woody framework',
    // This is an explicit renderer and camera-framing prior inside the RHS
    // 1.5-2.5 m envelope, not a measured trial mean. The measured references
    // remain separate below: 1.65 m in the RHS trial and about 1.78 m in the
    // nine-year Chicago trial.
    matureHeightM: 1.85,
    matureRadiusM: 1.125,
    observedRhsTrialHeightM: 1.65,
    observedRhsTrialSpreadM: 2.25,
    rhsUltimateHeightRangeM: Object.freeze([1.5, 2.5]),
    rhsUltimateSpreadRangeM: Object.freeze([1.5, 2.5]),
    yearsToMaturity: Object.freeze([5, 10]),
    initialFrameworkStemCount: 6,
    maximumFrameworkStemCount: 12,
    // Framework counts and the finite topology horizon are renderer priors;
    // the cited trials do not publish stem counts or a lifespan curve.
    modelHorizonYears: 30,
  }),
  growth: Object.freeze({
    rate: 'moderate to vigorous',
    plantAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.08]),
      Object.freeze([0.5, 0.2]),
      Object.freeze([1, 0.34]),
      Object.freeze([2, 0.55]),
      Object.freeze([3, 0.7]),
      Object.freeze([5, 0.88]),
      Object.freeze([7, 1]),
    ]),
    firstReliableFloweringAgeYears: 1.5,
    // Daily shoot dates are explicit central-Poland animation assumptions.
    shootEmergenceDay: 108,
    shootExtensionEndDay: 202,
  }),
  cane: Object.freeze({
    targetHeightM: Object.freeze([1.35, 1.68]),
    baseRadiusM: Object.freeze([0.009, 0.022]),
    crownRadiusM: 0.16,
    mainAxisNodeCount: Object.freeze([24, 34]),
    lateralAxisCount: Object.freeze([4, 7]),
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.34,
      higherOrder: 0.2,
    }),
    childParentRadiusRatio: 0.56,
    axisTaperRatios: Object.freeze([1, 0.86, 0.5, 0.14]),
    wholeCanePruning: false,
    barkDescription:
      'young shoots green to reddish; older stout stems reddish-brown to pale brown-grey with lenticels',
  }),
  leaf: Object.freeze({
    arrangement: 'opposite, commonly decussate',
    leavesPerNode: 2,
    decussateTurnRadians: Math.PI / 2,
    lengthM: Object.freeze([0.085, 0.1]),
    widthM: Object.freeze([0.04, 0.055]),
    petioleLengthM: Object.freeze([0.015, 0.018]),
    shape: 'simple ovate with an acute tip and obtuse base',
    margin: 'serrulate',
    texture: 'thick, slightly glossy',
    autumnColours: Object.freeze([
      'red-orange',
      'burgundy-red',
      'bronze-green',
    ]),
  }),
  panicle: Object.freeze({
    position: 'terminal on current-season shoots',
    form: 'very dense, broad conical to pyramidal and tapered',
    lengthM: Object.freeze([0.15, 0.25]),
    widthM: Object.freeze([0.12, 0.18]),
    hardPrunedObservedLengthM: 0.29,
    hardPrunedObservedWidthM: 0.26,
    peduncleLengthM: Object.freeze([0.12, 0.2]),
    showySterileFraction: Object.freeze([0.8, 1]),
    representativeFlowerCount: Object.freeze([850, 1200]),
    sterileSepalCount: 4,
    sterileSepalLengthM: Object.freeze([0.01, 0.02]),
    sterileSepalWidthM: Object.freeze([0.0075, 0.0125]),
    colourSequence: Object.freeze([
      'pale lime',
      'cream-white',
      'pink',
      'burgundy-pink',
      'dry tan',
    ]),
    calyxPersistent: true,
    renderedFloretsAreRepresentative: true,
    note: 'The renderer samples the dense floral surface rather than drawing all 850-1200 reported flowers in every head.',
  }),
  flowering: Object.freeze({
    wood: 'current-season growth',
    terminal: true,
    observedDisplay: 'mid-July to early October',
    polishDisplay: 'July to October',
  }),
  management: Object.freeze({
    pruningWindow: 'late winter to early spring, before new growth',
    pruningDayRange: Object.freeze([45, 90]),
    recommendedPruning: 'medium',
    retainedBudPairs: 4,
    pruningMethod:
      "shorten the previous season's flowered shoots to a strong framework, retaining about four buds; remove weak, damaged and crossing wood",
    avoidHardPruning: true,
    hardPruningNote:
      'Severe cuts promote very large heads on fast softer growth, increasing the risk of stems flopping under their weight.',
    flowerHeadsMayRemainForWinter: true,
  }),
});
