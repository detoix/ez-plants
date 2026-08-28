import {
  Blackcurrant,
  Forsythia,
  Hydrangea,
  LIMELIGHT_PROFILE,
  LIMELIGHT_SOURCES,
  LYNWOOD_PROFILE,
  LYNWOOD_SOURCES,
  MALEPARTUS_PROFILE,
  MALEPARTUS_SOURCES,
  Miscanthus,
  TISEL_PROFILE,
  TISEL_SOURCES,
  TreePreset,
} from '@detoix/ez-plants';
import { getBarkMaps, getLeafMap, LeafType } from './textures';

// EZ-Tree v2 expresses textureScale.x per unit of branch radius. The shrub
// models are expressed in metres, so this is the Bark001 calibration in metre
// units.
const BARK_WRAPS_PER_METRE_RADIUS = 250;

/**
 * Reuse EZ-Tree's shrub bark contract directly: a preset selects the bark
 * texture set, tint, shading and longitudinal UV scale, and only the
 * circumferential scale is converted from generic Tree units to metres.
 */
function shrubBark(presetName) {
  const bark = structuredClone(TreePreset[presetName].bark);
  bark.textureScale.x = BARK_WRAPS_PER_METRE_RADIUS;
  bark.maps = getBarkMaps(bark.type);
  return bark;
}

/**
 * Build the camera review poses for a plant from its own size, so a 1.3 m
 * currant and a 2.3 m forsythia are both framed correctly without hand-tuned
 * numbers per species.
 */
function reviewViews({ heightM, radiusM }) {
  const eye = heightM * 0.62;
  const target = heightM * 0.52;
  const distance = Math.max(heightM * 1.9, radiusM * 3.4);
  return Object.freeze({
    front: { position: [0, eye, distance], target: [0, target, 0] },
    'three-quarter': {
      position: [distance * 0.72, eye * 1.1, distance * 0.72],
      target: [0, target, 0],
    },
    side: { position: [distance, eye, 0], target: [0, target, 0] },
    top: {
      position: [0.01, heightM * 2.3, 0.01],
      target: [0, target * 0.8, 0],
      up: [0, 0, -1],
    },
    'close-up': {
      position: [distance * 0.42, eye * 0.86, distance * 0.42],
      target: [0, target * 1.05, 0],
    },
  });
}

/**
 * Every plant in the library declares the same descriptor shape, which is what
 * lets one demo page, one control panel and one React component drive all of
 * them. Species-specific knowledge lives here, not in the UI.
 */
