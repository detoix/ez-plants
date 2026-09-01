/**
 * Published evidence and inspected-photograph observations behind 'Magnus'.
 * One scene unit is one metre.
 */
export const MAGNUS_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Echinacea purpurea 'Magnus', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/97560/echinacea-purpurea-magnus/details',
    supports:
      'Vigorous clump-forming herbaceous perennial about 1 m tall, reaching ultimate size in 2-5 years; narrowly oval rich-green leaves; 10 cm heads with broad overlapping deep reddish-pink horizontal rays around an orange-brown cone; midsummer-to-autumn flowering; optional retained winter seed heads.',
  }),
  polishNurseryAssociation: Object.freeze({
    title:
      "Echinacea purpurea 'Magnus', Polish Nurserymen Association catalogue",
    url: 'https://e-katalogroslin.pl/pdf/2315%2Cjezowka-purpurowa-magnus_echinacea-purpurea-magnus',
    supports:
      'Polish cultivar record for an upright hardy perennial with flower heads larger than the species, a prickly brown pointed centre and the established Polish common name jeżówka purpurowa.',
  }),
  jelittoCultivar: Object.freeze({
    title: "Echinacea purpurea 'Magnus', Jelitto Perennial Seeds",
    url: 'https://www.jelitto.com/Jelitto%2BPerennial%2BSeeds/Breeding/Jelitto%2Bs%2BCultivars%2BNew%2BIntroduction/ECHINACEA%2Bpurpurea%2BMagnus%2BPortion%2Bs.html',
    supports:
      "The cultivar's rose-purple rays are more horizontal than ordinary seed strains; approximate production rises from 2-3 flowers in the first year to 6-8 in the second and up to 15 in the third; introduced in 1985 after Magnus B. Nilsson's selection work.",
  }),
  floraNorthAmerica: Object.freeze({
    title: 'Echinacea purpurea, Flora of North America',
    url: 'https://efloras.org/florataxon.aspx?flora_id=1&taxon_id=220004561',
    supports:
      'Alternate rough leaves, lower blades ovate to lanceolate and toothed, progressively smaller upper leaves, and 12-20(-30) pink-purple ray florets around a convex-to-conic disc.',
  }),
  ncStateExtension: Object.freeze({
    title: 'Echinacea purpurea, NC State Extension Plant Toolbox',
    url: 'https://plants.ces.ncsu.edu/plants/echinacea-purpurea/',
    supports:
      'Erect clump-forming rhizomatous habit, sturdy flowering stems, and rough alternate leaves about 3-8 inches long and 1-3 inches wide, with upper cauline blades reduced in size.',
  }),
  cultivarPhotographs: Object.freeze({
    title: 'Live-cultivar photographic observations made during modelling',
    supports:
      'Exact-cultivar photographs show a compact leafy lower clump, exposed pubescent upper stems, a loose upward-facing head plateau, mixed buds/open/spent heads, broad rays that overlap while remaining individually irregular, copper-orange active cones and dark prickly seed heads. These observations informed silhouette and colour but the moving image URLs are deliberately not retained as model provenance.',
  }),
});

