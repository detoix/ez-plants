import * as THREE from 'three';

/* ==================================================================== *
 * Shared plant vocabulary
 * ==================================================================== */

/** A calendar position: a 1-365 day number, a Date, or an ISO/MM-DD string. */
export type DayOfYearInput = number | Date | string;

/** How the plant has been looked after over its modelled life. */
export type PlantScenario = 'maintained' | 'neglected';

export interface PlantAssets {
  /**
   * EZ-Tree bark options. `textureScale.x` is wraps per unit of branch
   * radius, so a metre-scale plant needs a metre-calibrated value.
   */
  bark?: {
    type?: string;
    tint?: number;
    textureScale?: { x: number; y: number };
    maps?: Record<string, THREE.Texture | null> | null;
    [key: string]: unknown;
  } | null;
  leaf?: {
    map?: THREE.Texture | null;
    tint?: number;
    alphaTest?: number;
    roundedNormals?: boolean;
  };
}

export interface PlantDetail {
  sectionStride: number;
  segmentFactor: number;
  leafStride: number;
  leafScale: number;
  billboard: unknown;
}

export interface PlantLODLevel {
  distance: number;
  hysteresis?: number;
  detail?: Partial<PlantDetail>;
}

export interface CareHint {
  id: string;
  category: string;
  priority: 'important' | 'recommended' | 'notice';
  title: string;
  message: string;
  /** Absolute URL of the source backing this recommendation. */
  source: string;
}

export interface PlantDimensions {
  heightM: number;
  radiusM: number;
  spreadM: number;
}

export interface CareEvent {
  id: string;
  type: string;
  ageYears: number;
  dayOfYear: number;
  [key: string]: unknown;
}

export interface PruneEvent extends CareEvent {
  type: 'prune';
  caneId: string;
}

export interface HarvestEvent extends CareEvent {
  type: 'harvest';
  amountKg: number;
}

/** Result of asking a plant to make a renewal cut. */
export interface PruneResult {
  event: PruneEvent | null;
  applied: boolean;
  caneId?: string;
  type?: 'prune';
  /** Why the cut was refused, when `applied` is false. */
  reason?:
    | 'too-young'
    | 'no-canes'
    | 'quota-reached'
    | 'before-flowering-ends'
    | 'after-bud-set'
    | (string & {});
}

export interface PlantRenderStats {
  visibleCanes: number;
  visibleAxes: number;
  visibleLeaves: number;
  woodyDrawCalls: number;
  drawCalls: number;
}

/* ==================================================================== *
 * Base renderer
 * ==================================================================== */

/**
 * Machinery shared by every multi-cane shrub renderer: groups, tracked
 * materials, stable-capacity instance pools, the EZ-Tree woody meshing pass,
 * distance LOD and the validated state cycle.
 */
export declare class PlantRenderer extends THREE.Group {
  readonly cultivar: string;
  readonly seed: string | number;
  readonly maxYears: number;
  ageYears: number;
  dayOfYear: number;

  /** Applied care events, as copies. */
  readonly events: CareEvent[];

  setTime(time: { ageYears?: number; dayOfYear?: number }): this;
  setState(patch: Record<string, unknown>): this;
  addEvent(event: Partial<CareEvent>): CareEvent;
  resetEvents(): this;

  /**
   * Advance leaf wind and, when a camera is supplied and LOD is enabled,
   * re-select the detail level. Call once per frame.
   */
  update(
    deltaSeconds?: number,
    elapsedSeconds?: number,
    camera?: THREE.Camera,
  ): void;

  /** Release every geometry, material and texture this plant owns. */
  dispose(): void;
}

/* ==================================================================== *
 * Blackcurrant — Ribes nigrum 'Tisel'
 * ==================================================================== */

/** Which observed central-Poland trial year drives the calendar. */
export type TiselTrialYear = 'mean' | '2022' | '2023' | '2024';

export interface TiselPhenology {
  dayOfYear: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  phase: string;
  stage: string;
  label: string;
  /** BBCH growth-stage code. */
  bbch: string;
  bbchCode: string;
  trialYear: TiselTrialYear;
  offsetDays: number;
  calendar: Readonly<Record<string, number>>;
  leafProgress: number;
  leafOpacity: number;
  flowerProgress: number;
  flowerVisibility: number;
  flowerOpenVisibility: number;
  fruitProgress: number;
  fruitColorProgress: number;
  ripeProgress: number;
  harvestProgress: number;
  berryVisibility: number;
  fruitDropProgress: number;
  autumnProgress: number;
}

