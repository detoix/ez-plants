/**
 * Real-world units used by the Hameln model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/** Published evidence and photographic observations behind the defaults. */
export const HAMELN_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Pennisetum alopecuroides 'Hameln', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/43921/pennisetum-alopecuroides-hameln/details',
    supports:
      'Accepted tufted cultivar, ultimate height and spread 0.5-1 m, reaching full size in 2-5 years; narrow flowering panicles with conspicuous bristles.',
  }),
  polishNurseryAssociation: Object.freeze({
    title:
      "Pennisetum alopecuroides 'Hameln', Polish Nurserymen Association catalogue",
    url: 'https://e-katalogroslin.pl/plants/4229,rozplenica-japonska-hameln_pennisetum-alopecuroides-hameln/',
    supports:
      'Compact old cultivar introduced by Junge in Germany in 1964. Foliage clump 0.5-0.75 m, 0.75-1 m in flower; leaves to 7 mm wide; flowers from late July, initially greenish-white, then pinkish and grey-brown; foliage turns orange-russet; dead growth is cut in early spring.',
  }),
  ifasCultivar: Object.freeze({
    title: "Pennisetum alopecuroides 'Hameln' dwarf fountain grass, UF/IFAS",
    url: 'https://ask.ifas.ufl.edu/publication/FP461',
    supports:
      'Warm-season deciduous clump with arching foliage and white bottlebrush inflorescences 5-7 inches long, persisting from summer into fall before shattering in early winter; green foliage turns golden brown.',
  }),
  missouriExtension: Object.freeze({
    title: 'Ornamental grasses, University of Missouri Extension',
    url: 'https://extension.missouri.edu/publications/g6661',
    supports:
      "'Hameln' reaches 24-36 inches and flowers profusely. Fountain grass has narrow green leaves, a graceful arching habit and 5-7 inch bottlebrush spikes in mid to late summer.",
  }),
  cultivarPhotographs: Object.freeze({
    title: 'Mature-cultivar photographic observations',
    supports:
      'Mature plants form dense, regular hemispherical fountains. Most blades arise visually from the crown and bow outward; dozens of slim, cylindrical cream-to-tan brushes sit just above and around the foliage dome on lightly arched peduncles. Heads are closed cylinders, not open fans.',
  }),
  seasonalPhotographs: Object.freeze({
    title: 'Summer, autumn and winter photographic observations',
    supports:
      'New heads are pale green to creamy white with a muted pink cast, mature to beige-grey, and thin during winter. Foliage remains deep green through flowering, then changes blade by blade through yellow-orange to straw; the dry fountain commonly stands until its spring cut.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports:
      'Cereal growth-stage codes used to label emergence, tillering, stem elongation, booting, heading, flowering, ripening and senescence.',
  }),
});

