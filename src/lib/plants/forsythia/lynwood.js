/**
 * Real-world units used by the forsythia model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/**
 * Procedural choices used to make the sourced morphology readable in a
 * real-time renderer. These are calibration priors, not published cultivar
 * measurements; keeping them separate prevents an exact instance count or
 * random probability from looking like a botanical claim.
 */
export const LYNWOOD_RENDER_PRIORS = Object.freeze({
  liveCaneCacheSize: 52,
  foliageStartFractionByOrder: Object.freeze([0, 0.12, 0]),
  foliageNodeOccupancyByOrder: Object.freeze([0.65, 0.82, 0.58]),
  // Weights over the sourced 1-6 flowers a leaf-scar carries, by branch order.
  //
  // Reweighted toward the top of that range after a photo pass: on a plant in
  // full bloom the wood is very nearly hidden, every scar along the whole
  // length of a cane is carrying flowers, and clusters of one or two are the
  // exception rather than the middle of the distribution. The previous weights
  // centred on three, which is what left the earlier renders reading as dotted
  // whips rather than the yellow ropes the references show. The range itself
  // is unchanged -- it is the sourced one -- and six is still uncommon.
  clusterSizeWeightsByOrder: Object.freeze([
    Object.freeze([0.02, 0.11, 0.24, 0.31, 0.22, 0.1]),
    Object.freeze([0.01, 0.07, 0.19, 0.31, 0.26, 0.16]),
    Object.freeze([0.01, 0.05, 0.15, 0.29, 0.29, 0.21]),
  ]),
  anthesisOffsetDays: Object.freeze([-2, 8]),
  corollaOpeningDays: 1.5,
  individualFlowerDisplayDays: Object.freeze([12, 15]),
  corollaFadeDays: 3,
  leafBreakOffsetDays: Object.freeze([-2, 5]),
  leafExpansionDurationDays: Object.freeze([29, 39]),
  // New lateral and short-shoot modules belong to the leafy growing season;
  // letting them appear during bare-wood bloom adds biologically impossible
  // empty twigs precisely when the cultivar should read as a yellow fountain.
  shootEmergenceDayRange: Object.freeze([102, 145]),
  // Typical snapshots fit at full detail. Denser ones use
  // deterministic whole-organ thinning to stay inside these bounded pools;
  // the evaluator still reports the unthinned biological counts separately.
  instanceCapacities: Object.freeze({
    leaves: 6500,
    // One pool now holds both the dormant leaf buds -- two to a node, on every
    // node -- and the flower buds swelling on top of them, so it is sized as
    // the sum of the two pools that can feed it. That is a real bound rather
    // than a measured high-water mark: the leaf and flower strides hold their
    // own writes inside their own capacities, so their sum holds this one.
    buds: 19_500,
    flowers: 13_000,
    capsules: 256,
  }),
});

/**
 * Primary evidence behind the 'Lynwood Variety' defaults. RHS supplies the
 * garden-managed size envelope and the pruning regime; the botanical monograph
 * and the Polish floras supply organ morphology and the central-Poland season.
 */