export interface BlackcurrantOptions {
  cultivar?: 'Tisel';
  seed?: string | number;
  plantId?: string;
  maxYears?: number;
  ageYears?: number;
  dayOfYear?: number;
  scenario?: PlantScenario;
  trialYear?: TiselTrialYear;
  offsetDays?: number;
  assets?: PlantAssets;
  events?: Partial<CareEvent>[];
  /** Enable camera-distance level of detail. */
  lod?: boolean;
}

export interface BlackcurrantStats extends PlantRenderStats {
  species: string;
  cultivar: string;
  ageYears: number;
  dayOfYear: number;
  scenario: PlantScenario;
  visibleFlowers: number;
  visibleFlowerBuds: number;
  visibleBerries: number;
  visibleGreenBerries: number;
  visibleRipeBerries: number;
  /** Source-calibrated planning estimate, not a count of rendered spheres. */
  estimatedYieldKg: number;
  harvestedYieldKg: number;
  phenology: TiselPhenology;
  careHints: readonly CareHint[];
}

export declare class Blackcurrant extends PlantRenderer {
  constructor(options?: BlackcurrantOptions);
  scenario: PlantScenario;
  trialYear: TiselTrialYear;
  offsetDays: number;

  setState(patch: {
    ageYears?: number;
    dayOfYear?: number;
    scenario?: PlantScenario;
    trialYear?: TiselTrialYear;
    offsetDays?: number;
  }): this;
  setScenario(scenario: PlantScenario): this;
  setPhenologyProfile(profile: {
    trialYear?: TiselTrialYear;
    offsetDays?: number;
  }): this;

  pruneOldestCane(options?: {
    ageYears?: number;
    dayOfYear?: number;
  }): PruneResult;
  harvest(options?: { id?: string; amountKg?: number; note?: string }): {
    event: HarvestEvent | null;
    amountKg: number;
    reason?: string;
  };

  stats(): BlackcurrantStats;
  serialize(): BlackcurrantOptions & { schemaVersion: 1; type: 'Blackcurrant' };
}

/* ==================================================================== *
 * Forsythia — Forsythia x intermedia 'Lynwood'
 * ==================================================================== */

/**
 * Which Polish flowering profile drives the calendar. `central` and
 * `northeast` are observed regional peaks; `early` and `late` bracket the
 * weather-driven spread between years.
 */
export type LynwoodRegion = 'central' | 'northeast' | 'early' | 'late';

export interface LynwoodPhenology {
  dayOfYear: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  phase:
    | 'dormant'
    | 'flower-bud'
    | 'flowering'
    | 'leaf-expansion'
    | 'summer-canopy'
    | 'capsule-maturity'
    | 'autumn';
  stage: string;
  label: string;
  bbch: string;
  bbchCode: string;
  region: LynwoodRegion;
  regionLabel: string;
  offsetDays: number;
  calendar: Readonly<{
    dormantEnd: number;
    budSwellingStart: number;
    floweringStart: number;
    floweringPeak: number;
    floweringEnd: number;
    leafEmergenceStart: number;
    leafFullExpansion: number;
    capsuleSetStart: number;
    capsuleMatureStart: number;
    autumnStart: number;
    leafFallEnd: number;
  }>;
  budSwellProgress: number;
  leafProgress: number;
  leafOpacity: number;
  flowerProgress: number;
  flowerVisibility: number;
  flowerBudVisibility: number;
  flowerOpenVisibility: number;
  capsuleVisibility: number;
  capsuleMaturity: number;
  autumnProgress: number;
  /** Always true for this species: the display opens before any leaf. */
  flowersPrecedeLeaves: true;
  /** True while corollas are open and no leaf has yet expanded. */
  bareWoodFlowering: boolean;
}

export interface ForsythiaOptions {
  schemaVersion?: 2;
  cultivar?: 'Lynwood' | 'Lynwood Gold';
  seed?: string | number;
  plantId?: string;
  maxYears?: number;
  ageYears?: number;
  dayOfYear?: number;
  scenario?: PlantScenario;
  region?: LynwoodRegion;
  offsetDays?: number;
  assets?: PlantAssets;
  events?: Partial<CareEvent>[];
  lod?: boolean;
}

