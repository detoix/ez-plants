import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Import order matters and is the point of the first test: instanced-mesh
// applies its ShaderChunk patches as an import side effect, and the guard
// observes the result on whichever `three` this module graph resolved.
import '@detoix/instanced-mesh';
import * as THREE from 'three';

import {
  assertInstancingPatch,
  inspectInstancingPatch,
  resetInstancingPatchWarning,
  warnOnMissingInstancingPatch,
} from '../src/lib/field/three-copy-guard.js';

const REPO = new URL('..', import.meta.url).pathname;
const SCRIPT = join(REPO, 'scripts/add-plant.mjs');
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test('instanced-mesh patches the same three copy the library imports', () => {
  // This is the Node-level form of "USE_INSTANCING_INDIRECT reaches a compiled
  // field shader". A program is assembled by expanding these chunks, so a
  // patched table is the precondition for the define surviving into GLSL, and
  // it is checkable without a WebGL context. When two copies of `three` are
  // installed this fails — which is exactly the silent bug it exists to catch.
  const { patched, missing } = inspectInstancingPatch();
  assert.deepEqual(missing, []);
  assert.ok(patched);
  assert.ok(
    THREE.ShaderChunk.project_vertex.includes('USE_INSTANCING_INDIRECT'),
  );
});

test('the guard detects an unpatched chunk table rather than assuming success', () => {
  // Stand in for a second `three` copy: the chunks three itself ships, with
  // none of instanced-mesh's additions or rewrites.
  const unpatched = {
    batching_vertex: '',
    batching_pars_vertex: '',
    project_vertex: 'vec4 mvPosition = vec4( transformed, 1.0 );',
    worldpos_vertex: '',
    defaultnormal_vertex: '',
  };

  const { patched, missing } = inspectInstancingPatch(unpatched);
  assert.equal(patched, false);
  assert.ok(missing.includes('instanced_vertex'));
  assert.ok(missing.includes('project_vertex'));
});

test('assertInstancingPatch fails loudly and names the fix', () => {
  assert.throws(
    () => assertInstancingPatch({}),
    (error) => {
      assert.match(error.message, /dedupe/);
      assert.match(error.message, /three/);
      return true;
    },
  );

  assert.doesNotThrow(() => assertInstancingPatch());
});

test('the non-fatal guard warns once and reports the verdict', () => {
  resetInstancingPatchWarning();

  const original = console.error;
  const seen = [];
  console.error = (message) => seen.push(message);
  try {
    assert.equal(warnOnMissingInstancingPatch({}), false);
    assert.equal(warnOnMissingInstancingPatch({}), false);
  } finally {
    console.error = original;
  }

  assert.equal(seen.length, 1, 'the warning must not repeat every frame');
  assert.match(seen[0], /dedupe/);
  assert.equal(warnOnMissingInstancingPatch(), true);
});

test('no plant can reach the field layer, so instanced-mesh never travels', () => {
  // The packaging contract: `npm run plant:add` derives its file list by
  // walking the import graph from a renderer, so anything a renderer can reach
  // ships with every extracted plant. The dependency arrow must point
  // field -> plant and never the reverse. Derived from the plants directory,
  // not a hardcoded roster, so a new plant is covered the day it lands.
  assert.ok(PLANTS.length > 0);

  for (const plant of PLANTS) {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, plant, './anywhere', '--dry-run'],
      { cwd: REPO, encoding: 'utf8' },
    );

    const files = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes(' ') && line.includes('.'));

    assert.deepEqual(
      files.filter((file) => file.startsWith('field/')),
      [],
      `${plant} must not import the field layer`,
    );

    const deps = out
      .split('\n')
      .find((line) => line.startsWith('Install peer dependencies:'))
      .replace('Install peer dependencies:', '')
      .trim();
    assert.equal(deps, 'three', `${plant} pulled in more than three`);
  }
});