export const LYNWOOD_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title:
      "Forsythia × intermedia 'Lynwood Variety', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/214902/forsythia-intermedia-lynwood-variety/details',
    supports:
      'Garden-managed ultimate size of 1.5-2.5 m high by 1.5-2.5 m wide reached in 5-10 years, bushy upright habit, hardiness H5 and pruning group 2.',
  }),
  rhsPruning: Object.freeze({
    title: 'Pruning early-flowering shrubs, Royal Horticultural Society',
    url: 'https://www.rhs.org.uk/plants/types/shrubs/pruning-early-flowering',
    supports:
      'Pruning group 2: prune immediately after flowering, cut flowered growth back to vigorous lower shoots and remove up to one fifth of the oldest stems at the base.',
  }),
  treesAndShrubsOnline: Object.freeze({
    title: 'Forsythia × intermedia, Trees and Shrubs Online (Bean, revised)',
    url: 'https://www.treesandshrubsonline.org/articles/forsythia/forsythia-x-intermedia/',
    supports:
      "Erect-to-arching habit, leaves ovate to broad-lanceolate 4-10 x 2-5 cm, corolla to 4 cm wide with oblong often revolute and twisted lobes, 1-6 flowers per leaf-scar, and 'Lynwood Variety' as a 1946 bud-sport of 'Spectabilis' with broader, less curled, lighter yellow lobes.",
  }),
  ncStateToolbox: Object.freeze({
    title: 'Forsythia × intermedia, NC State Extension Gardener Plant Toolbox',
    url: 'https://plants.ces.ncsu.edu/plants/forsythia-x-intermedia/',
    supports:
      'Opposite lanceolate leaves toothed on the upper half, rapid growth, multi-stemmed arching fountain-like form, flowers borne on one- to two-year-old wood, brown four-ridged lenticel-dotted stems with chambered or hollow pith, and a non-ornamental 2-celled dehiscent capsule about 6 mm long.',
  }),
  atlasRoslin: Object.freeze({
    title: 'Forsythia ×intermedia (forsycja pośrednia), Atlas Roślin',
    url: 'https://www.atlas-roslin.pl/gatunki/Forsythia_xintermedia.htm',
    supports:
      'Polish field description: shrub to 3 m with ascending shoots drooping at the tips, dark yellow flowers to 35 mm across densely covering the branches, flowering March to April.',
  }),
  polishFlora: Object.freeze({
    title: 'Forsycja pośrednia, Wikipedia (polska)',
    url: 'https://pl.wikipedia.org/wiki/Forsycja_po%C5%9Brednia',
    supports:
      "Central-European garden description: dense wide shrub to 3 m with upright and partly drooping shoots, chambered pith, opposite ovate-oblong dark green leaves serrate above, four-lobed funnel-shaped flowers opening before the leaves in March-April, capsule fruit, and 'Lynwood' as a dark-yellow cultivar on notably stiff upright shoots.",
  }),
  polishSeason: Object.freeze({
    title: 'Forsycja pośrednia — termin kwitnienia w Polsce, ExoticFactory',
    url: 'https://www.exoticfactory.pl/forsycja-posrednia-forsythia-intermedia-jak-uprawiac-kiedy-ciac-i-jak-uzyskac-spektakularne-kwitnienie-n-116.html',
    supports:
      'Peak flowering of most Forsythia × intermedia cultivars at the turn of March and April in central Poland, with the north-east (Mazury, Podlasie, Suwalszczyzna) running 10-14 days later.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports:
      'General BBCH stage codes for woody ornamentals used by the calendar.',
  }),
});

/**
 * Cultivar profile for a maintained garden-grown Forsythia x intermedia
 * 'Lynwood Variety' (sold in Poland and the UK as 'Lynwood Gold').
 *
 * The geometry values are renderer-friendly biological priors, not claims of
 * millimetre-accurate prediction. Like the blackcurrant stool, this plant is a
 * multi-cane shrub with no tree-like trunk, but two facts drive the whole
 * model and separate it from a currant:
 *
 *   1. Flowers open on one- and two-year-old wood BEFORE any leaf expands.
 *   2. Leaves are opposite and decussate, not alternate.
 */