export const PLANTS = Object.freeze({
  blackcurrant: Object.freeze({
    id: 'blackcurrant',
    label: 'Blackcurrant',
    labelPl: 'Porzeczka czarna',
    cultivar: 'Tisel',
    species: TISEL_PROFILE.species,
    kicker: 'Garden digital twin · proof 01',
    profile: TISEL_PROFILE,
    sources: TISEL_SOURCES,
    defaults: Object.freeze({ age: 4, day: 175 }),
    maxYears: 50,
    size: Object.freeze({
      heightM: TISEL_PROFILE.architecture.matureHeightM,
      radiusM: TISEL_PROFILE.architecture.matureRadiusM,
    }),
    bedRadiusM: 0.68,
    // The phenology axis this plant is scrubbed along, beyond age and day.
    profileControl: Object.freeze({
      key: 'trialYear',
      label: 'Trial year',
      options: Object.freeze([
        ['mean', 'Mean'],
        ['2022', '2022'],
        ['2023', '2023'],
        ['2024', '2024'],
      ]),
    }),
    seasons: Object.freeze([
      { label: 'Dormant', day: 30 },
      { label: 'Budbreak', day: 88 },
      { label: 'Flower', day: 112 },
      { label: 'Green fruit', day: 145 },
      { label: 'Ripe', day: 175 },
      { label: 'Autumn', day: 288 },
    ]),
    stats: Object.freeze([
      { key: 'visibleCanes', label: 'Canes' },
      { key: 'visibleLeaves', label: 'Leaves' },
      { key: 'visibleFlowers', label: 'Flowers' },
      { key: 'visibleGreenBerries', label: 'Green fruit' },
      { key: 'visibleRipeBerries', label: 'Ripe fruit' },
    ]),
    yieldLine: Object.freeze({
      label: 'Source-calibrated crop remaining',
      key: 'estimatedYieldKg',
      unit: 'kg',
      note: 'Berry meshes are a representative visual sample, not one sphere per berry in the crop estimate.',
    }),
    actions: Object.freeze([
      { id: 'prune', label: 'Prune oldest' },
      { id: 'harvest', label: 'Harvest ripe' },
    ]),
    modelNote:
      '<strong>50 years ≠ one immortal bush.</strong> After year 15 the view represents replacement cycles rather than one continuously ageing plant. These are visual hypotheses, not yield forecasts.',
    create(state) {
      return new Blackcurrant({
        cultivar: 'Tisel',
        seed: state.seed ?? 24051987,
        // Lets the field page switch the wind off; it is the most expensive
        // per-vertex work in the scene, so it has to be measurable.
        leafWind: state.leafWind,
        ageYears: state.age,
        dayOfYear: state.day,
        trialYear: state.phenologyProfile,
        assets: {
          bark: shrubBark('Bush 1'),
          leaf: {
            tint: 0xffffff,
            alphaTest: 0.5,
            roundedNormals: true,
          },
        },
      });
    },
  }),

  forsythia: Object.freeze({
    id: 'forsythia',
    label: 'Forsythia',
    labelPl: 'Forsycja pośrednia',
    cultivar: 'Lynwood',
    species: LYNWOOD_PROFILE.species,
    kicker: 'Garden digital twin · proof 02',
    profile: LYNWOOD_PROFILE,
    sources: LYNWOOD_SOURCES,
    // Default to the flowering peak: it is the whole point of the plant.
    defaults: Object.freeze({ age: 6, day: 96 }),
    maxYears: 50,
    size: Object.freeze({
      heightM: LYNWOOD_PROFILE.architecture.matureHeightM,
      radiusM: LYNWOOD_PROFILE.architecture.matureRadiusM,
    }),
    bedRadiusM: 1.05,
    profileControl: Object.freeze({
      key: 'region',
      label: 'Region',
      options: Object.freeze([
        ['central', 'Central PL'],
        ['northeast', 'NE PL'],
        ['early', 'Mild yr'],
        ['late', 'Cold yr'],
      ]),
    }),
    seasons: Object.freeze([
      { label: 'Dormant', day: 30 },
      { label: 'Buds', day: 76 },
      { label: 'Bloom', day: 96 },
      { label: 'Leaf-out', day: 115 },
      { label: 'Summer', day: 200 },
      { label: 'Autumn', day: 295 },
    ]),
    stats: Object.freeze([
      { key: 'visibleCanes', label: 'Canes' },
      { key: 'visibleLeaves', label: 'Leaves' },
      { key: 'visibleFlowers', label: 'Open flowers' },
      { key: 'visibleFlowerBuds', label: 'Flower buds' },
      { key: 'visibleCapsules', label: 'Capsules' },
    ]),
    // Forsythia has no crop. The headline number is the plant's own size.
    yieldLine: Object.freeze({
      label: 'Modelled height × spread',
      key: 'dimensions',
      unit: 'm',
      format: (value) =>
        value
          ? `${value.heightM.toFixed(2)} × ${value.spreadM.toFixed(2)} m`
          : '—',
      note: 'Fruit is a dry, non-ornamental capsule. This clone is thrum-eyed, so an isolated plant sets almost no seed.',
    }),
    actions: Object.freeze([{ id: 'prune', label: 'Prune after flowering' }]),
    modelNote:
      '<strong>Flowers open on bare, one- and two-year-old wood before any leaf.</strong> The oldest canes are renewed automatically after the display; pruning after mid-July removes the wood carrying next spring&rsquo;s flowers.',
    create(state) {
      return new Forsythia({
        cultivar: 'Lynwood',
        seed: state.seed ?? 19460412,
        // Lets the field page switch the wind off; it is the most expensive
        // per-vertex work in the scene, so it has to be measurable.
        leafWind: state.leafWind,
        ageYears: state.age,
        dayOfYear: state.day,
        region: state.phenologyProfile,
        assets: {
          // Bush 3 is EZ-Tree's coarser, greyer shrub bark, which suits
          // forsythia's lenticel-dotted stems better than the currant's.
          bark: shrubBark('Bush 3'),
          leaf: {
            tint: 0xffffff,
            alphaTest: 0.5,
            roundedNormals: true,
          },
        },
      });
    },
  }),

  hydrangea: Object.freeze({
    id: 'hydrangea',
    label: 'Hydrangea',
    labelPl: 'Hortensja bukietowa',
    cultivar: 'Limelight',
    species: LIMELIGHT_PROFILE.species,
    kicker: 'Garden digital twin · proof 03',
    profile: LIMELIGHT_PROFILE,
    sources: LIMELIGHT_SOURCES,
    defaults: Object.freeze({ age: 6, day: 230 }),
    maxYears: 30,
    size: Object.freeze({
      heightM: LIMELIGHT_PROFILE.architecture.matureHeightM,
      radiusM: LIMELIGHT_PROFILE.architecture.matureRadiusM,
    }),
    bedRadiusM: 1.16,
    profileControl: Object.freeze({
      key: 'seasonProfile',
      label: 'Season timing',
      options: Object.freeze([
        ['typical', 'Typical'],
        ['early', 'Early'],
        ['late', 'Late'],
      ]),
    }),
    seasons: Object.freeze([
      { label: 'Winter heads', day: 30 },
      { label: 'Leaf-out', day: 112 },
      { label: 'Green buds', day: 181 },
      { label: 'Lime', day: 205 },
      { label: 'Cream', day: 230 },
      { label: 'Pink', day: 263 },
      { label: 'Dry', day: 300 },
    ]),
    stats: Object.freeze([
      { key: 'visibleCanes', label: 'Framework stems' },
      { key: 'visibleLeaves', label: 'Leaves' },
      { key: 'visiblePanicles', label: 'Panicles' },
      { key: 'visibleDryPanicles', label: 'Dry heads' },
    ]),
    yieldLine: Object.freeze({
      label: 'Modelled height × spread',
      key: 'dimensions',
      unit: 'm',
      format: (value) =>
        value
          ? `${value.heightM.toFixed(2)} × ${value.spreadM.toFixed(2)} m`
          : '—',
      note: 'Each panicle is one representative branched head. Its visible florets sample a biological total reported at 850–1,200 per head.',
    }),
    // Medium pruning drives the modelled plant. A public care event is
    // omitted until the shared UI can represent current-shoot cutback without
    // mislabelling it as blackcurrant-style whole-cane renewal.
    actions: Object.freeze([]),
    modelNote:
      '<strong>Flowers form at the tips of shoots grown this season.</strong> Lime heads open from the base upward, pass through cream and dusty pink, then persist tan on bare winter stems. The plant is medium-pruned before growth, which keeps the heads large and the outer shoots upright.',
    create(state) {
      return new Hydrangea({
        cultivar: 'Limelight',
        seed: state.seed ?? 1986,
        // Lets the field page switch the wind off; it is the most expensive
        // per-vertex work in the scene, so it has to be measurable.
        leafWind: state.leafWind,
        maxYears: 30,
        ageYears: state.age,
        dayOfYear: state.day,
        seasonProfile: state.phenologyProfile,
        assets: {
          bark: shrubBark('Bush 3'),
          leaf: {
            tint: 0xffffff,
            alphaTest: 0.5,
            roundedNormals: true,
          },
        },
      });
    },
  }),

  miscanthus: Object.freeze({
    id: 'miscanthus',
    label: 'Miscanthus',
    labelPl: 'Miskant chinski',
    cultivar: 'Malepartus',
    species: MALEPARTUS_PROFILE.species,
    kicker: 'Garden digital twin \u00b7 proof 04',
    profile: MALEPARTUS_PROFILE,
    sources: MALEPARTUS_SOURCES,
    // Late September: plumes fully fluffed and just starting to silver, over
    // foliage that has begun to turn. The cultivar at its best.
    defaults: Object.freeze({ age: 6, day: 250 }),
    maxYears: 25,
    size: Object.freeze({
      heightM: MALEPARTUS_PROFILE.architecture.matureHeightM,
      radiusM: MALEPARTUS_PROFILE.architecture.matureRadiusM,
    }),
    bedRadiusM: 0.78,
    profileControl: Object.freeze({
      key: 'seasonProfile',
      label: 'Season timing',
      options: Object.freeze([
        ['typical', 'Typical'],
        ['early', 'Early'],
        ['late', 'Late'],
      ]),
    }),
    seasons: Object.freeze([
      { label: 'Winter stand', day: 20 },
      { label: 'Cut back', day: 78 },
      { label: 'Bare crown', day: 104 },
      { label: 'Emerging', day: 135 },
      { label: 'Summer', day: 200 },
      { label: 'Heading', day: 228 },
      { label: 'Plumes', day: 250 },
      { label: 'Silver', day: 290 },
    ]),
    stats: Object.freeze([
      { key: 'visibleCulms', label: 'Culms' },
      { key: 'visibleBlades', label: 'Blades' },
      { key: 'visiblePlumes', label: 'Plumes' },
      { key: 'standingDeadCulms', label: 'Last year' },
    ]),
    yieldLine: Object.freeze({
      label: 'Modelled height \u00d7 spread',
      key: 'dimensions',
      unit: 'm',
      format: (value) =>
        value
          ? `${value.heightM.toFixed(2)} \u00d7 ${value.spreadM.toFixed(2)} m`
          : '\u2014',
      note: 'The clump is a bounded 118-tiller sample of one that really carries hundreds, and each plume samples its silky spikelet hairs.',
    }),
    // The single annual cut is part of the calendar, not an event: there is nothing
    // selective to prune on a grass.
    actions: Object.freeze([]),
    modelNote:
      '<strong>Nothing here is woody, and nothing above the crown is older than one season.</strong> A C4 grass waits for warm soil, so the clump is still bare in April, then builds to 2\u00a0m by August and stands dry all winter. The clump is cut to 10&nbsp;cm in the March window and divided regularly, so its centre stays full.',
    create(state) {
      return new Miscanthus({
        cultivar: 'Malepartus',
        seed: state.seed ?? 19130212,
        // Lets the field page switch the wind off; it is the most expensive
        // per-vertex work in the scene, so it has to be measurable.
        leafWind: state.leafWind,
        maxYears: 25,
        ageYears: state.age,
        dayOfYear: state.day,
        seasonProfile: state.phenologyProfile,
        // A grass needs no bark or leaf plate: culms, blades and plumes are
        // all geometry with baked vertex colours, so this plant ships with no
        // texture files. It generates one small map itself — the strip that
        // lights the white midribs — and owns its disposal.
      });
    },
  }),
});

export const DEFAULT_PLANT_ID = 'hydrangea';

export function getPlantDescriptor(id) {
  return PLANTS[id] ?? PLANTS[DEFAULT_PLANT_ID];
}

export function plantReviewViews(descriptor) {
  return reviewViews(descriptor.size);
}

export const PLANT_IDS = Object.freeze(Object.keys(PLANTS));
