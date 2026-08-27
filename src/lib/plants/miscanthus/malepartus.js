/**
 * Real-world units used by the Malepartus model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/**
 * Evidence behind the cultivar defaults. Published measurements are kept
 * separate from renderer priors so visual tuning cannot silently turn into a
 * botanical claim.
 */
export const MALEPARTUS_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Miscanthus sinensis 'Malepartus', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/76523/miscanthus-sinensis-malepartus/details',
    supports:
      'A vigorous, free-flowering deciduous grass to 2 m with arching white-midribbed leaves and pink-tinged panicles maturing to silver in late summer. Ultimate height 1.5-2.5 m, ultimate spread 1-1.5 m, reached in 2-5 years. Bushy habit, full sun, hardiness H6, holder of the Award of Garden Merit.',
  }),
  ncsuSpecies: Object.freeze({
    title: 'Miscanthus sinensis, NC State Extension Plant Toolbox',
    url: 'https://plants.ces.ncsu.edu/plants/miscanthus-sinensis/',
    supports:
      'Clumping habit with arching, cascading and erect form; cane-like erect stems bearing leaves that reduce in size upwards and terminate in an inflorescence; terminal panicle of finger-like racemes to about 20 cm; flat linear arching blades; autumn colour gold, orange and red-burgundy; cut back in late winter or early spring, before or just as new blades begin to appear.',
  }),
  diggingDog: Object.freeze({
    title: "Miscanthus sinensis 'Malepartus', Digging Dog Nursery",
    url: 'https://www.diggingdog.com/plant/G-0515',
    supports:
      'Ernst Pagels selection. Blooms mid-August to November, early for the genus. Large crimped plumes open lustrous coppery-purple and lighten to silver on thick wine-tinged stems; rounded clump of broad lax rich-green blades with ash-striped midribs; autumn foliage bronze, red and orange fading to warm ivory in winter; about 1.5-2.1 m high by 0.9-1.2 m wide.',
  }),
  polishGuide: Object.freeze({
    title: 'Miskant - gatunki i odmiany, uprawa, przycinanie, rozmnazanie',
    url: 'https://poradnikogrodniczy.pl/miskant-gatunki-i-odmiany-uprawa-przycinanie-rozmnazanie.php',
    supports:
      "Polish cultivation guidance: last season's Miscanthus culms are cut in early spring to about 10 cm above the ground; the genus overwinters in Poland without protection at hardiness zone 6; clumps are lifted and divided from three to four years old; 'Malepartus' reaches 2 m in flower with intensely red inflorescences over copper-toned foliage.",
  }),
  divisionPractice: Object.freeze({
    title: 'Maiden grass (Miscanthus) growing guide, Gardening Know How',
    url: 'https://www.gardeningknowhow.com/ornamental/foliage/maiden-grass/growing-maiden-grass.htm',
    supports:
      'Established Miscanthus sinensis clumps tend to die out in the centre, leaving a ring of vigorous outer tillers; the standard remedy is lifting and dividing every three to five years, ideally as soon as the centre starts to open.',
  }),
  cultivarBlade: Object.freeze({
    title: 'Cultivar blade observations',
    supports:
      'Looking at the real cultivar: a crisp near-white midrib running the full length of every blade, a cool faintly glaucous grey-green lamina rather than a yellow-green one, fine longitudinal ribs either side of the midrib, and long blades arching well past the horizontal. Used to calibrate blade colour and the midrib contrast.',
  }),
  inflorescenceForm: Object.freeze({
    title: 'September inflorescence observations',
    supports:
      'A September head shortly after emergence: the racemes are thrown out almost to the horizontal in an open, airy whisk with visible gaps between them, wine-purple before the hairs elongate, on long bare peduncles held well clear of the foliage. Used to calibrate the raceme spread angle and the head\u2019s width-to-length ratio.',
  }),
  seasonalObservations: Object.freeze({
    title: 'Dated seasonal observations, same hardiness zone',
    supports:
      'Late April: clumps still entirely bleached with no green at the crown, confirming how late a C4 grass starts. Mid-June: the new growth is a narrow erect tuft rather than a small copy of the September fountain. 18 July, Karlsruhe: foliage at roughly 1.35 m with no inflorescences yet, culms still green inside their leaf sheaths. 17 October: still fully green. 31 October, Lyon: green and bleached blades side by side. 24 November: foliage already fully bleached to a cool grey-straw with no copper remaining, which moved the modelled autumn-to-straw transition about three weeks earlier and away from a warm tan, and is why the foliage bleaches blade by blade on individually shifted windows rather than passing through a whole-plant copper stage.',
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports:
      'Cereal (monocotyledon) growth-stage codes - emergence, tillering, stem elongation, booting, heading, flowering, ripening and senescence - used to label the modeled calendar of a grass rather than the woody-plant codes used by this library’s shrubs.',
  }),
});