export const LYNWOOD_PROFILE = Object.freeze({
  species: 'Forsythia × intermedia',
  cultivar: 'Lynwood',
  cultivarFullName: 'Lynwood Variety',
  synonyms: Object.freeze(['Lynwood Gold']),
  commonName: 'Border forsythia',
  commonNamePl: 'Forsycja pośrednia',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'upright-arching multi-cane shrub with stiff erect shoots',
    hasTrunk: false,
    crownOrigin: 'ground-level stool',
    // RHS gives 1.5-2.5 m in both axes for a garden-managed plant; the Polish
    // floras allow 3 m unmanaged. The maintained default sits mid-RHS.
    matureHeightM: 2.15,
    matureRadiusM: 1.02,
    rhsUltimateHeightRangeM: Object.freeze([1.5, 2.5]),
    rhsUltimateSpreadRangeM: Object.freeze([1.5, 2.5]),
    rhsYearsToUltimateHeight: Object.freeze([5, 10]),
    unmanagedHeightM: 3,
    // No cited source gives a stem count for forsythia the way RHS does for
    // blackcurrant. This is a renderer prior for a vigorous, rapidly growing
    // 2 m shrub under annual post-flowering renewal, not a published figure.
    maintainedCaneRange: Object.freeze([10, 15]),
    // Establish from a small first-year stool, then add two basal shoots each
    // leafy season. Starting with a synchronized mature stand makes year six
    // unnaturally skeletal and all founding canes senesce together.
    initialCaneCount: 4,
    renewalStartsAfterYear: 0,
    annualRenewalShootCount: 2,
    // Individual canes may persist long after their best flowering
    // years, but the stool itself is continuous: it is not replanted or reset.
    naturalCaneLifeYears: 20,
    modelHorizonYears: 50,
    // 'Lynwood' is a stiff, upright sport; the arch is real but shallower than
    // F. suspensa. This is the fraction of cane height expressed as outward
    // reach at the tip.
    // The cane is grown through EZ-Tree's force model rather than a fitted
    // curve, so the habit is described by how hard the shoot is pulled over
    // and how much longer its arc is than its finished height.
    caneArcLengthFactor: 1.05,
    caneForceStrength: 0.00016,
    caneReferenceSections: 36,
    archDrop: 0.32,
    caneGnarliness: 0.012,
    // A Lynwood crown mixes stiff central shoots with a smaller arching outer
    // layer. Pulling every cane outward by the same amount creates an empty V.
    uprightCaneFraction: 0.5,
    uprightArchMultiplier: Object.freeze([0.18, 0.4]),
    outerArchMultiplier: Object.freeze([0.68, 1.08]),
    calibratedRadiusFactor: Object.freeze([0.94, 1.1]),
    tipLayering: true,
  }),
  growth: Object.freeze({
    rate: 'rapid',
    // Renderer interpolation for one cane, anchored so a maintained plant is
    // near full height inside the RHS 5-10 year window.
    caneAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.14]),
      Object.freeze([0.5, 0.4]),
      Object.freeze([1, 0.52]),
      Object.freeze([2, 0.71]),
      Object.freeze([3, 0.85]),
      Object.freeze([4, 0.94]),
      Object.freeze([5, 1]),
    ]),
    annualShootExtensionM: Object.freeze([0.3, 0.6]),
    // Basal renewal shoots break after the flowering flush, once the plant is
    // in leaf. This is an explicit animation assumption: the cited sources
    // describe rapid growth but not daily shoot-emergence dates.
    renewalEmergenceDayRange: Object.freeze([105, 135]),
  }),
  cane: Object.freeze({
    // Stems stay floriferous for a few years, then RHS renewal takes them out.
    productiveLifeYears: 5,
    targetHeightM: Object.freeze([1.75, 2.45]),
    baseRadiusM: Object.freeze([0.007, 0.016]),
    crownRadiusM: 0.13,
    // Nodes every 5-7 cm along a 2 m cane. At 10 cm spacing the shoots read
    // as bare whips with flowers dotted along them, not the dense fountain a
    // forsythia in bloom actually is.
    mainAxisNodeCount: Object.freeze([34, 42]),
    // Each shoot module forms within one growing season. These fractions map
    // nodes into that season and must not be stretched over the cane's whole
    // productive life, which would create travelling flower bands.
    mainAxisGrowthDurationYears: 0.82,
    lateralAxisGrowthDurationYears: 0.58,
    twigGrowthDurationYears: 0.42,
    // Densely branched: an established cane pushes new laterals every season,
    // and it is that annual supply of one-year wood that keeps a mature shrub
    // flowering harder than a young one.
    lateralAxisCount: Object.freeze([15, 20]),
    lateralNodeCount: Object.freeze([7, 10]),
    annualShortShootCountPerLateral: Object.freeze([1, 2]),
    shortShootNodeCount: Object.freeze([4, 6]),
    shortShootLengthM: Object.freeze([0.14, 0.26]),
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.28,
      higherOrder: 0.16,
    }),
    childParentRadiusRatio: 0.55,
    axisTaperRatios: Object.freeze([1, 0.84, 0.52, 0.18]),
    wholeCanePruning: true,
    pruningHeightM: 0.03,
    barkDescription: 'brown, four-ridged, heavily dotted with lenticels',
    pith: 'chambered (lamellate), sometimes hollow',
  }),
  leaf: Object.freeze({
    // The single most important structural difference from the blackcurrant.
    arrangement: 'opposite-decussate',
    leavesPerNode: 2,
    decussateTurnRadians: Math.PI / 2,
    lengthM: Object.freeze([0.04, 0.1]),
    widthM: Object.freeze([0.02, 0.05]),
    petioleLengthM: Object.freeze([0.006, 0.016]),
    shape: 'ovate to broad-lanceolate',
    serrated: true,
    serrationNote: 'toothed on the upper half, entire toward the base',
    occasionallyTrifoliate: true,
    autumnColours: Object.freeze(['gold', 'yellow-green', 'purple-bronze']),
  }),
  flower: Object.freeze({
    // Borne on one- and two-year-old wood, opening before leaf expansion.
    bornOnWoodAgeYears: Object.freeze([1, 2]),
    precedesLeaves: true,
    // Per leaf-scar, as Bean states it. An opposite-leaved node has two, so a
    // node carries up to twelve flowers -- which is what the shrub-scale
    // photographs show and what the earlier per-node reading lost.
    perScarRange: Object.freeze([1, 6]),
    // Lower axils on vigorous long shoots are commonly vegetative. Short side
    // shoots carry the densest display, so eligibility rises with branch order.
    // Raised after a photo pass against shrub-scale references: a cane in full
    // bloom flowers along essentially its whole length, with only the shaded
    // base of a vigorous basal shoot staying vegetative.
    floweringStartFractionByOrder: Object.freeze([0.18, 0.05, 0.02]),
    floweringNodeOccupancyByOrder: Object.freeze([0.94, 0.98, 0.99]),
    corollaLobes: 4,
    corollaWidthM: Object.freeze([0.033, 0.04]),
    corollaTubeLengthM: Object.freeze([0.008, 0.013]),
    lobeShape: 'oblong, often revolute and twisted',
    pedicelLengthM: Object.freeze([0.003, 0.009]),
    colour: 'bright yellow, lighter and less brassy than Spectabilis',
    scented: false,
    // 'Lynwood' is a thrum-eyed (short-styled) clone, so a solitary plant sets
    // almost no seed. This is why the capsule load below is deliberately tiny.
    styleMorph: 'thrum',
    selfFertile: false,
  }),
  capsule: Object.freeze({
    type: '2-celled dehiscent capsule',
    lengthM: Object.freeze([0.005, 0.008]),
    ornamental: false,
    // Pods on an isolated thrum clone are typically empty; only a small
    // fraction of pollinated nodes carry a visible capsule at all.
    setFraction: 0.025,
    note: 'Capsules are modeled as a sparse, non-ornamental presence so the summer canopy is botanically complete without implying a crop.',
  }),
  management: Object.freeze({
    dormantPlantingMonths: Object.freeze([10, 11, 12, 1, 2, 3]),
    // RHS pruning group 2: the cut follows flowering, it does not wait for
    // dormancy the way blackcurrant renewal does.
    pruningWindow: 'immediately after flowering',
    automaticRenewalDelayDays: 1,
    renewalPruningMinimumAgeYears: 3,
    oldestCaneRemovalFraction: 1 / 5,
    pruningMethod:
      'cut flowered growth back to vigorous lower shoots and remove up to one fifth of the oldest stems at the base',
    latestSafePruningDay: 196,
    latestSafePruningNote:
      'Pruning after mid-July removes the wood that carries next spring flower buds.',
  }),
});