export interface ForsythiaStats extends PlantRenderStats {
  species: string;
  cultivar: string;
  ageYears: number;
  dayOfYear: number;
  scenario: PlantScenario;
  renewalManagedAutomatically: boolean;
  region: LynwoodRegion;
  visibleFlowers: number;
  visibleFlowerBuds: number;
  /** Dry, non-ornamental capsules; a thrum clone sets almost no seed. */
  visibleCapsules: number;
  /** Unthinned model counts; rendered counts may be lower under LOD. */
  biologicalVisibleLeaves: number;
  biologicalVisibleFlowers: number;
  biologicalVisibleFlowerBuds: number;
  biologicalVisibleCapsules: number;
  floweringNodes: number;
  bareWoodFlowering: boolean;
  dimensions: PlantDimensions;
  phenology: LynwoodPhenology;
  careHints: readonly CareHint[];
}

export declare class Forsythia extends PlantRenderer {
  constructor(options?: ForsythiaOptions);
  scenario: PlantScenario;
  region: LynwoodRegion;
  offsetDays: number;

  setState(patch: {
    ageYears?: number;
    dayOfYear?: number;
    scenario?: PlantScenario;
    region?: LynwoodRegion;
    offsetDays?: number;
  }): this;
  setScenario(scenario: PlantScenario): this;
  setPhenologyProfile(profile: {
    region?: LynwoodRegion;
    offsetDays?: number;
  }): this;

  /**
   * Remove the oldest eligible whole cane at the crown.
   *
   * The window is immediately AFTER flowering and before mid-July: this
   * species carries next spring's display on the wood it makes this summer.
   */
  pruneOldestCane(options?: {
    ageYears?: number;
    dayOfYear?: number;
  }): PruneResult;

  stats(): ForsythiaStats;
  serialize(): ForsythiaOptions & { schemaVersion: 2; type: 'Forsythia' };
}

/* ==================================================================== *
 * Panicle hydrangea — Hydrangea paniculata 'Limelight'
 * ==================================================================== */

/** Weather-timing brackets around the central-Poland phenology calendar. */
export type LimelightSeasonProfile = 'typical' | 'early' | 'late';

export interface LimelightPhenology {
  dayOfYear: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  phase:
    | 'dormant'
    | 'bud-swelling'
    | 'leaf-emergence'
    | 'shoot-extension'
    | 'panicle-bud'
    | 'lime-flowering'
    | 'cream-flowering'
    | 'pink-ageing'
    | 'burgundy-ageing'
    | 'autumn-drying';
  stage: string;
  label: string;
  bbch: string;
  bbchCode: string;
  seasonProfile: LimelightSeasonProfile;
  seasonProfileLabel: string;
  offsetDays: number;
  calendar: Readonly<Record<string, number>>;
  budSwellProgress: number;
  leafProgress: number;
  leafOpacity: number;
  autumnProgress: number;
  shootGrowthProgress: number;
  panicleGrowthProgress: number;
  panicleVisibility: number;
  currentPanicleVisibility: number;
  oldPanicleVisibility: number;
  freshPanicleVisibility: number;
  dryPanicleVisibility: number;
  panicleBudVisibility: number;
  sterileFloretVisibility: number;
  fertileFloretVisibility: number;
  flowerProgress: number;
  flowerVisibility: number;
  flowerOpenVisibility: number;
  panicleColourStage:
    | 'green-bud'
    | 'pale-lime'
    | 'cream-white'
    | 'blush-pink'
    | 'burgundy-pink'
    | 'dry-tan';
  limeToCreamProgress: number;
  pinkProgress: number;
  burgundyProgress: number;
  dryProgress: number;
  flowersOnCurrentSeasonWood: true;
}

export interface HydrangeaOptions {
  cultivar?: 'Limelight';
  seed?: string | number;
  plantId?: string;
  maxYears?: number;
  ageYears?: number;
  dayOfYear?: number;
  scenario?: PlantScenario;
  seasonProfile?: LimelightSeasonProfile;
  offsetDays?: number;
  assets?: PlantAssets;
  /** Limelight currently exposes scenarios, not destructive care events. */
  events?: readonly [];
  lod?: boolean;
}

