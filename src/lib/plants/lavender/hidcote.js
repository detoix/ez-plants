/**
 * Real-world units used by the lavender model. One scene unit is one metre.
 */
export const METRES_PER_UNIT = 1;

/**
 * Procedural choices used to make the sourced morphology readable in a
 * real-time renderer. These are calibration priors, not published cultivar
 * measurements; keeping them separate stops an instance count or a random
 * probability from looking like a botanical claim.
 */
export const HIDCOTE_RENDER_PRIORS = Object.freeze({
  /**
   * The framework carries its leafy shoots directly, with no secondary
   * branch order between them.
   *
   * A real subshrub's frame forks two or three times before it reaches a
   * green shoot. Collapsing that into one order is a declared simplification:
   * the intermediate wood is 3-6 cm long, buried inside the mound its own
   * foliage makes, and every one of them would be another axis in a plant
   * that already carries several hundred. What it costs is invisible; what it
   * buys is the triangle budget the flower stems are drawn out of.
   */
  frameworkOrders: 1,
  /** Shoot slots a framework branch owns across a whole replacement cycle. */
  /**
   * Shoot slots a framework branch owns, and how long it takes to fill them.
   *
   * The filling window is the number that matters, and it is short on
   * purpose: RHS puts this cultivar at its ultimate size in two to five
   * years, so a four-year-old plant has to be a closed dome rather than a
   * frame with a third of its shoots on it. After the window the count
   * plateaus and the plant thickens instead, which is what a lavender does
   * until it goes woody and is replaced.
   *
   * The count is also what makes the mound read as *one* thing. Foliage
   * spread over more shoots covers better than the same leaf count bunched
   * onto fewer, because what shows as a gap is the wedge between two shoot
   * tips rather than a thin patch on either of them.
   */
  shootSlotsPerBranch: 17,
  shootFillYears: 4.5,
  /** Leaf-bearing nodes on one green shoot, and leaves seated at each. */
  shootNodeCount: Object.freeze([8, 11]),
  /**
   * Leaves at a node: an opposite pair, plus the axillary fascicle lavender
   * carries in the axil of each. The fascicle is what makes the shoots read
   * as whorled tufts rather than as ladders of paired leaves.
   */
  leavesPerNode: 3,
  /**
   * Nodes near a shoot's base that carry no leaf, as a fraction of it, on a
   * shoot in its first season. It retreats toward the tip as the shoot ages.
   */
  bareShootFraction: 0.1,
  /**
   * Share of eligible shoots that throw a flower stem in a given season.
   *
   * High, and it has to be. A photograph of this cultivar in flower is not a
   * foliage mound with a crown of spikes on it — it is a dense fountain of
   * green stems radiating in every direction, thick enough to hide most of
   * the leaves behind it, with the spikes scattered all through it at every
   * height. Getting that requires most shoots to flower, not half of them.
   * The value is a render prior; no source counts them.
   */
  floweringShootShare: 0.82,
  /** A shoot flowers only once it has a full season behind it. */
  floweringMinimumShootAgeYears: 1,
  /**
   * Winter leaf retention. Lavender is evergreen, but a January mound is
   * visibly thinner and greyer than a July one -- see any photograph of the
   * plant under snow, where the tufts poking out are a fraction of what the
   * summer shoot carried.
   */
  winterLeafRetention: 0.55,
  /** Spike-to-spike stagger, in days, either side of the calendar onset. */
  anthesisOffsetDays: Object.freeze([-6, 9]),
  /** How long one spike takes to run from first colour to fully open. */
  spikeOpeningDays: 12,
  /** How long one spike holds its corollas before it dries. */
  spikeDisplayDays: 26,
  /**
   * Typical snapshots fit at full detail. Denser ones use deterministic
   * whole-organ thinning to stay inside these bounded pools; the evaluator
   * still reports the unthinned biological counts separately.
   */
  instanceCapacities: Object.freeze({
    leaves: 14_000,
    spikes: 700,
  }),
});

