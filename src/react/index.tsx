import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';

/** Transform and event props accepted by any object placed in a scene. */
type GroupProps = ThreeElements['group'];
import {
  Blackcurrant,
  Forsythia,
  Hydrangea,
  Miscanthus,
  type BlackcurrantOptions,
  type BlackcurrantStats,
  type ForsythiaOptions,
  type ForsythiaStats,
  type HydrangeaOptions,
  type HydrangeaStats,
  type LimelightSeasonProfile,
  type LynwoodRegion,
  type MalepartusSeasonProfile,
  type MiscanthusOptions,
  type MiscanthusStats,
  type TiselTrialYear,
} from '@detoix/ez-plants';

/**
 * Options that select which plant is built. Changing any of these rebuilds
 * the plant from scratch, because they define its immutable growth graph.
 */
type ConstructionKeys = 'seed' | 'maxYears' | 'plantId' | 'cultivar' | 'assets';

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
  /** Enable camera-distance level of detail. Defaults to true. */
  lod?: boolean;
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
  update: (
    deltaSeconds?: number,
    elapsedSeconds?: number,
    camera?: THREE.Camera,
  ) => void;
}) {
  useFrame((state, delta) => {
    plant.update(Math.min(delta, 0.05), state.clock.elapsedTime, state.camera);
  });
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
  lod = true,
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
        lod,
        ageYears,
        dayOfYear,
        region,
        offsetDays,
      }),
    // Construction options only. Time and season are applied below.
    [seed, maxYears, plantId, cultivar, assets, lod],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, region, offsetDays },
    onStats as (stats: never) => void,
  );
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
  lod = true,
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
        lod,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, lod],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
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
  lod = true,
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
        lod,
        ageYears,
        dayOfYear,
        seasonProfile,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, lod],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, seasonProfile, offsetDays },
    onStats as (stats: never) => void,
  );
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
  lod = true,
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
        lod,
        ageYears,
        dayOfYear,
        trialYear,
        offsetDays,
      }),
    [seed, maxYears, plantId, cultivar, assets, lod],
  );

  useAppliedState(
    plant,
    { ageYears, dayOfYear, trialYear, offsetDays },
    onStats as (stats: never) => void,
  );
  usePlantFrame(plant);

  return <primitive object={plant} {...groupProps} />;
}

export {
  HydrangeaPlant as Hydrangea,
  ForsythiaPlant as Forsythia,
  BlackcurrantPlant as Blackcurrant,
  MiscanthusPlant as Miscanthus,
};
export type {
  BlackcurrantStats,
  ForsythiaStats,
  HydrangeaStats,
  LimelightSeasonProfile,
  LynwoodRegion,
  MalepartusSeasonProfile,
  MiscanthusStats,
  TiselTrialYear,
};