/** Cultivar profile for one maintained plant in a central-Polish garden. */
export const MAGNUS_PROFILE = Object.freeze({
  species: 'Echinacea purpurea',
  cultivar: 'Magnus',
  commonName: 'purple coneflower',
  commonNamePl: 'Jeżówka purpurowa',
  breeder: 'Magnus B. Nilsson',
  introductionYear: 1985,
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: 1,
  architecture: Object.freeze({
    habit:
      'upright clump of independent leafy herbaceous stems from a compact basal crown',
    hasTrunk: false,
    woody: false,
    deciduous: true,
    crownOrigin: 'persistent rhizomatous basal crown',
    matureHeightM: 0.95,
    // Photo-matched renderer target. Seeded blades and lateral heads vary the
    // measured mature diameter around 0.56 m; the RHS category is retained
    // below as source evidence rather than treated as a hard stochastic cap.
    matureRadiusM: 0.28,
    matureCrownRadiusM: 0.082,
    rhsUltimateHeightRangeM: Object.freeze([0.5, 1]),
    rhsUltimateSpreadRangeM: Object.freeze([0.1, 0.5]),
    rhsYearsToUltimateHeight: Object.freeze([2, 5]),
    modelHorizonYears: 20,
    maximumPrimaryShoots: 12,
    maximumFloweringAxes: 15,
    shootCountAnchors: Object.freeze([
      Object.freeze([0, 3]),
      Object.freeze([1, 7]),
      Object.freeze([2, 12]),
      Object.freeze([3, 12]),
    ]),
    crownRadiusAnchorsM: Object.freeze([
      Object.freeze([0, 0.028]),
      Object.freeze([1, 0.052]),
      Object.freeze([2, 0.071]),
      Object.freeze([3, 0.08]),
      Object.freeze([5, 0.082]),
    ]),
  }),
  growth: Object.freeze({
    rate: 'moderate; ultimate size in 2-5 years',
    plantAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.58]),
      Object.freeze([1, 0.78]),
      Object.freeze([2, 0.92]),
      Object.freeze([3, 1]),
    ]),
    observedFlowerCountAnchors: Object.freeze([
      Object.freeze([0, 3]),
      Object.freeze([1, 7]),
      Object.freeze([2, 15]),
    ]),
    topGrowthAnnual: true,
  }),
  stem: Object.freeze({
    kind: 'annual herbaceous flowering stem',
    targetHeightM: Object.freeze([0.72, 0.92]),
    baseRadiusM: Object.freeze([0.0035, 0.0055]),
    mainAxisSections: 8,
    lateralAxisSections: 4,
    upperBranchFraction: 0.25,
    habit:
      'sturdy and mostly vertical, with slight basal divergence and occasional single upper forks',
    surface: 'rough and finely pubescent green, sometimes purple-flushed',
  }),
  leaf: Object.freeze({
    arrangement: 'alternate, with the visual mass concentrated low on stems',
    shape:
      'rough ovate-to-lanceolate blade, coarsely toothed, pointed, with strong basal veins',
    texture: 'matte, scabrid and slightly corrugated',
    lowerLengthM: Object.freeze([0.13, 0.195]),
    lowerWidthM: Object.freeze([0.052, 0.078]),
    upperLengthM: Object.freeze([0.08, 0.15]),
    upperWidthM: Object.freeze([0.03, 0.06]),
    leavesPerPrimaryStem: 9,
    autumnColours: Object.freeze(['yellow green', 'ochre', 'dry brown']),
    persistentThroughWinter: false,
  }),
  flowerHead: Object.freeze({
    position: 'terminal, mostly upward-facing on exposed upper peduncles',
    diameterM: Object.freeze([0.09, 0.11]),
    rayCount: Object.freeze([18, 22]),
    rayColour: 'deep rose-purple to reddish pink',
    rayPosture:
      'broad and overlapping, held nearly horizontal rather than strongly reflexed',
    coneBaseDiameterM: Object.freeze([0.028, 0.037]),
    coneHeightM: Object.freeze([0.018, 0.027]),
    coneColour: 'copper-orange opening rings over a dark bronze-brown base',
    progression:
      'tight green bud to broad pink head, faded rays, then a dark prickly seed head',
  }),
  flowering: Object.freeze({
    observedDisplay: 'July to September in Poland',
    longSeason: true,
    stemsFlowerInCurrentSeason: true,
    definingCultivarTrait:
      'large broad overlapping rays held almost horizontally',
  }),
  management: Object.freeze({
    maintained: true,
    standsThroughWinter: true,
    cutbackWindow: 'late winter to early spring before new growth',
    cutbackHeightM: 0.04,
    deadheading:
      'optional during flowering; the model retains a mixed display and keeps late heads for winter interest',
    divisionIntervalYears: Object.freeze([4, 6]),
  }),
});