/**
 * Primary evidence behind the 'Hidcote' defaults.
 *
 * RHS supplies the garden-managed size envelope, the evergreen habit and the
 * whole pruning regime; the species description supplies organ morphology; the
 * Polish atlas supplies the season this library is set in and the local
 * hardiness caveat. Two dated photographs of identified plants anchor the
 * flowering window at either end of it.
 */
export const HIDCOTE_SOURCES = Object.freeze({
  rhsCultivar: Object.freeze({
    title: "Lavandula angustifolia 'Hidcote', Royal Horticultural Society",
    url: 'https://www.rhs.org.uk/plants/96353/lavandula-angustifolia-hidcote/details',
    supports:
      'Garden-managed ultimate size of 0.1-0.5 m high by 0.5-1 m wide reached in 2-5 years, bushy habit, evergreen foliage, hardiness H5, full sun on well-drained soil, and pruning group 10.',
  }),
  rhsGrowingGuide: Object.freeze({
    title: 'How to grow lavender, Royal Horticultural Society',
    url: 'https://www.rhs.org.uk/plants/lavender/growing-guide',
    supports:
      'Annual trim in late summer just after flowering, removing the spent flower stalks and about 2.5 cm of leaf growth; the rule that lavender does not break from old wood, so cuts never go back into it; replacement of older plants once they go straggly; and planting in April or May rather than in winter.',
  }),
  atlasRoslin: Object.freeze({
    title: 'Lavandula angustifolia (lawenda waskolistna), Atlas Roslin',
    url: 'https://atlas-roslin.pl/gatunki/lawenda.htm',
    supports:
      'Polish cultivation: a 40-60 cm evergreen subshrub flowering from (June) July to August (September), hardy to about USDA 6b with dieback in severe winters, cut back after flowering by a third to a half of its height.',
  }),
  speciesDescription: Object.freeze({
    title: 'Lavandula angustifolia, species description',
    url: 'https://en.wikipedia.org/wiki/Lavandula_angustifolia',
    supports:
      'Evergreen leaves 2-6 cm long and 4-6 mm broad; flowers on spikes 2-8 cm long at the top of slender, leafless stems 10-30 cm long; and the cultivar description of Hidcote as 40-50 cm tall with silver-grey foliage and deep violet-blue inflorescences.',
  }),
  datedObservations: Object.freeze({
    title:
      "Dated photographs of identified Lavandula angustifolia 'Hidcote' plants",
    url: 'https://commons.wikimedia.org/wiki/Category:Lavandula_angustifolia_%27Hidcote%27',
    supports:
      "Vilnius, 8 July 2013: 'Hidcote' at full anthesis. Arboretum in Wojslawice, Poland, 30 July 2020: the same cultivar past its peak, spikes dark and drying, still uncut. Hesse, 6 January 2009: a lavender mound under snow, evergreen and thinned rather than bare. The three bracket the modelled flowering window and the winter state at either end of it.",
  }),
  bbch: Object.freeze({
    title: 'BBCH Monograph, growth stages of mono- and dicotyledonous plants',
    url: 'https://www.masaf.gov.it/flex/AppData/WebLive/Agrometeo/MIEPFY800/BBCHengl2001.pdf',
    supports: 'Phenological stage codes used by the calendar.',
  }),
});

/**
 * Cultivar profile for a maintained garden-grown Lavandula angustifolia
 * 'Hidcote'.
 *
 * The plant this describes is a **subshrub**, and that is the one fact the
 * rest of the file follows from. It is not a small shrub: it holds a low,
 * persistent, gnarled woody frame that never renews from the base, and
 * everything green on it is a shoot that frame put out this year or last.
 * Above those, for about eight weeks, it throws leafless flower stems that
 * carry the whole ornamental display and are then cut off. The frame cannot
 * be cut into -- lavender does not break from old wood -- so a plant that has
 * gone woody is replaced rather than renewed, which is why this profile has a
 * replacement cycle and no renewal pruning at all.
 */
