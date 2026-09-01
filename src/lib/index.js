export { Tree } from './tree.js';
export { Trellis } from './trellis.js';
export { TreePreset } from './presets/index.js';
export { Billboard, ShadowCast, TreeType } from './enums.js';
export { PlantRenderer } from './plant-renderer.js';
// Optional, caller-driven. Nothing in the library constructs one: a plant's
// level is set by `setLevel`, never by a camera.
export {
  normalizePlantLODLevels,
  PlantLODController,
  selectPlantLODLevel,
} from './plant-lod.js';

export { Blackcurrant } from './plants/blackcurrant/blackcurrant.js';
export {
  dayOfYear,
  calendarLabel,
  monthDayToDay,
  isLeapYear,
} from './calendar.js';
export { TISEL_PROFILE, TISEL_SOURCES } from './plants/blackcurrant/tisel.js';
export {
  getTiselPhenology,
  getTiselCareHints,
  TISEL_CALENDAR,
  TISEL_CALENDAR_PROVENANCE,
} from './plants/blackcurrant/phenology.js';

export { Forsythia } from './plants/forsythia/forsythia.js';
export {
  LYNWOOD_PROFILE,
  LYNWOOD_SOURCES,
} from './plants/forsythia/lynwood.js';
export {
  getLynwoodPhenology,
  getLynwoodCareHints,
  LYNWOOD_CALENDAR,
  LYNWOOD_CALENDAR_PROVENANCE,
  LYNWOOD_REGION_OBSERVATIONS,
} from './plants/forsythia/phenology.js';
export {
  createLynwoodModel,
  evaluateLynwoodModel,
} from './plants/forsythia/model.js';

export { Hydrangea } from './plants/hydrangea/hydrangea.js';
export {
  LIMELIGHT_PROFILE,
  LIMELIGHT_SOURCES,
} from './plants/hydrangea/limelight.js';
export {
  getLimelightPhenology,
  getLimelightCareHints,
  getLimelightCalendar,
  LIMELIGHT_CALENDAR,
  LIMELIGHT_CALENDAR_PROVENANCE,
  LIMELIGHT_PHASE_ASSUMPTIONS,
  LIMELIGHT_SEASON_PROFILES,
} from './plants/hydrangea/phenology.js';
export {
  createLimelightModel,
  evaluateLimelightModel,
} from './plants/hydrangea/model.js';

export { Miscanthus } from './plants/miscanthus/miscanthus.js';
export {
  MALEPARTUS_PROFILE,
  MALEPARTUS_SOURCES,
} from './plants/miscanthus/malepartus.js';
export {
  getMalepartusPhenology,
  getMalepartusCareHints,
  getMalepartusCalendar,
  MALEPARTUS_CALENDAR,
  MALEPARTUS_CALENDAR_PROVENANCE,
  MALEPARTUS_PHASE_ASSUMPTIONS,
  MALEPARTUS_SEASON_PROFILES,
} from './plants/miscanthus/phenology.js';
export {
  createMalepartusModel,
  evaluateMalepartusModel,
} from './plants/miscanthus/model.js';

export { Pennisetum } from './plants/pennisetum/pennisetum.js';
export { HAMELN_PROFILE, HAMELN_SOURCES } from './plants/pennisetum/hameln.js';
export {
  getHamelnPhenology,
  getHamelnCareHints,
  getHamelnCalendar,
  HAMELN_CALENDAR,
  HAMELN_CALENDAR_PROVENANCE,
  HAMELN_PHASE_ASSUMPTIONS,
  HAMELN_SEASON_PROFILES,
} from './plants/pennisetum/phenology.js';
export {
  createHamelnModel,
  evaluateHamelnModel,
} from './plants/pennisetum/model.js';
export { Lavender } from './plants/lavender/lavender.js';
export {
  HIDCOTE_PROFILE,
  HIDCOTE_RENDER_PRIORS,
  HIDCOTE_SOURCES,
} from './plants/lavender/hidcote.js';
export {
  getHidcotePhenology,
  getHidcoteCareHints,
  getHidcoteCalendar,
  HIDCOTE_CALENDAR,
  HIDCOTE_CALENDAR_PROVENANCE,
  HIDCOTE_PHASE_ASSUMPTIONS,
  HIDCOTE_REGION_OBSERVATIONS,
} from './plants/lavender/phenology.js';
export {
  createHidcoteModel,
  evaluateHidcoteModel,
} from './plants/lavender/model.js';