/**
 * Cultivar profile for a garden-grown Miscanthus sinensis 'Malepartus' in
 * central Poland.
 *
 * Unlike every other plant in this library, Malepartus has no persistent
 * woody framework at all. It is a caespitose warm-season (C4) grass: the
 * crown persists and widens, while every culm above it is built and lost in
 * one season. The `age` slider therefore drives clump width and tiller
 * count, and the `day of year` slider drives one complete build-and-collapse
 * cycle of the visible plant.
 */
export const MALEPARTUS_PROFILE = Object.freeze({
  species: 'Miscanthus sinensis',
  cultivar: 'Malepartus',
  commonName: 'Chinese silver grass',
  commonNamePl: 'Miskant chinski',
  breeder: 'Ernst Pagels',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'dense caespitose clump of erect culms with broad arching blades',
    hasTrunk: false,
    woody: false,
    crownOrigin: 'persistent basal crown of short, non-running rhizomes',
    // Renderer and camera-framing priors inside the RHS 1.5-2.5 m envelope.
    // The cited measurements stay separate below: RHS describes the plant as
    // "to 2 m", Digging Dog measured 1.5-2.1 m by 0.9-1.2 m.
    matureHeightM: 1.95,
    matureFoliageHeightM: 1.42,
    // Whole-plant radius including the arching foliage, which is what the
    // RHS spread describes and what a camera has to frame.
    matureRadiusM: 0.62,
    // Radius of the crown of tillers itself. The blades reach roughly another
    // 0.4 m beyond it, which is what turns a 0.44 m clump of culms into the
    // cited 1.0-1.5 m spread.
    matureCrownRadiusM: 0.18,
    rhsUltimateHeightRangeM: Object.freeze([1.5, 2.5]),
    rhsUltimateSpreadRangeM: Object.freeze([1.0, 1.5]),
    rhsYearsToUltimateHeight: Object.freeze([2, 5]),
    rhsHardiness: 'H6',
    observedNurseryHeightRangeM: Object.freeze([1.5, 2.1]),
    observedNurserySpreadRangeM: Object.freeze([0.9, 1.2]),
    // Half-width of the crown of tillers by whole years. A real mature clump
    // carries several hundred tillers; the renderer draws a bounded
    // representative sample across the same footprint.
    crownRadiusAnchorsM: Object.freeze([
      Object.freeze([0, 0.03]),
      Object.freeze([1, 0.05]),
      Object.freeze([2, 0.075]),
      Object.freeze([3, 0.098]),
      Object.freeze([5, 0.13]),
      Object.freeze([8, 0.155]),
      Object.freeze([12, 0.172]),
      Object.freeze([20, 0.18]),
    ]),
    initialTillerCount: 6,
    maximumTillerCount: 118,
    renderedTillersAreRepresentative: true,
    // Renderer priors: the sources give a division interval and the fact that
    // clumps open out in the middle, not a calibrated die-out curve.
    centreDieOutStartAgeYears: 9,
    centreDieOutFullAgeYears: 18,
    maximumCentreDieOutFraction: 0.4,
    modelHorizonYears: 25,
  }),
  growth: Object.freeze({
    photosynthesis: 'C4 warm-season',
    rate: 'vigorous',
    // Fraction of mature culm height by whole years. Bounded by the RHS
    // 2-5 year time to ultimate height.
    plantAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.44]),
      Object.freeze([1, 0.66]),
      Object.freeze([2, 0.83]),
      Object.freeze([3, 0.93]),
      Object.freeze([5, 1]),
    ]),
    // Fraction of tillers that carry a panicle once the plant is old enough.
    floweringTillerFraction: Object.freeze([0.55, 0.78]),
    firstFloweringAgeYears: 1,
  }),
  /**
   * The base renderer calls a plant's primary axis a "cane"; in a grass that
   * axis is a culm. The key name is kept so the shared axis contract, taper
   * ratios and radius rules apply here unchanged.
   */
  cane: Object.freeze({
    kind: 'culm',
    targetHeightM: Object.freeze([1.16, 1.4]),
    // The panicle is carried clear of the foliage on the top internode.
    floweringExtensionM: Object.freeze([0.27, 0.44]),
    vegetativeHeightFactor: Object.freeze([0.52, 0.78]),
    baseRadiusM: Object.freeze([0.0026, 0.0048]),
    crownRadiusM: 0.18,
    mainAxisNodeCount: Object.freeze([9, 12]),
    lateralAxisCount: Object.freeze([0, 0]),
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.5,
      higherOrder: 0.32,
    }),
    childParentRadiusRatio: 0.6,
    // A culm is a hollow, near-parallel-sided cane that narrows only as it
    // approaches the panicle, quite unlike a tapering woody branch.
    axisTaperRatios: Object.freeze([1, 0.95, 0.86, 0.6]),
    wholeCanePruning: true,
    barkDescription:
      'smooth green culms flushed wine-red at the nodes in late summer, weathering to buff straw and pale grey over winter',
  }),
  leaf: Object.freeze({
    arrangement: 'alternate, two-ranked (distichous), sheathing the culm',
    leavesPerNode: 1,
    shape: 'flat, linear, long-tapering, arching to recurved',
    lengthM: Object.freeze([0.36, 0.7]),
    widthM: Object.freeze([0.011, 0.02]),
    midrib: 'prominent white to ash-silver',
    texture: 'thin, keeled at the base, scabrid margin',
    lengthProfilePeak: 0.32,
    autumnColours: Object.freeze([
      'bronze',
      'orange-red',
      'burgundy',
      'warm ivory',
    ]),
    persistentThroughWinter: true,
  }),
  panicle: Object.freeze({
    position: 'terminal on every flowering culm, one panicle per culm',
    form: 'fan-shaped terminal panicle of finger-like racemes',
    lengthM: Object.freeze([0.2, 0.3]),
    widthM: Object.freeze([0.18, 0.3]),
    observedRacemeLengthM: 0.2,
    racemeCount: Object.freeze([12, 22]),
    spikeletArrangement: 'paired, one sessile and one pedicelled per node',
    hairsAreTheDisplay: true,
    colourSequence: Object.freeze([
      'coppery wine-red',
      'bronze-pink',
      'silver-pink',
      'silver-white',
      'weathered ivory',
    ]),
    renderedHairsAreRepresentative: true,
    note: 'The renderer samples the silky spikelet-hair mass rather than drawing every spikelet in a head.',
  }),
  flowering: Object.freeze({
    wood: 'current-season culms only',
    terminal: true,
    observedDisplay: 'mid-August to November',
    rhsDisplay: 'late summer, pink-tinged heads maturing to silver',
    polishDisplay: 'August to October, intensely red heads over copper foliage',
    earlyForTheGenus: true,
  }),
  management: Object.freeze({
    cuttingWindow:
      'late winter to early spring, before or just as new blades appear',
    cutbackDayRange: Object.freeze([60, 90]),
    cutbackHeightM: 0.1,
    stubblePersistsUntilCanopyCloses: true,
    divisionIntervalYears: Object.freeze([3, 5]),
    divisionMethod:
      'lift the clump in early spring and cut it into vigorous outer sections, discarding a dead centre',
    standsThroughWinter: true,
    winterInterestNote:
      'The dry culms, blades and silvered plumes are the point of the plant from November to March; cutting in autumn removes the whole winter display.',
  }),
});