export const HIDCOTE_PROFILE = Object.freeze({
  species: 'Lavandula angustifolia',
  cultivar: 'Hidcote',
  synonyms: Object.freeze([
    'Hidcote Blue',
    'Hidcote Purple',
    'Hidcote Variety',
  ]),
  commonName: 'English lavender',
  locale: 'central Poland',
  unit: 'metre',
  metresPerUnit: METRES_PER_UNIT,
  architecture: Object.freeze({
    habit: 'evergreen mounded subshrub with a low persistent woody frame',
    hasTrunk: false,
    crownOrigin: 'ground-level woody base',
    evergreen: true,
    /** Foliage mound plus the flower stems standing over it. */
    matureHeightM: 0.54,
    /** The dome of leafy shoots on its own, which is what RHS measures. */
    matureFoliageHeightM: 0.34,
    matureRadiusM: 0.4,
    rhsUltimateHeightRangeM: Object.freeze([0.1, 0.5]),
    rhsUltimateSpreadRangeM: Object.freeze([0.5, 1.0]),
    observedYearsToUltimateHeight: Object.freeze([2, 5]),
    frameworkBranchCount: 18,
    /**
     * RHS: older plants go straggly, very woody and mis-shapen, and are best
     * replaced rather than cut back -- there is no renewal cut available on a
     * plant that will not break from old wood. Past this age the model is
     * showing the next plant in the same place, not a twenty-year-old one.
     */
    replacementCycleYears: 10,
    modelHorizonYears: 30,
  }),
  growth: Object.freeze({
    /**
     * Frame extension against plant age, in fractions of the mature frame.
     * Constrained by the RHS observation that ultimate height arrives in two
     * to five years, so the curve is nearly flat after year four.
     */
    frameAgeScaleAnchors: Object.freeze([
      Object.freeze([0, 0.24]),
      Object.freeze([1, 0.52]),
      Object.freeze([2, 0.74]),
      Object.freeze([3, 0.9]),
      Object.freeze([4, 0.98]),
      Object.freeze([5, 1]),
    ]),
    /**
     * When the year's green growth runs. A Mediterranean subshrub in Poland
     * waits for the frosts to finish before it moves, then extends fast.
     * These are renderer assumptions tied to the modelled leaf flush, not
     * observed station dates.
     */
    shootExtensionDayRange: Object.freeze([100, 165]),
  }),
  /**
   * The framework branch, under the key the shared renderer reads.
   *
   * `PlantRenderer` calls a plant's top-level woody module a *cane*, and every
   * plant in this library answers to that key whatever its own botany calls
   * the thing. A lavender's is not a cane in any botanical sense: it is a
   * short, permanent, splayed framework branch that is never renewed and
   * never cut. The word is the library's, the plant is this.
   */
  cane: Object.freeze({
    /**
     * A stub, and deliberately shorter than the shoots it carries.
     *
     * The frame used to be the longest thing on the plant and it made the
     * mound's whole radius, which put a starburst of bare grey branches under
     * the foliage and out past its edge. No photograph of a healthy lavender
     * shows any wood at all — the plant meets the soil as a skirt of green
     * shoots — so the frame is now short enough to sit inside the foliage
     * envelope, and the radius is made by the shoots instead.
     */
    lengthM: Object.freeze([0.06, 0.16]),
    baseRadiusM: Object.freeze([0.0028, 0.005]),
    crownRadiusM: 0.045,
    /**
     * Angle from vertical, in radians, and the distribution across it is
     * `splayBias`.
     *
     * This range is the plant's whole silhouette: the steepest branch sets
     * the height of the mound and the flattest sets its width. Sampling it
     * evenly gives a plant as tall as it is wide, because a branch and the
     * shoot on it are about the same length whichever way they point;
     * 'Hidcote' is half a metre tall and three quarters of a metre across, so
     * the flat end of the range has to be where most of the branches are.
     */
    splayRadians: Object.freeze([0.32, 1.34]),
    /**
     * Nothing on this plant tapers much. A lavender shoot is the same 2 mm
     * from its base to its tip, and the flower stem above it is a stiff
     * square 1.5 mm the whole way -- thread-thin peduncles are the fastest
     * way to turn a stand of spikes into a stand of floating dots.
     */
    axisRadiusFactors: Object.freeze({
      primary: 1,
      lateral: 0.3,
      higherOrder: 0.3,
    }),
    /** Exponent biasing the splay sample toward the flat end. */
    splayBias: 0.65,
    childParentRadiusRatio: 0.85,
    axisTaperRatios: Object.freeze([1, 0.94, 0.86, 0.72]),
    /**
     * Lavender does not break from old wood, so there is no whole-branch
     * renewal cut and no pruning height. The only cut this plant ever gets is
     * the shear in `management`.
     */
    wholeCanePruning: false,
  }),
  shoot: Object.freeze({
    /**
     * One season's green extension, which then lignifies and persists. These
     * are what the mound is: longer than the frame branch they stand on, and
     * splayed nearly as far, so the plant's outline is foliage everywhere and
     * its edge reaches the soil.
     */
    lengthM: Object.freeze([0.11, 0.28]),
    /** Angle from its parent, in radians: shoots turn up out of the frame. */
    /**
     * How far a shoot turns up out of its parent, as a share of the parent's
     * own splay. Proportional rather than absolute, and that is the whole
     * shape of the plant: a shoot on a near-horizontal outer branch has to
     * keep leaning outward to cover it, while one on an upright inner branch
     * stands straight. Subtract a fixed angle instead and every outer branch
     * ends up a bare grey stick with a vertical tuft standing on it.
     */
    riseRadians: Object.freeze([-0.08, 0.35]),
    /**
     * How long a shoot stays fully clothed. It is never removed — an old
     * shoot does not fall off a lavender, it slowly becomes part of the frame
     * — so what this governs is how far up the shoot the bare wood has
     * climbed, and the open woody interior that leaves behind is exactly why
     * an old plant is replaced rather than cut back.
     */
    lifeYears: 7,
  }),
  leaf: Object.freeze({
    arrangement: 'opposite-decussate with axillary fascicles',
    lengthM: Object.freeze([0.019, 0.036]),
    widthM: Object.freeze([0.0038, 0.0058]),
    shape: 'linear, entire, revolute margins, grey-green and finely downy',
    evergreen: true,
  }),
  peduncle: Object.freeze({
    /** The naked flower stem. Species range is 10-30 cm; Hidcote is short. */
    lengthM: Object.freeze([0.1, 0.21]),
    baseRadiusM: Object.freeze([0.0007, 0.0011]),
    /**
     * How much of its shoot's lean a stem keeps, rather than straightening
     * out of it. Never more than all of it: a stem that leaned further than
     * the shoot under it threw its spike clear of the plant on a bare wire,
     * which is a thing lavender does not do.
     */
    straightenRange: Object.freeze([0.5, 1.0]),
    attachment: 'terminal on a current-season shoot, leafless above its base',
  }),
  spike: Object.freeze({
    /** Species range is 2-8 cm; Hidcote sits in the lower half of it. */
    lengthM: Object.freeze([0.028, 0.05]),
    widthM: Object.freeze([0.009, 0.013]),
    /** Whorls of flowers up the spike, which is why it reads interrupted. */
    verticillasters: Object.freeze([5, 9]),
    colour: 'deep violet-blue calyces with paler blue-violet corollas',
  }),
  management: Object.freeze({
    plantingMonths: Object.freeze([4, 5]),
    /**
     * The one cut of the year: after flowering, the spent stems come off and
     * about 2.5 cm of leafy growth with them. Never into the frame.
     */
    shearsAfterFlowering: true,
    trimLeafDepthM: 0.025,
    cutsIntoOldWood: false,
    spacingM: 0.9,
    hedgeSpacingM: 0.3,
    pruningMethod:
      'shear the spent flower stems and about 2.5 cm of leaf growth in late summer, never back into old wood',
  }),
});
