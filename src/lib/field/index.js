/**
 * Field rendering — opt-in, and deliberately behind its own entry point.
 *
 * This is the only part of the library that depends on
 * `@detoix/instanced-mesh`, which is an **optional peer dependency**: import
 * the root package and you never pull it in. That is the same arrangement React
 * and `@react-three/fiber` already have, for the same reason (library rule 8).
 *
 * The rule that keeps it true: **the dependency arrow points field → plant, and
 * never plant → field.** `npm run plant:add` derives its file list by walking
 * the import graph out from a plant's renderer, so anything a renderer can
 * reach travels with every extracted plant. Nothing under `src/lib/plants/` may
 * import this directory, and `test/field-instancing.test.js` fails the build if
 * that ever changes.
 *
 * If you use this, deduplicate `three` — see `three-copy-guard.js`.
 *
 * Like the rest of the library, a field never reads a camera. The caller says
 * which level each placement draws at (`setLevels`), and the budget is
 * reported rather than enforced. `PlantLODController` from the root package is
 * there if you want distance-driven level choice, but nothing here calls it.
 */

export {
  createPlantPrototype,
  createPrototypePool,
} from './plant-prototype.js';
export { DEFAULT_INSTANCE_BUDGET, PlantField } from './plant-field.js';
export {
  assertInstancingPatch,
  inspectInstancingPatch,
  warnOnMissingInstancingPatch,
} from './three-copy-guard.js';
