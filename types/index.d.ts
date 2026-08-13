/**
 * Public type surface for @dgreenheck/ez-tree.
 *
 * The EZ-Tree procedural tree API is described by the declarations generated
 * from source during `build:lib`. The garden-plant API is hand-authored in
 * ./plants.d.ts, because generated declarations reduce its option bags to
 * `{}` and its cultivar unions to `any`.
 */

export { Tree, Trellis, TreePreset, Billboard, TreeType } from '../build/index';

export * from './plants';