export interface HydrangeaStats extends PlantRenderStats {
  species: string;
  cultivar: string;
  ageYears: number;
  dayOfYear: number;
  scenario: PlantScenario;
  seasonProfile: LimelightSeasonProfile;
  visiblePanicles: number;
  visibleDryPanicles: number;
  /** Age-eligible fresh heads before autumn drying. */
  freshPanicles: number;
  /** Age-eligible tan heads, before renderer LOD thinning. */
  dryPanicles: number;
  panicleBuds: number;
  flowersOnCurrentSeasonWood: true;
  dimensions: PlantDimensions;
  phenology: LimelightPhenology;
  careHints: readonly CareHint[];
}

export declare class Hydrangea extends PlantRenderer {
  constructor(options?: HydrangeaOptions);
  scenario: PlantScenario;
  seasonProfile: LimelightSeasonProfile;
  offsetDays: number;

  setState(patch: {
    ageYears?: number;
    dayOfYear?: number;
    scenario?: PlantScenario;
    seasonProfile?: LimelightSeasonProfile;
    offsetDays?: number;
  }): this;
  setScenario(scenario: PlantScenario): this;
  setPhenologyProfile(profile: {
    seasonProfile?: LimelightSeasonProfile;
    offsetDays?: number;
  }): this;
  stats(): HydrangeaStats;
  serialize(): HydrangeaOptions & { schemaVersion: 1; type: 'Hydrangea' };
}

/* ==================================================================== *
 * Chinese silver grass — Miscanthus sinensis 'Malepartus'
 * ==================================================================== */

/** Weather-timing brackets around the central-Poland phenology calendar. */
export type MalepartusSeasonProfile = 'typical' | 'early' | 'late';

export interface MalepartusPhenology {
  dayOfYear: number;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  phase:
    | 'standing-dry'
    | 'cut-back'
    | 'dormant'
    | 'emergence'
    | 'tillering'
    | 'culm-elongation'
    | 'booting'
    | 'heading'
    | 'flowering'
    | 'silvering'
    | 'senescence';
  stage: string;
  label: string;
  bbch: string;
  bbchCode: string;
  /** Grasses are labelled on the BBCH monocotyledon (cereal) scale. */
  bbchScale: 'cereal';
  seasonProfile: MalepartusSeasonProfile;
  seasonProfileLabel: string;
  offsetDays: number;
  scenario: PlantScenario;
  calendar: Readonly<Record<string, number>>;
  /** How far through the modelled spring cut the clump is. */
  cutProgress: number;
  stubbleVisibility: number;
  /** How much of last season's standing dead growth is still present. */
  standingDryVisibility: number;
  emergenceProgress: number;
  culmExtensionProgress: number;
  bladeProgress: number;
  autumnProgress: number;
  strawProgress: number;
  /** Physical winter tattering of this season's dry culms. */
  weatheringProgress: number;
  /** The same measure for growth that went dry a year earlier. */
  previousWeatheringProgress: number;
  paniclePush: number;
  panicleVisibility: number;
  fanOpenProgress: number;
  plumeFluffProgress: number;
  plumeVisibility: number;
  silverProgress: number;
  plumeColourStage:
    | 'absent'
    | 'coppery-wine'
    | 'bronze-pink'
    | 'silver-pink'
    | 'silver-white'
    | 'weathered-ivory';
  flowersOnCurrentSeasonCulms: true;
  foliageIsDeciduousButPersistent: true;
}

export interface MalepartusClump {
  /** Half-width of the crown of tillers, not of the arching foliage. */
  radiusM: number;
  /** Radius of the dead centre of an undivided clump; 0 when maintained. */
  dieOutRadiusM: number;
  tillerSites: number;
}

export interface MiscanthusOptions {
  cultivar?: 'Malepartus';
  seed?: string | number;
  plantId?: string;
  maxYears?: number;
  ageYears?: number;
  dayOfYear?: number;
  scenario?: PlantScenario;
  seasonProfile?: MalepartusSeasonProfile;
  offsetDays?: number;
  assets?: PlantAssets;
  /**
   * Malepartus exposes scenarios rather than care events: its single annual
   * cut is modelled by the maintained scenario's pruning window.
   */
  events?: readonly [];
  lod?: boolean;
}