/** Cultivar profile for a maintained plant in central Poland. */
export const HAMELN_PROFILE = Object.freeze({
  species: 'Pennisetum alopecuroides',
  acceptedSpecies: 'Cenchrus alopecuroides',
  cultivar: 'Hameln',
  commonName: 'dwarf fountain grass',
  commonNamePl: 'Rozplenica japońska',
  introducer: 'Junge, Germany',
  introductionYear: 1964,
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'compact dense hemispherical clump of narrow arching blades',
    hasTrunk: false,
    woody: false,
    crownOrigin: 'persistent basal crown of short, non-running rhizomes',
    matureHeightM: 0.86,
    matureFoliageHeightM: 0.61,
    matureRadiusM: 0.43,
    matureCrownRadiusM: 0.14,
    rhsUltimateHeightRangeM: Object.freeze([0.5, 1]),
    rhsUltimateSpreadRangeM: Object.freeze([0.5, 1]),
    rhsYearsToUltimateHeight: Object.freeze([2, 5]),
    rhsHardiness: 'H5',
    observedPolishFoliageHeightRangeM: Object.freeze([0.5, 0.75]),
    observedPolishFloweringHeightRangeM: Object.freeze([0.75, 1]),
    crownRadiusAnchorsM: Object.freeze([
      Object.freeze([0, 0.025]),
      Object.freeze([1, 0.045]),
      Object.freeze([2, 0.072]),
      Object.freeze([3, 0.098]),
      Object.freeze([5, 0.123]),
      Object.freeze([8, 0.135]),
      Object.freeze([12, 0.14]),
    ]),
    initialTillerCount: 8,
    maximumTillerCount: 140,
    renderedTillersAreRepresentative: true,
    centreDieOutStartAgeYears: 10,
    centreDieOutFullAgeYears: 18,
    maximumCentreDieOutFraction: 0.34,
    modelHorizonYears: 20,
  }),
  growth: Object.freeze({
    photosynthesis: 'C4 warm-season',
    rate: 'moderate',
    plantAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.38]),
      Object.freeze([1, 0.62]),
      Object.freeze([2, 0.82]),
      Object.freeze([3, 0.93]),
      Object.freeze([5, 1]),
    ]),
    floweringTillerFraction: Object.freeze([0.64, 0.86]),
    firstFloweringAgeYears: 1,
  }),
  cane: Object.freeze({
    kind: 'culm',
    targetHeightM: Object.freeze([0.4, 0.6]),
    floweringExtensionM: Object.freeze([0.09, 0.2]),
    vegetativeHeightFactor: Object.freeze([0.72, 0.98]),
    baseRadiusM: Object.freeze([0.0012, 0.0021]),
    crownRadiusM: 0.14,
    mainAxisNodeCount: Object.freeze([7, 10]),
    lateralAxisCount: Object.freeze([0, 0]),
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.5,
      higherOrder: 0.32,
    }),
    childParentRadiusRatio: 0.6,
    axisTaperRatios: Object.freeze([1, 0.94, 0.82, 0.5]),
    wholeCanePruning: true,
    barkDescription:
      'fine smooth green culms, largely hidden by basal leaf sheaths, drying buff in winter',
  }),
  leaf: Object.freeze({
    arrangement: 'primarily basal, with sparse alternate sheathing leaves',
    leavesPerNode: 1,
    shape: 'narrow linear, fine-textured, upright then arching near the tip',
    lengthM: Object.freeze([0.34, 0.46]),
    widthM: Object.freeze([0.003, 0.007]),
    midrib: 'subtle, not a contrasting white stripe',
    texture: 'fine, flat and long-tapering',
    lengthProfilePeak: 0.18,
    autumnColours: Object.freeze(['golden yellow', 'orange-russet', 'tan']),
    persistentThroughWinter: true,
  }),
  panicle: Object.freeze({
    position: 'terminal on flowering culms, held just above the foliage',
    form: 'dense narrow cylindrical bottlebrush spike',
    lengthM: Object.freeze([0.12, 0.17]),
    widthM: Object.freeze([0.028, 0.04]),
    bristleLengthM: Object.freeze([0.018, 0.03]),
    cardCount: Object.freeze([8, 12]),
    colourSequence: Object.freeze([
      'greenish cream',
      'pinkish cream',
      'warm beige',
      'grey brown',
      'weathered straw',
    ]),
    renderedBristlesAreRepresentative: true,
    note: 'A crossed alpha-textured cylinder represents the dense bristled spike; individual sub-pixel spikelets are not geometry.',
  }),
  flowering: Object.freeze({
    wood: 'current-season culms only',
    terminal: true,
    observedDisplay: 'late July to September in Poland',
    persistence: 'ornamental into autumn; heads thin and shatter in winter',
    earlyForTheSpecies: true,
  }),
  management: Object.freeze({
    cuttingWindow: 'early spring, before or just as new blades emerge',
    cutbackDayRange: Object.freeze([72, 102]),
    cutbackHeightM: 0.08,
    stubblePersistsUntilCanopyCloses: true,
    divisionIntervalYears: Object.freeze([4, 6]),
    standsThroughWinter: true,
    winterInterestNote:
      'The dry foliage and remaining bottlebrush heads are left through winter and cut before spring growth.',
  }),
});
