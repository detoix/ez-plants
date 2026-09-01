import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';

/** Transform and event props accepted by any object placed in a scene. */
type GroupProps = ThreeElements['group'];
import {
  Blackcurrant,
  Echinacea,
  Forsythia,
  Hydrangea,
  Lavender,
  Miscanthus,
  Pennisetum,
  type BlackcurrantOptions,
  type BlackcurrantStats,
  type EchinaceaOptions,
  type EchinaceaStats,
  type ForsythiaOptions,
  type ForsythiaStats,
  type HidcoteRegion,
  type HydrangeaOptions,
  type HydrangeaStats,
  type LavenderOptions,
  type LavenderStats,
  type LimelightSeasonProfile,
  type LynwoodRegion,
  type MagnusSeasonProfile,
  type MalepartusSeasonProfile,
  type MiscanthusOptions,
  type MiscanthusStats,
  type HamelnSeasonProfile,
  type PennisetumOptions,
  type PennisetumStats,
  type TiselTrialYear,
} from '@detoix/ez-plants';

/**
 * Options that select which plant is built. Changing any of these rebuilds
 * the plant from scratch, because they define its immutable growth graph.
 */
type ConstructionKeys =
  | 'seed'
  | 'maxYears'
  | 'plantId'
  | 'cultivar'
  | 'assets'
  | 'leafWind'
  | 'lodLevels';

/** State that is applied to a live plant without rebuilding it. */
export interface PlantTimeProps {
  /** Whole years since planting. */
  ageYears?: number;
  /** 1-365. Accepts the same day the phenology helpers use. */
  dayOfYear?: number;
  offsetDays?: number;
}

export interface BasePlantProps extends PlantTimeProps {
  /**
   * Called after every applied state change with the plant's current stats,
   * so a UI can show stage, BBCH code and rendered organ counts.
   */
  onStats?: (stats: never) => void;
  /**
   * Which level of detail to draw, as an index into the plant's `lodLevels`.
   * Defaults to 0, the finest.
   *
   * The library never chooses this for you and never reads the camera. If you
   * want distance-driven detail, compute it in your own component — R3F gives
   * you the camera in `useFrame` — and pass the result down. `PlantLODController`
   * from the root package does the hysteresis if you want it.
   */
  level?: number;
}

function useAppliedState<
  TPlant extends { setState: (patch: never) => unknown },