export interface MiscanthusStats extends PlantRenderStats {
  species: string;
  cultivar: string;
  ageYears: number;
  dayOfYear: number;
  scenario: PlantScenario;
  seasonProfile: MalepartusSeasonProfile;
  visibleTillers: number;
  /** One culm is one cane; `visibleCanes` mirrors this for shared UI. */
  visibleCulms: number;
  livingCulms: number;
  standingDeadCulms: number;
  stubs: number;
  culmSegments: number;
  /** `visibleLeaves` mirrors this for shared UI. */
  visibleBlades: number;
  visiblePanicles: number;
  visiblePlumes: number;
  floweringCulms: number;
  silveredPanicles: number;
  flowersOnCurrentSeasonCulms: true;
  clump: MalepartusClump;
  dimensions: PlantDimensions;
  phenology: MalepartusPhenology;
  careHints: readonly CareHint[];
}

export declare class Miscanthus extends PlantRenderer {
  constructor(options?: MiscanthusOptions);
  scenario: PlantScenario;
  seasonProfile: MalepartusSeasonProfile;
  offsetDays: number;

  setState(patch: {
    ageYears?: number;
    dayOfYear?: number;
    scenario?: PlantScenario;
    seasonProfile?: MalepartusSeasonProfile;
    offsetDays?: number;
  }): this;
  setScenario(scenario: PlantScenario): this;
  setPhenologyProfile(profile: {
    seasonProfile?: MalepartusSeasonProfile;
    offsetDays?: number;
  }): this;
  stats(): MiscanthusStats;
  serialize(): MiscanthusOptions & { schemaVersion: 1; type: 'Miscanthus' };
}

/* ==================================================================== *
 * Free functions
 * ==================================================================== */

/** Convert a Date, ISO string, MM-DD string or number to a 1-365 day. */
export declare function dayOfYear(value: DayOfYearInput): number;

export declare function getTiselPhenology(
  value?: DayOfYearInput,
  options?: { trialYear?: TiselTrialYear; offsetDays?: number },
): Readonly<TiselPhenology>;

export declare function getTiselCareHints(
  value?: DayOfYearInput,
  options?: {
    plantAgeYears?: number;
    trialYear?: TiselTrialYear;
    offsetDays?: number;
  },
): readonly CareHint[];

export declare function getLynwoodPhenology(
  value?: DayOfYearInput,
  options?: { region?: LynwoodRegion; offsetDays?: number },
): Readonly<LynwoodPhenology>;

export declare function getLynwoodCareHints(
  value?: DayOfYearInput,
  options?: {
    plantAgeYears?: number;
    region?: LynwoodRegion;
    offsetDays?: number;
  },
): readonly CareHint[];

export declare function getLimelightCalendar(options?: {
  seasonProfile?: LimelightSeasonProfile;
  offsetDays?: number;
}): Readonly<Record<string, number>>;

export declare function getLimelightPhenology(
  value?: DayOfYearInput,
  options?: {
    seasonProfile?: LimelightSeasonProfile;
    offsetDays?: number;
  },
): Readonly<LimelightPhenology>;

export declare function getLimelightCareHints(
  value?: DayOfYearInput,
  options?: {
    plantAgeYears?: number;
    seasonProfile?: LimelightSeasonProfile;
    offsetDays?: number;
  },
): readonly CareHint[];

export declare function createLynwoodModel(options?: {
  seed?: string | number;
  maxYears?: number;
}): { kind: 'forsythia-growth-model'; [key: string]: unknown };

export declare function evaluateLynwoodModel(
  model: { kind: string; [key: string]: unknown },
  options?: {
    ageYears?: number;
    dayOfYear?: number;
    events?: Partial<CareEvent>[];
    scenario?: PlantScenario;
    region?: LynwoodRegion;
    offsetDays?: number;
  },
): {
  dimensions: PlantDimensions;
  phenology: LynwoodPhenology;
  careHints: readonly CareHint[];
  stats: Record<string, number | boolean>;
  [key: string]: unknown;
};

export declare function getMalepartusCalendar(options?: {
  seasonProfile?: MalepartusSeasonProfile;
  offsetDays?: number;
}): Readonly<Record<string, number>>;

export declare function getMalepartusPhenology(
  value?: DayOfYearInput,
  options?: {
    seasonProfile?: MalepartusSeasonProfile;
    offsetDays?: number;
    scenario?: PlantScenario;
  },
): Readonly<MalepartusPhenology>;

