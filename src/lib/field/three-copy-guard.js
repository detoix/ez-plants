import { ShaderChunk } from 'three';

/**
 * Guards against the one failure mode that makes field instancing wrong
 * *without* raising an error: two copies of `three` in the module graph.
 *
 * `@detoix/instanced-mesh` works by patching `THREE.ShaderChunk` at import
 * time. Those patches are what teach three's built-in vertex chunks about
 * `USE_INSTANCING_INDIRECT`, which is how a per-instance matrix reaches the
 * shader from the instance data texture. If the bundler hands the library a
 * different `three` module instance than the one instanced-mesh imported, the
 * patches land on an object the active renderer never reads. Nothing throws.
 * Materials still compile. Instances still draw. But `instanceMatrix` inside
 * the shader is three's zero-length stub attribute rather than the real
 * transform, so anything reading it — notably the leaf-wind counter-rotation
 * in `leaf-wind.js` — silently produces the wrong result.
 *
 * The fix is always the same, and it is bundler-side, not code-side:
 *
 *   // vite.config.js
 *   resolve: { dedupe: ['three'] }
 *
 * Do not reach for an alias. Pointing `three` at a directory breaks the
 * `three/addons/*` subpath exports.
 */

/** Chunks instanced-mesh adds to `ShaderChunk` that three does not ship. */
const ADDED_CHUNKS = [
  'instanced_pars_vertex',
  'instanced_vertex',
  'instanced_color_pars_vertex',
  'instanced_color_vertex',
];

/**
 * Chunks three *does* ship, which instanced-mesh rewrites in place. Each entry
 * is the substring that only exists in the patched form.
 */
const PATCHED_CHUNKS = [
  ['batching_vertex', '#include <instanced_vertex>'],
  ['batching_pars_vertex', '#include <instanced_pars_vertex>'],
  ['project_vertex', 'USE_INSTANCING_INDIRECT'],
  ['worldpos_vertex', 'USE_INSTANCING_INDIRECT'],
  ['defaultnormal_vertex', 'USE_INSTANCING_INDIRECT'],
];

/**
 * Report whether the `three` copy this module imported carries
 * instanced-mesh's shader patches.
 *
 * Pure and synchronous, so it is testable without a WebGL context. Callers are
 * responsible for importing `@detoix/instanced-mesh` first — the patches are
 * applied as an import side effect, and this only observes the result.
 *
 * @param {Record<string, string>} [chunks] Shader chunk table to inspect.
 *   Defaults to the one from this module's `three`.
 * @returns {{ patched: boolean, missing: string[] }}
 */
export function inspectInstancingPatch(chunks = ShaderChunk) {
  const missing = [];

  for (const name of ADDED_CHUNKS) {
    if (typeof chunks?.[name] !== 'string') missing.push(name);
  }

  for (const [name, marker] of PATCHED_CHUNKS) {
    const source = chunks?.[name];
    if (typeof source !== 'string' || !source.includes(marker)) {
      missing.push(name);
    }
  }

  return { patched: missing.length === 0, missing };
}

const ADVICE =
  'This almost always means two copies of `three` are loaded: ' +
  '`@detoix/instanced-mesh` patched one of them and the renderer is using ' +
  "the other. Add `resolve: { dedupe: ['three'] }` to your bundler config " +
  '(Vite/Rollup) or the equivalent alias-free deduplication for your tool, ' +
  'and make sure `@detoix/instanced-mesh` resolves the same `three` as your ' +
  'app. Do not alias `three` to a directory — that breaks `three/addons/*`.';

/**
 * Throw if the active `three` copy is missing instanced-mesh's shader patches.
 *
 * Called by the field layer at construction. Failing loudly here is deliberate:
 * the alternative is a field that renders, looks plausible, and animates wind
 * incorrectly for the lifetime of the app.
 *
 * @param {Record<string, string>} [chunks]
 */
export function assertInstancingPatch(chunks) {
  const { patched, missing } = inspectInstancingPatch(chunks);
  if (patched) return;

  throw new Error(
    `ez-plants: three's shader chunks are missing instanced-mesh's ` +
      `instancing patches (${missing.join(', ')}). ${ADVICE}`,
  );
}

let warned = false;

/**
 * Non-fatal variant, for contexts that should degrade rather than fail hard.
 * Warns at most once per module instance.
 *
 * @param {Record<string, string>} [chunks]
 * @returns {boolean} whether the patches are present
 */
export function warnOnMissingInstancingPatch(chunks) {
  const { patched, missing } = inspectInstancingPatch(chunks);
  if (patched) return true;

  if (!warned) {
    warned = true;
    console.error(
      `ez-plants: instanced-mesh shader patches not found on the active ` +
        `three copy (${missing.join(', ')}). Per-instance transforms will not ` +
        `reach the shader correctly. ${ADVICE}`,
    );
  }

  return false;
}

/** Test seam: reset the once-only warning latch. */
export function resetInstancingPatchWarning() {
  warned = false;
}