>(
  plant: TPlant,
  patch: Record<string, unknown>,
  onStats?: (stats: never) => void,
) {
  // Serialise so a caller passing a fresh object literal each render does not
  // re-apply an identical state (which would remesh the woody geometry).
  const key = JSON.stringify(patch);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;

  useEffect(() => {
    plant.setState(patch as never);
    const withStats = plant as unknown as { stats?: () => never };
    if (statsRef.current && typeof withStats.stats === 'function') {
      statsRef.current(withStats.stats());
    }
    // `key` stands in for a deep comparison of `patch`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plant, key]);
}

function usePlantFrame(plant: {
  update: (deltaSeconds?: number, elapsedSeconds?: number) => void;
}) {
  // Wind only. No camera is read here: choosing a level is the caller's
  // decision, via the `level` prop, exactly as it is through the imperative
  // API (library rule 8 -- two front doors, one behaviour).
  useFrame((state, delta) => {
    plant.update(Math.min(delta, 0.05), state.clock.elapsedTime);
  });
}

function usePlantLevel(
  plant: { setLevel: (index: number) => unknown },
  level: number,
) {
  useEffect(() => {
    plant.setLevel(level);
  }, [plant, level]);
}

function useDisposable<TPlant extends { dispose: () => void }>(
  factory: () => TPlant,
  deps: unknown[],
): TPlant {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plant = useMemo(factory, deps);
  useEffect(() => () => plant.dispose(), [plant]);
  return plant;
}

/* ==================================================================== *
 * Forsythia
 * ==================================================================== */

export interface ForsythiaProps
  extends BasePlantProps,
    Pick<ForsythiaOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Which Polish flowering profile drives the calendar. */
  region?: LynwoodRegion;
  onStats?: (stats: ForsythiaStats) => void;
}

/**
 * Forsythia x intermedia 'Lynwood' as a React Three Fiber component.
 *
 * The plant is an imperative THREE.Group under the hood: it is built once per
 * seed and mounted with `<primitive>`, then `ageYears` and `dayOfYear` are
 * applied to the live object rather than rebuilding it. Remember that this
 * species flowers on bare one- and two-year-old wood, so a day inside the
 * flowering window renders no leaves at all.
 *
 * ```tsx
 * <Canvas>
 *   <Forsythia ageYears={6} dayOfYear={96} />
 * </Canvas>
 * ```
 */
export function ForsythiaPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 6,
  dayOfYear = 96,
  region = 'central',
  offsetDays = 0,
  onStats,
  ...groupProps
}: ForsythiaProps) {
  const plant = useDisposable(
    () =>
      new Forsythia({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        region,
        offsetDays,
      }),
    // Construction options only. Time and season are applied below.
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, region, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Hydrangea paniculata 'Limelight'
 * ==================================================================== */

export interface HydrangeaProps
  extends BasePlantProps,
    Pick<HydrangeaOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Weather-timing bracket around the central-Poland calendar. */
  seasonProfile?: LimelightSeasonProfile;
  onStats?: (stats: HydrangeaStats) => void;
}

/**
 * Hydrangea paniculata 'Limelight' as a React Three Fiber component.
 *
 * The graph is constructed once. Age, day and season
 * profile are applied to the live renderer, so either slider can scrub without
 * rebuilding the framework or reallocating instance buffers.
 *
 * ```tsx
 * <Canvas>
 *   <HydrangeaPlant ageYears={6} dayOfYear={230} />
 * </Canvas>
 * ```
 */
export function HydrangeaPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 6,
  dayOfYear = 230,
  seasonProfile = 'typical',
  offsetDays = 0,
  onStats,
  ...groupProps
}: HydrangeaProps) {
  const plant = useDisposable(
    () =>
      new Hydrangea({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Echinacea purpurea 'Magnus'
 * ==================================================================== */

export interface EchinaceaProps
  extends BasePlantProps,
    Pick<EchinaceaOptions, ConstructionKeys | 'events'>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Weather-timing bracket around the central-Poland calendar. */
  seasonProfile?: MagnusSeasonProfile;
  onStats?: (stats: EchinaceaStats) => void;
}

/**
 * Echinacea purpurea 'Magnus' as a React Three Fiber component.
 *
 * The stable crown is constructed once. Age, day and season timing are
 * applied to the live renderer, including spring leaf emergence and autumn
 * leaf drop, while wind advances on the shared frame clock.
 *
 * ```tsx
 * <Canvas>
 *   <EchinaceaPlant ageYears={5} dayOfYear={205} />
 * </Canvas>
 * ```
 */
export function EchinaceaPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  events,
  level = 0,
  ageYears = 5,
  dayOfYear = 205,
  seasonProfile = 'typical',
  offsetDays = 0,
  onStats,
  ...groupProps
}: EchinaceaProps) {
  const plant = useDisposable(
    () =>
      new Echinacea({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        events,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels, events],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Miscanthus sinensis 'Malepartus'
 * ==================================================================== */

export interface MiscanthusProps
  extends BasePlantProps,
    Pick<MiscanthusOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Weather-timing bracket around the central-Poland calendar. */
  seasonProfile?: MalepartusSeasonProfile;
  onStats?: (stats: MiscanthusStats) => void;
}

/**
 * Miscanthus sinensis 'Malepartus' as a React Three Fiber component.
 *
 * The crown is built once; age, day and season profile
 * are applied to the live renderer. Note that this is a warm-season grass with
 * nothing woody about it: a day before late April renders either last year's
 * standing dead culms or, after the modelled spring cut, bare stubble.
 *
 * ```tsx
 * <Canvas>
 *   <MiscanthusPlant ageYears={6} dayOfYear={250} />
 * </Canvas>
 * ```
 */
export function MiscanthusPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 6,
  dayOfYear = 250,
  seasonProfile = 'typical',
  offsetDays = 0,
  onStats,
  ...groupProps
}: MiscanthusProps) {
  const plant = useDisposable(
    () =>
      new Miscanthus({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Pennisetum alopecuroides 'Hameln'
 * ==================================================================== */

export interface PennisetumProps
  extends BasePlantProps,
    Pick<PennisetumOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Weather-timing bracket around the central-Poland calendar. */
  seasonProfile?: HamelnSeasonProfile;
  onStats?: (stats: PennisetumStats) => void;
}

/**
 * Pennisetum alopecuroides 'Hameln' as a React Three Fiber component.
 *
 * The stable crown graph is built once; age, day and season timing mutate the
 * live renderer without rebuilding its instance pools.
 */
export function PennisetumPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 5,
  dayOfYear = 230,
  seasonProfile = 'typical',
  offsetDays = 0,
  onStats,
  ...groupProps
}: PennisetumProps) {
  const plant = useDisposable(
    () =>
      new Pennisetum({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Blackcurrant
 * ==================================================================== */

export interface BlackcurrantProps
  extends BasePlantProps,
    Pick<BlackcurrantOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Which observed central-Poland trial year drives the calendar. */
  trialYear?: TiselTrialYear;
  onStats?: (stats: BlackcurrantStats) => void;
}

/**
 * Ribes nigrum 'Tisel' as a React Three Fiber component.
 *
 * ```tsx
 * <Canvas>
 *   <BlackcurrantPlant ageYears={4} dayOfYear={175} />
 * </Canvas>
 * ```
 */
export function BlackcurrantPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 4,
  dayOfYear = 175,
  trialYear = 'mean',
  offsetDays = 0,
  onStats,
  ...groupProps
}: BlackcurrantProps) {
  const plant = useDisposable(
    () =>
      new Blackcurrant({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        trialYear,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, trialYear, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

/* ==================================================================== *
 * Lavandula angustifolia 'Hidcote'
 * ==================================================================== */

export interface LavenderProps
  extends BasePlantProps,
    Pick<LavenderOptions, ConstructionKeys>,
    Omit<GroupProps, 'children' | 'args'> {
  /** Which Polish flowering profile drives the calendar. */
  region?: HidcoteRegion;
  onStats?: (stats: LavenderStats) => void;
}

/**
 * Lavandula angustifolia 'Hidcote' as a React Three Fiber component.
 *
 * A subshrub rather than a shrub, and it behaves like one: the plant is
 * evergreen, so no day of the year renders it bare, and its display lives on
 * leafless stems for about eight weeks before being sheared off in a single
 * day. A `dayOfYear` past the late-summer trim renders a plant with no
 * flowers at all, which is correct rather than a missing state.
 *
 * ```tsx
 * <Canvas>
 *   <Lavender ageYears={4} dayOfYear={190} />
 * </Canvas>
 * ```
 */
export function LavenderPlant({
  seed,
  maxYears,
  plantId,
  cultivar,
  assets,
  leafWind,
  lodLevels,
  level = 0,
  ageYears = 4,
  dayOfYear = 190,
  region = 'central',
  offsetDays = 0,
  onStats,
  ...groupProps
}: LavenderProps) {
  const plant = useDisposable(
    () =>
      new Lavender({
        seed,
        maxYears,
        plantId,
        cultivar,
        assets,
        leafWind,
        lodLevels,
        ageYears,
        dayOfYear,
        region,
        offsetDays,
      }),
    // Construction options only. Time and season are applied below.
    [seed, maxYears, plantId, cultivar, assets, leafWind, lodLevels],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, region, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantLevel(plant, level);
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

export {
  HydrangeaPlant as Hydrangea,
  EchinaceaPlant as Echinacea,
  ForsythiaPlant as Forsythia,
  BlackcurrantPlant as Blackcurrant,
  LavenderPlant as Lavender,
  MiscanthusPlant as Miscanthus,
  PennisetumPlant as Pennisetum,
};
export type {
  BlackcurrantStats,
  EchinaceaStats,
  ForsythiaStats,
  HidcoteRegion,
  HydrangeaStats,
  LavenderStats,
  LimelightSeasonProfile,
  LynwoodRegion,
  MagnusSeasonProfile,
  MalepartusSeasonProfile,
  MiscanthusStats,
  HamelnSeasonProfile,
  PennisetumStats,
  TiselTrialYear,
};