export declare function getMalepartusCareHints(
  value?: DayOfYearInput,
  options?: {
    plantAgeYears?: number;
    seasonProfile?: MalepartusSeasonProfile;
    offsetDays?: number;
    scenario?: PlantScenario;
  },
): readonly CareHint[];

export declare function createLimelightModel(options?: {
  seed?: string | number;
  maxYears?: number;
}): { kind: 'hydrangea-limelight-growth-model'; [key: string]: unknown };

export declare function createMalepartusModel(options?: {
  seed?: string | number;
  maxYears?: number;
}): { kind: 'miscanthus-malepartus-growth-model'; [key: string]: unknown };

export declare function evaluateMalepartusModel(
  model: { kind: string; [key: string]: unknown },
  options?: {
    ageYears?: number;
    dayOfYear?: number;
    /** Malepartus exposes scenarios, not destructive care events. */
    events?: readonly [];
    scenario?: PlantScenario;
    seasonProfile?: MalepartusSeasonProfile;
    offsetDays?: number;
  },
): {
  clump: MalepartusClump;
  dimensions: PlantDimensions;
  phenology: MalepartusPhenology;
  careHints: readonly CareHint[];
  stats: Record<string, number | boolean>;
  [key: string]: unknown;
};

export declare function evaluateLimelightModel(
  model: { kind: string; [key: string]: unknown },
  options?: {
    ageYears?: number;
    dayOfYear?: number;
    /** Limelight currently exposes scenarios, not destructive care events. */
    events?: readonly [];
    scenario?: PlantScenario;
    seasonProfile?: LimelightSeasonProfile;
    offsetDays?: number;
  },
): {
  dimensions: PlantDimensions;
  phenology: LimelightPhenology;
  careHints: readonly CareHint[];
  stats: Record<string, number | boolean>;
  [key: string]: unknown;
};

/* ==================================================================== *
 * Sourced cultivar profiles
 * ==================================================================== */

export interface CultivarSource {
  title: string;
  url: string;
  /** What this source is actually being cited for. */
  supports: string;
}

export declare const TISEL_PROFILE: Readonly<Record<string, unknown>>;
export declare const TISEL_SOURCES: Readonly<Record<string, CultivarSource>>;
export declare const TISEL_CALENDAR: Readonly<Record<string, number>>;
export declare const TISEL_CALENDAR_PROVENANCE: Readonly<
  Record<string, unknown>
>;

export declare const LYNWOOD_PROFILE: Readonly<Record<string, unknown>>;
export declare const LYNWOOD_SOURCES: Readonly<Record<string, CultivarSource>>;
export declare const LYNWOOD_CALENDAR: Readonly<Record<string, number>>;
export declare const LYNWOOD_CALENDAR_PROVENANCE: Readonly<
  Record<string, unknown>
>;
export declare const LYNWOOD_REGION_OBSERVATIONS: Readonly<
  Record<LynwoodRegion, Readonly<Record<string, unknown>>>
>;

export declare const LIMELIGHT_PROFILE: Readonly<Record<string, unknown>>;
export declare const LIMELIGHT_SOURCES: Readonly<
  Record<string, CultivarSource>
>;
export declare const LIMELIGHT_CALENDAR: Readonly<Record<string, number>>;
export declare const LIMELIGHT_CALENDAR_PROVENANCE: Readonly<
  Record<string, unknown>
>;
export declare const LIMELIGHT_PHASE_ASSUMPTIONS: Readonly<
  Record<string, unknown>
>;
export declare const LIMELIGHT_SEASON_PROFILES: Readonly<
  Record<LimelightSeasonProfile, Readonly<Record<string, unknown>>>
>;

export declare const MALEPARTUS_PROFILE: Readonly<Record<string, unknown>>;
export declare const MALEPARTUS_SOURCES: Readonly<
  Record<string, CultivarSource>
>;
export declare const MALEPARTUS_CALENDAR: Readonly<Record<string, number>>;
export declare const MALEPARTUS_CALENDAR_PROVENANCE: Readonly<
  Record<string, unknown>
>;
export declare const MALEPARTUS_PHASE_ASSUMPTIONS: Readonly<
  Record<string, unknown>
>;
export declare const MALEPARTUS_SEASON_PROFILES: Readonly<
  Record<MalepartusSeasonProfile, Readonly<Record<string, unknown>>>
>;
