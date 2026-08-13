/**
 * Real-world units used by the blackcurrant model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/**
 * Primary evidence behind the Tisel defaults. The Polish trials were performed
 * in central Poland; the RHS source supplies species-level garden dimensions
 * and whole-cane pruning guidance where the cultivar trials do not.
 */
export const TISEL_SOURCES = Object.freeze({
  polishGrowth2023: Object.freeze({
    title:
      'Wzrost i owocowanie wybranych odmian porzeczki czarnej, IO-PIB (2023)',
    url: 'https://zdr.cdr.gov.pl/images/ZDR/2023/ZDR-2023-2-WZROST-I-OWOCOWANIE-WYBRANYCH-ODMIAN-PORZECZKI-CZARNEJ.pdf',
    supports:
      'Central-Poland Tisel shoot vigour (11.2 first-year shoots, 62.1 cm mean shoot length), 6.9 cm racemes and 1.55 kg per bush in the second year after planting.',
  }),
  matureYield2015: Object.freeze({
    title: "'Polares' Black Currant, HortScience 50(10) (2015)",
    url: 'https://journals.ashs.org/downloadpdf/view/journals/hortsci/50/10/article-p1582.pdf',
    supports:
      'Five-season Skierniewice comparison reporting 2.81 kg per Tisel bush and 92.8 g per 100 berries.',
  }),
  polishPomology2026: Object.freeze({
    title:
      'Charakterystyka pomologiczna wybranych odmian porzeczki czarnej, IO-PIB (2026)',
    url: 'https://zdr.cdr.gov.pl/images/ZDR/2026/ZDR-2026-1-CHARAKTERYSTYKA-POMOLOGICZNA-WYBRANYCH-ODMIAN-PORZECZKI-CZARNEJ.pdf',
    supports:
      'Central-Poland 2022-2024 flowering, colouring and harvest ranges, medium Tisel berry mass, and an upright compact mean habit of 1.245 m high by 1.306 m wide in fruiting years.',
  }),
  polishCultivarNursery: Object.freeze({
    title: 'Tisel cultivar profile, M. Bu\u0142a Blackcurrant Nursery',
    url: 'https://bulaporzeczki.pl/pl_pl/oferta/tisel/',
    supports:
      'Cultivar-specific strong growth, upright compact habit with a tendency to become dense and spread, and medium light-green leaves with a pronounced central lobe.',
  }),
  rhsGrowingGuide: Object.freeze({
    title: 'Blackcurrants: grow your own, Royal Horticultural Society',
    url: 'https://www.rhs.org.uk/fruit/blackcurrants/grow-your-own?type=f',
    supports:
      'Approximately 1.5 m garden size, 6-10 stems and winter removal of up to one third of the oldest stems at ground level.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports: 'Phenological stage codes used by the calendar.',
  }),
});

/**
 * Cultivar profile for a maintained garden-grown Ribes nigrum 'Tisel'.
 *
 * The geometry values are renderer-friendly biological priors, not claims of
 * millimetre-accurate prediction. The model intentionally represents a
 * multi-cane stool emerging at crown level: there is no tree-like trunk.
 */
export const TISEL_PROFILE = Object.freeze({
  species: 'Ribes nigrum',
  cultivar: 'Tisel',
  commonName: 'Blackcurrant',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'upright-to-arching multi-cane shrub',
    hasTrunk: false,
    crownOrigin: 'ground-level stool',
    matureHeightM: 1.3,
    matureRadiusM: 0.68,
    observedTrialMeanHeightM: 1.245,
    observedTrialMeanSpreadM: 1.306,
    maintainedCaneRange: Object.freeze([6, 10]),
    initialCaneCount: 9,
    observedHardCutFirstYearShoots: 11.2,
    observedFirstYearShootLengthM: 0.621,
    renewalStartsAfterYear: 2,
    replacementCycleYears: 15,
    modelHorizonYears: 50,
  }),
  growth: Object.freeze({
    // A renderer interpolation constrained by the measured 62.1 cm first-year
    // shoot anchor. These scales describe a cane, not the entire stool.
    caneAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.12]),
      Object.freeze([0.5, 0.46]),
      Object.freeze([1, 0.52]),
      Object.freeze([2, 0.72]),
      Object.freeze([3, 0.86]),
      Object.freeze([4, 0.96]),
      Object.freeze([5, 1]),
    ]),
    // Basal renewal shoots emerge during spring growth, not on 1 January.
    // This is an explicit animation assumption tied to the modeled leaf-
    // emergence period; the cited Tisel trials do not report shoot emergence
    // dates at daily resolution.
    renewalEmergenceDayRange: Object.freeze([80, 105]),
  }),
  cane: Object.freeze({
    productiveLifeYears: 6,
    targetHeightM: Object.freeze([1.05, 1.36]),
    baseRadiusM: Object.freeze([0.007, 0.014]),
    crownRadiusM: 0.09,
    mainAxisNodeCount: Object.freeze([14, 18]),
    lateralAxisCount: Object.freeze([3, 6]),
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.3,
      higherOrder: 0.18,
    }),
    childParentRadiusRatio: 0.52,
    axisTaperRatios: Object.freeze([1, 0.82, 0.48, 0.16]),
    wholeCanePruning: true,
    pruningHeightM: 0.025,
  }),
  leaf: Object.freeze({
    arrangement: 'alternate',
    widthM: Object.freeze([0.06, 0.11]),
    petioleLengthM: Object.freeze([0.025, 0.065]),
    serrated: true,
  }),
  raceme: Object.freeze({
    observedMeanLengthM: 0.069,
    lengthM: Object.freeze([0.05, 0.085]),
    berries: Object.freeze([6, 10]),
    attachment: 'pendant from nodes on young wood',
  }),
  berry: Object.freeze({
    massG: Object.freeze([0.9, 1.08]),
    diameterM: Object.freeze([0.0095, 0.013]),
    retainsCalyx: true,
  }),
  yield: Object.freeze({
    youngSecondYearKg: 1.55,
    matureTrialKg: 2.81,
    renderedFruitIsRepresentative: true,
    note: 'The visible berry instances are a performance sample. Yield is a source-calibrated planning estimate, not a count of rendered spheres or a weather forecast.',
  }),
  management: Object.freeze({
    dormantPlantingMonths: Object.freeze([10, 11, 12, 1, 2, 3]),
    renewalPruningMinimumAgeYears: 4,
    oldestCaneRemovalFraction: 1 / 3,
    pruningMethod: 'remove the oldest complete canes at crown level',
  }),
});
