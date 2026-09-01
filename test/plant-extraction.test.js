import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const REPO = new URL('..', import.meta.url).pathname;
const SCRIPT = join(REPO, 'scripts/add-plant.mjs');

// Read the roster rather than listing it. The library is expected to grow, and
// a new plant should be covered by these guarantees the day its folder lands,
// without anyone remembering to edit a test.
const PLANTS = readdirSync(join(REPO, 'src/lib/plants'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** Runs the extractor and returns the file list it reports. */
function plan(plant) {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, plant, './anywhere', '--dry-run'],
    { cwd: REPO, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(' ') && line.includes('.'));
}

test('extracting a plant never drags in another plant', () => {
  for (const plant of PLANTS) {
    const foreign = plan(plant).filter(
      (file) =>
        file.startsWith('plants/') && !file.startsWith(`plants/${plant}/`),
    );
    assert.deepEqual(
      foreign,
      [],
      `${plant} must not reach into another plant's folder`,
    );
  }
});

test('an extracted plant carries its own leaf plate', () => {
  for (const plant of PLANTS) {
    const files = plan(plant);
    const hasPlate = existsSync(
      join(REPO, 'src/lib/plants', plant, 'leaf.webp'),
    );
    // A plant ships a plate only if its leaves are broad enough to render as
    // cards; a plant whose organs are geometry generates the maps it needs in
    // code and carries no binary. Both are normal, so the assertion follows
    // whichever the plant actually is rather than naming names.
    assert.equal(
      files.includes(`plants/${plant}/leaf.webp`),
      hasPlate,
      `${plant} must ship the plate its renderer defaults to`,
    );
  }
});

test('an extracted plant depends only on three', () => {
  for (const plant of PLANTS) {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, plant, './anywhere', '--dry-run'],
      { cwd: REPO, encoding: 'utf8' },
    );
    const deps = out
      .split('\n')
      .find((line) => line.startsWith('Install peer dependencies:'))
      .replace('Install peer dependencies:', '')
      .trim();
    assert.equal(deps, 'three', `${plant} pulled in more than three`);
  }
});

test('a plant extracted into a bare directory constructs and renders', async () => {
  // Inside the repo so Node resolves `three` by walking up to node_modules;
  // a truly bare directory would fail on that peer dependency, which is what
  // the command's own "install peer dependencies" line tells the user.
  const cases = [
    {
      folder: 'hydrangea',
      exportName: 'Hydrangea',
      cultivar: 'Limelight',
      options: { ageYears: 6, dayOfYear: 230 },
      stage: /panicle/i,
    },
    {
      folder: 'echinacea',
      exportName: 'Echinacea',
      cultivar: 'Magnus',
      options: { ageYears: 5, dayOfYear: 205 },
      stage: /rose-purple|flower/i,
    },
  ];

  for (const sample of cases) {
    const target = mkdtempSync(join(REPO, '.extract-test-'));
    try {
      execFileSync(process.execPath, [SCRIPT, sample.folder, target], {
        cwd: REPO,
        encoding: 'utf8',
      });

      // Nothing from the demo app, and no sibling plant, may have come along.
      assert.deepEqual(readdirSync(join(target, 'plants')), [sample.folder]);

      const module = await import(
        pathToFileURL(
          join(target, `plants/${sample.folder}/${sample.folder}.js`),
        ).href
      );
      const plant = new module[sample.exportName](sample.options);
      assert.equal(plant.cultivar, sample.cultivar);
      assert.ok(plant.stats().drawCalls > 0);
      assert.match(plant.stats().phenology.stage, sample.stage);
      plant.dispose();
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }
});
